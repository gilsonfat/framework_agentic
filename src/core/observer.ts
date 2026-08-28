import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ObservedState } from '../types/state.js';
import { ConfigLoader } from './config-loader.js';

export class Observer {
  private projectRoot: string;
  private configLoader: ConfigLoader;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
  }

  public observe(runId: string): ObservedState {
    const git = this.observeGit();
    const project = this.observeProject();
    const tests = this.observeTests(project.scripts);
    const specs = this.observeSpecs();
    const requirements = this.observeRequirements();
    const tasks = this.observeTasks();
    const risks: string[] = [];
    const blockers: string[] = [];

    if (!git.is_clean) {
      risks.push(`Working tree is dirty with ${git.dirty_files.length} uncommitted file(s).`);
    }

    if (tests.status === 'fail') {
      blockers.push(`Test suite is currently failing (${tests.failed} test(s) failed).`);
    }

    const observed: ObservedState = {
      run_id: runId,
      git,
      project,
      tests,
      requirements,
      tasks,
      specs,
      risks,
      blockers,
      timestamp: new Date().toISOString(),
    };

    this.saveObservedState(observed);
    return observed;
  }

  private observeGit() {
    let branch = 'unknown';
    let commit = 'unknown';
    let is_clean = true;
    let dirty_files: string[] = [];
    let recent_commits: string[] = [];

    try {
      branch = execSync('git branch --show-current', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'HEAD';
      commit = execSync('git rev-parse HEAD', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
        .toString()
        .trim();
      const statusOutput = execSync('git status --porcelain', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (statusOutput.length > 0) {
        is_clean = false;
        dirty_files = statusOutput.split('\n').map((l) => l.trim());
      }
      const logOutput = execSync('git log -5 --oneline', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
        .toString()
        .trim();
      if (logOutput.length > 0) {
        recent_commits = logOutput.split('\n').map((l) => l.trim());
      }
    } catch {
      // Git might not be initialized or accessible
    }

    return { branch, commit, is_clean, dirty_files, recent_commits };
  }

  private observeProject() {
    let name = path.basename(this.projectRoot);
    const stack: string[] = [];
    let scripts: Record<string, string> = {};
    const migrations: string[] = [];

    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.name) name = pkg.name;
        if (pkg.scripts) scripts = pkg.scripts;
        if (pkg.dependencies?.typescript || pkg.devDependencies?.typescript) stack.push('typescript');
        if (pkg.dependencies?.react || pkg.devDependencies?.react) stack.push('react');
        if (pkg.dependencies?.next) stack.push('next.js');
        if (pkg.dependencies?.express) stack.push('express');
        if (pkg.dependencies?.['@prisma/client']) stack.push('prisma');
        if (pkg.dependencies?.drizzle) stack.push('drizzle');
        stack.push('node');
      } catch {
        // malformed package.json
      }
    }

    // Check potential migration folders
    const potentialMigrationDirs = [
      path.join(this.projectRoot, 'migrations'),
      path.join(this.projectRoot, 'prisma', 'migrations'),
      path.join(this.projectRoot, 'src', 'db', 'migrations'),
    ];

    for (const dir of potentialMigrationDirs) {
      if (fs.existsSync(dir)) {
        try {
          const files = fs.readdirSync(dir);
          migrations.push(...files.map((f) => path.join(path.basename(dir), f)));
        } catch {
          // ignore
        }
      }
    }

    return { name, stack: Array.from(new Set(stack)), scripts, migrations };
  }

  private observeTests(scripts: Record<string, string>): import('../types/state.js').TestsObservedState {
    if (!scripts['test']) {
      return {
        status: 'unavailable',
        passed: 0,
        failed: 0,
        skipped: 0,
        duration_ms: 0,
        failed_test_files: [],
      };
    }

    return {
      status: 'pass',
      passed: 0,
      failed: 0,
      skipped: 0,
      duration_ms: 0,
      failed_test_files: [],
    };
  }

  private observeSpecs() {
    const plannedDir = path.join(this.projectRoot, '.agentic', 'specs', 'planned');
    const asBuiltDir = path.join(this.projectRoot, '.agentic', 'specs', 'as-built');
    const planned: string[] = [];
    const as_built: string[] = [];

    if (fs.existsSync(plannedDir)) {
      planned.push(...fs.readdirSync(plannedDir));
    }
    if (fs.existsSync(asBuiltDir)) {
      as_built.push(...fs.readdirSync(asBuiltDir));
    }

    return { planned, as_built };
  }

  private observeRequirements(): Record<string, { status: 'done' | 'partial' | 'not_started' | 'failed'; verified: boolean }> {
    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (fs.existsSync(matrixFile)) {
      try {
        const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
        const result: Record<string, { status: 'done' | 'partial' | 'not_started' | 'failed'; verified: boolean }> = {};
        for (const [id, data] of Object.entries(matrix as Record<string, { implemented: boolean; tested: boolean; verified: boolean }>)) {
          let status: 'done' | 'partial' | 'not_started' | 'failed' = 'not_started';
          if (data.implemented && data.tested && data.verified) {
            status = 'done';
          } else if (data.implemented || data.tested) {
            status = 'partial';
          }
          result[id] = {
            status,
            verified: Boolean(data.verified),
          };
        }
        return result;
      } catch {
        // ignore
      }
    }
    return {};
  }

  private observeTasks(): Record<string, { status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'; commit?: string }> {
    const dagFile = path.join(this.projectRoot, '.agentic', 'tasks', 'dag.json');
    if (fs.existsSync(dagFile)) {
      try {
        const dag = JSON.parse(fs.readFileSync(dagFile, 'utf8'));
        const result: Record<string, { status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked'; commit?: string }> = {};
        if (Array.isArray(dag.nodes)) {
          for (const node of dag.nodes) {
            result[node.id] = {
              status: 'pending',
            };
          }
        }
        return result;
      } catch {
        // ignore
      }
    }
    return {};
  }

  private saveObservedState(state: ObservedState) {
    const stateDir = path.join(this.projectRoot, '.agentic', 'state');
    const historyDir = path.join(stateDir, 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const stateFile = path.join(stateDir, 'observed-state.json');
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

    const historyFile = path.join(historyDir, `${state.run_id}-observed.json`);
    fs.writeFileSync(historyFile, JSON.stringify(state, null, 2), 'utf8');
  }
}
