import fs from 'fs';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { TaskContract, TaskDAG } from '../types/task.js';
import {
  DispatchResult,
  DispatchedTask,
  ExecutionMode,
  PromptPackInput,
  TaskResult,
  TaskResultStatus,
} from '../types/execution.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';
import { RoutingEngine } from './routing-engine.js';
import { EvidenceCollector } from './evidence-collector.js';
import { SkillRegistry } from './skill-registry.js';
import { ModuleDetector } from './module-detector.js';

export interface DispatchInput {
  runId: string;
  dag: TaskDAG;
  contracts: TaskContract[];
  goal: string;
  specFile?: string;
  decisionRefs?: string[];
  openQuestions?: string[];
  assumptions?: string[];
  /** Overrides providers.yaml execution.mode. */
  mode?: ExecutionMode;
  /** Isolated checkouts per task, when the wave runs in parallel. */
  worktrees?: Record<string, { directory: string; branch: string }>;
  /** Policy obligations every task in this run must satisfy. */
  policy?: { changeKind: string; tdd: 'required' | 'optional'; atomicCommit: boolean };
}

/**
 * The execution boundary between the deterministic orchestrator and the actual
 * coding agent (Claude Code, Antigravity, Codex, Ruflo swarm, or a human).
 *
 * The orchestrator does not write application code and must never pretend that
 * it did. It compiles each task into a contract plus a self-contained prompt pack
 * and hands it over:
 *
 *  - `delegated` (default): prompt packs are written to `.agentic/execution/inbox/`
 *    and the run parks in AWAITING_AGENT until results are reported back with
 *    `agentic report`. This is what makes `/agentic` in Claude Code or Antigravity
 *    a real integration instead of a decorative wrapper.
 *  - `command`: each task is handed to a configured shell command (an agent CLI),
 *    and its exit code becomes the task result.
 */
