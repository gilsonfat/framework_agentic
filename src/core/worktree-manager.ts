import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { TaskDAG } from '../types/task.js';
import { AuditLogger } from './audit-logger.js';

export interface Worktree {
  task_id: string;
  run_id: string;
  branch: string;
  /** Absolute path of the checkout. */
  directory: string;
  created_at: string;
}

export interface WorktreePlan {
  /** Tasks that share a wave with at least one other task. */
  parallelTasks: string[];
  reason: string;
}

/**
 * Git worktree isolation for tasks that run in the same wave.
 *
 * `policies.worktree.parallel_agents: required` was declared from the start and
 * never implemented, so two agents in the same wave edited the same checkout.
 * A worktree gives each parallel task its own directory and branch, which is
 * what makes the ownership boundaries enforceable rather than advisory.
 */
export class WorktreeManager {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  /** Which tasks would benefit from isolation, and why. */
  public plan(dag: TaskDAG): WorktreePlan {
    const parallelTasks = dag.parallel_groups.filter((group) => group.length > 1).flat();

    return {
      parallelTasks,
      reason:
        parallelTasks.length > 0
          ? `${parallelTasks.length} task(s) share a wave and would edit the same checkout.`
          : 'Every wave has a single task; the main checkout is enough.',
    };
  }

  /** True when git can host worktrees here (a repository with at least one commit). */
  public isSupported(): { ok: boolean; reason?: string } {
    const inRepo = this.git('rev-parse --is-inside-work-tree');
    if (inRepo.status !== 0) {
      return { ok: false, reason: 'not a git repository' };
    }
    const head = this.git('rev-parse --verify --quiet HEAD');
    if (head.status !== 0 || !head.stdout.trim()) {
      return { ok: false, reason: 'repository has no commit yet' };
    }
    return { ok: true };
  }

  /**
   * Creates one worktree per task, idempotently. Returns what exists afterwards;
   * a failure to create one is reported rather than thrown, because losing
   * isolation must not abort the dispatch.
   */
  public ensure(runId: string, taskIds: string[]): { worktrees: Worktree[]; skipped: Array<{ task: string; reason: string }> } {
    const worktrees: Worktree[] = [];
    const skipped: Array<{ task: string; reason: string }> = [];

    const support = this.isSupported();
    if (!support.ok) {
      return { worktrees, skipped: taskIds.map((task) => ({ task, reason: support.reason || 'unsupported' })) };
    }

    for (const taskId of taskIds) {
      const existing = this.get(taskId);
      if (existing && existing.run_id === runId && fs.existsSync(existing.directory)) {
        worktrees.push(existing);
        continue;
      }

      const branch = `agentic/${runId}/${taskId}`.toLowerCase();
      const directory = path.join(this.worktreeRoot(), taskId);

      const created = this.git(`worktree add -B "${branch}" "${directory}"`);
      if (created.status !== 0) {
        skipped.push({ task: taskId, reason: (created.stderr || created.stdout || 'git worktree add failed').trim() });
        continue;
      }

      const worktree: Worktree = {
        task_id: taskId,
        run_id: runId,
        branch,
        directory,
        created_at: new Date().toISOString(),
      };
      this.save(worktree);
      worktrees.push(worktree);

      this.auditLogger.emit(runId, 'WORKTREE_CREATED', {
        task: taskId,
        metadata: { branch, directory: path.relative(this.projectRoot, directory) },
      });
    }

    return { worktrees, skipped };
  }

  public get(taskId: string): Worktree | undefined {
    const file = path.join(this.registryDir(), `${taskId}.json`);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Worktree;
    } catch {
      return undefined;
    }
  }

  public list(): Worktree[] {
    const dir = this.registryDir();
    if (!fs.existsSync(dir)) return [];
    const out: Worktree[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Worktree);
      } catch {
        continue;
      }
    }
    return out.sort((a, b) => a.task_id.localeCompare(b.task_id));
  }

  /**
   * Removes worktrees (optionally only those of one run). Branches are left in
   * place: they may hold work that has not been merged, and deleting someone's
   * commits to tidy up would be the opposite of what this framework promises.
   */
  public cleanup(options: { runId?: string; force?: boolean } = {}): { removed: string[]; kept: string[] } {
    const removed: string[] = [];
    const kept: string[] = [];

    for (const worktree of this.list()) {
      if (options.runId && worktree.run_id !== options.runId) {
        kept.push(worktree.task_id);
        continue;
      }

      const result = this.git(`worktree remove ${options.force ? '--force ' : ''}"${worktree.directory}"`);
      if (result.status === 0 || !fs.existsSync(worktree.directory)) {
        fs.rmSync(path.join(this.registryDir(), `${worktree.task_id}.json`), { force: true });
        removed.push(worktree.task_id);
        this.auditLogger.emit(worktree.run_id, 'WORKTREE_REMOVED', {
          task: worktree.task_id,
          metadata: { branch: worktree.branch },
        });
      } else {
        kept.push(worktree.task_id);
      }
    }

    return { removed, kept };
  }

  private worktreeRoot(): string {
    const dir = path.join(this.projectRoot, '.agentic', 'worktrees');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private registryDir(): string {
    const dir = path.join(this.projectRoot, '.agentic', 'execution', 'worktrees');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  private save(worktree: Worktree): void {
    fs.writeFileSync(
      path.join(this.registryDir(), `${worktree.task_id}.json`),
      `${JSON.stringify(worktree, null, 2)}\n`,
      'utf8'
    );
  }

  private git(args: string): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync(`git ${args}`, {
      cwd: this.projectRoot,
      shell: true,
      encoding: 'utf8',
    });
    return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
  }
}