export class AgentBridge {
  private projectRoot: string;
  private auditLogger: AuditLogger;
  private routing: RoutingEngine;
  private configLoader: ConfigLoader;
  private skills: SkillRegistry;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader, auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
    this.routing = new RoutingEngine(this.configLoader);
    this.skills = new SkillRegistry(this.projectRoot, this.configLoader);
  }

  public resolveMode(override?: ExecutionMode): ExecutionMode {
    if (override) return override;
    const providers = this.configLoader.loadProvidersConfig();
    const configured = (providers.providers.execution as { mode?: string } | undefined)?.mode;
    return configured === 'command' ? 'command' : 'delegated';
  }

  public dispatch(input: DispatchInput): DispatchResult {
    const mode = this.resolveMode(input.mode);
    const waveOf = new Map<string, number>();
    input.dag.parallel_groups.forEach((group, index) => {
      for (const id of group) waveOf.set(id, index + 1);
    });

    const testCommand = new EvidenceCollector(this.projectRoot, this.configLoader).detectTestCommand() || 'npm test';
    const dispatched: DispatchedTask[] = [];

    for (const contract of input.contracts) {
      const routing = this.routing.getDomainRouting(contract.domain);
      const wave = waveOf.get(contract.id) || 1;
      const skills = routing.skills || [];
      const agent = routing.preferred_agent;

      const skillGuidance = [
        this.skills.renderPromptSection('implement', {
          domain: contract.domain,
          heading: '## 8. Skills To Use (implementation)',
        }),
        this.skills.renderPromptSection('remediate', {
          heading: '## 9. Skills To Use (when a test will not go green)',
        }),
      ]
        .filter((section) => section.length > 0)
        .join('\n\n');

      const worktree = input.worktrees?.[contract.id];
      const contractFile = this.writeContract(contract);
      const promptFile = this.writePromptPack({
        runId: input.runId,
        contract,
        wave,
        totalWaves: input.dag.parallel_groups.length || 1,
        goal: input.goal,
        specFile: input.specFile,
        decisionRefs: input.decisionRefs,
        skills,
        agent,
        testCommand,
        openQuestions: input.openQuestions,
        assumptions: input.assumptions,
        skillGuidance,
        worktree,
        policy: input.policy,
      });

      dispatched.push({
        task_id: contract.id,
        wave,
        worktree: worktree ? path.relative(this.projectRoot, worktree.directory) : undefined,
        branch: worktree?.branch,
        contract_file: path.relative(this.projectRoot, contractFile),
        prompt_file: path.relative(this.projectRoot, promptFile),
        domain: contract.domain,
        skills,
        agent,
      });
    }

    const indexFile = this.writeIndex(input.runId, mode, dispatched, input);

    this.auditLogger.emit(input.runId, 'TASKS_DISPATCHED', {
      metadata: { mode, tasks: dispatched.map((d) => d.task_id), waves: input.dag.parallel_groups.length },
    });

    if (mode === 'command') {
      for (const task of dispatched) {
        this.runCommandForTask(input.runId, task);
      }
    } else {
      this.auditLogger.emit(input.runId, 'AGENT_HANDOFF', {
        metadata: {
          inbox: path.relative(this.projectRoot, this.inboxDir()),
          instruction: 'Implement each task with strict TDD, then run: agentic report <TASK-ID> --status completed',
        },
      });
    }

    const results = this.collectResults(input.runId, dispatched.map((d) => d.task_id));
    const awaiting = dispatched
      .map((d) => d.task_id)
      .filter((id) => {
        const result = results.find((r) => r.task_id === id);
        return !result || result.status === 'pending';
      });

    return {
      run_id: input.runId,
      mode,
      dispatched,
      awaiting,
      results,
      index_file: path.relative(this.projectRoot, indexFile),
    };
  }

  public recordResult(input: {
    runId: string;
    taskId: string;
    status: TaskResultStatus;
    filesChanged?: string[];
    testsAdded?: string[];
    commit?: string;
    evidenceId?: string;
    notes?: string[];
    error?: string;
    reportedBy?: string;
  }): TaskResult {
    const result: TaskResult = {
      task_id: input.taskId,
      run_id: input.runId,
      status: input.status,
      reported_by: input.reportedBy || this.actor(),
      reported_at: new Date().toISOString(),
      files_changed: input.filesChanged || [],
      tests_added: input.testsAdded || [],
      commit: input.commit,
      evidence_id: input.evidenceId,
      notes: input.notes,
      error: input.error,
    };

    const dir = this.resultsDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${input.taskId}.json`), JSON.stringify(result, null, 2), 'utf8');

    this.auditLogger.emit(input.runId, input.status === 'completed' ? 'TASK_COMPLETED' : 'TASK_FAILED', {
      task: input.taskId,
      commit: input.commit,
      metadata: {
        status: input.status,
        files_changed: result.files_changed,
        tests_added: result.tests_added,
        evidence: input.evidenceId,
        error: input.error,
      },
    });

    // Record immediately into the corresponding module CHANGELOG.md
    try {
      new ModuleDetector(this.projectRoot).recordModuleChanges({
        message: input.notes?.join('; ') || `Tarefa ${input.taskId} (${input.status})`,
        commit: input.commit,
        files: input.filesChanged,
        actor: result.reported_by,
        taskId: input.taskId,
        status: input.status,
      });
    } catch {
      // ignore
    }

    return result;
  }

  public collectResults(runId: string, taskIds: string[]): TaskResult[] {
    const dir = this.resultsDir();
    const out: TaskResult[] = [];
    for (const id of taskIds) {
      const file = path.join(dir, `${id}.json`);
      if (!fs.existsSync(file)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as TaskResult;
        // Results from an older run must not be mistaken for this run's evidence.
        if (parsed.run_id === runId) out.push(parsed);
      } catch {
        // ignore malformed result
      }
    }
    return out;
  }

  /** Clears results from previous runs so a fresh run never inherits stale completions. */
  public resetInbox(): void {
    for (const dir of [this.inboxDir(), this.resultsDir()]) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir)) {
        try {
          fs.unlinkSync(path.join(dir, file));
        } catch {
          // ignore
        }
      }
    }
  }

  private runCommandForTask(runId: string, task: DispatchedTask) {
    const providers = this.configLoader.loadProvidersConfig();
    const template = (providers.providers.execution as { command?: string } | undefined)?.command;

    if (!template) {
      this.recordResult({
        runId,
        taskId: task.task_id,
        status: 'blocked',
        error:
          'execution.mode is "command" but providers.yaml has no execution.command template. Expected e.g. `claude -p "$(cat {{prompt_file}})"`.',
        reportedBy: 'agent-bridge',
      });
      return;
    }

    const command = template
      .replace(/\{\{prompt_file\}\}/g, task.prompt_file)
      .replace(/\{\{contract_file\}\}/g, task.contract_file)
      .replace(/\{\{task_id\}\}/g, task.task_id)
      .replace(/\{\{domain\}\}/g, task.domain);

    const result = spawnSync(command, {
      cwd: this.projectRoot,
      shell: true,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    this.recordResult({
      runId,
      taskId: task.task_id,
      status: result.status === 0 ? 'completed' : 'failed',
      notes: [`command: ${command}`, `exit_code: ${String(result.status)}`],
      error: result.status === 0 ? undefined : (result.stderr || '').slice(-2000),
      reportedBy: 'agent-bridge:command',
    });
  }

  private writeContract(contract: TaskContract): string {
    const dir = path.join(this.projectRoot, '.agentic', 'tasks', 'current');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${contract.id}.json`);
    fs.writeFileSync(file, JSON.stringify(contract, null, 2), 'utf8');
    return file;
  }

  private writePromptPack(input: PromptPackInput): string {
    const dir = this.inboxDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${input.contract.id}.md`);
    fs.writeFileSync(file, this.renderPromptPack(input), 'utf8');
    return file;
  }

  private renderPromptPack(input: PromptPackInput): string {
    const c = input.contract;
    const forbidden = c.ownership.forbidden || [];
    const readonly = c.ownership.readonly || [];

    const lines: string[] = [
      `# Task Prompt Pack: ${c.id} — ${c.title || c.objective}`,
      ``,
      `> Run: \`${input.runId}\` | Wave ${input.wave}/${input.totalWaves} | Domain: \`${c.domain}\` | Role: \`${c.role}\``,
      `> Assigned agent profile: \`${input.agent}\`${input.skills.length > 0 ? ` | Skills: ${input.skills.map((s) => `\`${s}\``).join(', ')}` : ''}`,
      ``,
      `## 0. Contract Of This Handoff`,
      `You are executing ONE task of a compiled DAG. You may only touch the paths you own.`,
      `You do not decide whether the task is done — the fresh verifier does, from executed test evidence.`,
      ``,
      `## 1. Goal`,
      input.goal,
      ``,
      `## 2. Objective Of This Task`,
      c.objective,
      ``,
      `## 3. Requirements And Acceptance Criteria`,
      c.requirements.length > 0
        ? c.requirements.map((r) => `- Requirement \`${r}\``).join('\n')
        : '- (no requirement mapped: report BLOCKED instead of guessing)',
      c.acceptance_criteria.length > 0
        ? c.acceptance_criteria.map((ac) => `- Acceptance criterion \`${ac}\` must be proven by an automated assertion`).join('\n')
        : '',
      input.specFile ? `\nFull contract: \`${input.specFile}\`` : '',
      input.decisionRefs && input.decisionRefs.length > 0
        ? `\nBinding architectural decisions (do not contradict): ${input.decisionRefs.map((d) => `\`${d}\``).join(', ')} in \`.agentic/specs/decisions/\``
        : '',
      ``,
      ...(input.worktree
        ? [
            `## 3b. Where To Work (isolated checkout)`,
            `This task shares a wave with others, so it has its own git worktree:`,
            `- directory: \`${input.worktree.directory}\``,
            `- branch: \`${input.worktree.branch}\``,
            `Run every command from that directory. Do not edit the main checkout: a teammate`,
            `or another agent is working there at the same time.`,
            ``,
          ]
        : []),
      `## 4. Ownership Boundaries (hard limits)`,
      `- WRITE (only these): ${c.ownership.write.map((p) => `\`${p}\``).join(', ') || '(none)'}`,
      `- READ-ONLY: ${readonly.length > 0 ? readonly.map((p) => `\`${p}\``).join(', ') : '(everything else in the repo)'}`,
      `- FORBIDDEN: ${forbidden.length > 0 ? forbidden.map((p) => `\`${p}\``).join(', ') : '(none declared)'}`,
      `Touching a path outside WRITE invalidates the task. Report BLOCKED and explain instead.`,
      ``,
      `## 5. Mandatory Process (TDD)`,
      `1. RED: write the failing automated test that encodes each acceptance criterion above. Run \`${input.testCommand}\` and paste the failure.`,
      `2. GREEN: write the minimum implementation that makes it pass. Run \`${input.testCommand}\` again.`,
      `3. REFACTOR: remove duplication, keep types strict, no dead code.`,
      `Never weaken, skip, or delete an existing test to get to green.`,
      ``,
      `## 6. Definition Of Done For This Handoff`,
      ...(input.policy
        ? [
            `Policy for this change (classified \`${input.policy.changeKind}\`):`,
            `- TDD is **${input.policy.tdd}**${
              input.policy.tdd === 'required'
                ? ': a report without \`--tests\` is rejected'
                : ': tests are still expected wherever behaviour changes'
            }`,
            `- One atomic commit per task is **${input.policy.atomicCommit ? 'required' : 'optional'}**${
              input.policy.atomicCommit ? ': a report without a resolvable \`--commit\` is rejected' : ''
            }`,
            ``,
          ]
        : []),
      `- [ ] Test exists for every acceptance criterion listed in section 3`,
      `- [ ] \`${input.testCommand}\` exits 0 on the whole suite (no regressions)`,
      `- [ ] Only owned paths were modified`,
      `- [ ] One atomic commit for this task`,
      ``,
      `## 7. Report Back (required)`,
      '```bash',
      `agentic report ${c.id} --status completed --files "<changed files>" --tests "<test files>" --commit <sha>`,
      '```',
      `If you cannot finish: \`agentic report ${c.id} --status blocked --note "<why>"\`.`,
      `Nothing is closed until \`agentic verify\` collects real test evidence.`,
    ];

    if (input.skillGuidance && input.skillGuidance.length > 0) {
      lines.push('', input.skillGuidance);
    }

    if (input.assumptions && input.assumptions.length > 0) {
      lines.push(
        ``,
        `## 10. Assumptions In Force (not human-confirmed)`,
        ...input.assumptions.map((a) => `- ${a}`),
        `Contradicting evidence in the codebase overrides any assumption above: report it instead of following it.`
      );
    }

    if (input.openQuestions && input.openQuestions.length > 0) {
      lines.push(
        ``,
        `## 11. Open Questions (unanswered)`,
        ...input.openQuestions.map((q) => `- ${q}`),
        `Do not silently pick an answer. If a question blocks this task, report BLOCKED.`
      );
    }

    return lines.filter((l) => l !== '').join('\n') + '\n';
  }

  private writeIndex(runId: string, mode: ExecutionMode, dispatched: DispatchedTask[], input: DispatchInput): string {
    const dir = this.inboxDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const waves = new Map<number, DispatchedTask[]>();
    for (const task of dispatched) {
      const list = waves.get(task.wave) || [];
      list.push(task);
      waves.set(task.wave, list);
    }

    const lines: string[] = [
      `# Execution Inbox — ${runId}`,
      ``,
      `Mode: **${mode}** | Tasks: ${dispatched.length} | Waves: ${waves.size}`,
      ``,
      `Goal: ${input.goal}`,
      ``,
      `## Execution Order`,
      ``,
    ];

    for (const wave of Array.from(waves.keys()).sort((a, b) => a - b)) {
      lines.push(`### Wave ${wave} (tasks below may run in parallel)`);
      for (const task of waves.get(wave)!) {
        lines.push(
          `- \`${task.task_id}\` — domain \`${task.domain}\`, agent \`${task.agent}\`${task.skills.length ? `, skills ${task.skills.join('/')}` : ''} → prompt: \`${task.prompt_file}\``
        );
        if (task.worktree) {
          lines.push(`  - isolated checkout: \`${task.worktree}\` (branch \`${task.branch}\`)`);
        }
      }
      lines.push(``);
    }

    if (input.dag.conflicts.length > 0) {
      lines.push(`## Write Conflicts (must be serialized)`);
      for (const conflict of input.dag.conflicts) {
        lines.push(`- \`${conflict.task_a}\` vs \`${conflict.task_b}\`: ${conflict.conflicting_paths.join('; ')}`);
      }
      lines.push(``);
    }

    lines.push(
      `## How To Close This Run`,
      ``,
      `1. Implement each prompt pack in wave order (TDD, owned paths only).`,
      `2. Report each task: \`agentic report <TASK-ID> --status completed --commit <sha>\`.`,
      `3. Close the cycle with real evidence: \`agentic verify\`.`,
      ``
    );

    const file = path.join(dir, 'INDEX.md');
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
    return file;
  }

  private inboxDir(): string {
    return path.join(this.projectRoot, '.agentic', 'execution', 'inbox');
  }

  private resultsDir(): string {
    return path.join(this.projectRoot, '.agentic', 'execution', 'results');
  }

  private actor(): string {
    if (process.env.AGENTIC_ACTOR) return process.env.AGENTIC_ACTOR;
    try {
      return (
        execSync('git config user.email', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
          .toString()
          .trim() || 'unknown'
      );
    } catch {
      return 'unknown';
    }
  }
}
