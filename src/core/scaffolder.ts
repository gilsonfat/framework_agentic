import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Observer } from './observer.js';
import { Reconciler } from './reconciler.js';
import { TeamCoordinator } from './team.js';

export interface ScaffoldOptions {
  force?: boolean;
  autoObserve?: boolean;
}

export class Scaffolder {
  private packageRoot: string;

  constructor() {
    const currentFileUrl = import.meta.url;
    const currentFilePath = fileURLToPath(currentFileUrl);
    // currentFilePath is in dist/core/scaffolder.js or src/core/scaffolder.ts
    // The package root is two levels up from core
    this.packageRoot = path.resolve(path.dirname(currentFilePath), '..', '..');
  }

  public scaffold(targetProjectRoot: string = process.cwd(), options: ScaffoldOptions = {}): {
    createdDirectories: string[];
    createdFiles: string[];
    skippedFiles: string[];
  } {
    const targetAgenticDir = path.resolve(targetProjectRoot, '.agentic');
    const sourceAgenticDir = path.resolve(this.packageRoot, '.agentic');

    const createdDirectories: string[] = [];
    const createdFiles: string[] = [];
    const skippedFiles: string[] = [];

    const subDirs = [
      'orchestrator/schemas',
      'state/history',
      'planning/history',
      'specs/planned',
      'specs/decisions',
      'specs/as-built',
      'tasks/current',
      'tasks/history',
      'execution/work-packages',
      'execution/agents',
      'execution/runs',
      'execution/inbox',
      'execution/results',
      'verification/current',
      'verification/reports',
      'verification/evidence',
      'reconciliation/reports',
      'gates',
      'registry',
      'team/leases',
      'prompts',
      'templates',
      'audit',
      'adapters/claude',
      'adapters/antigravity',
      'adapters/generic',
    ];

    for (const sub of subDirs) {
      const fullDir = path.join(targetAgenticDir, sub);
      if (!fs.existsSync(fullDir)) {
        fs.mkdirSync(fullDir, { recursive: true });
        createdDirectories.push(`.agentic/${sub}`);
      }
    }

    // Copy ONLY the reusable framework assets. Copying the whole `.agentic`
    // directory leaked this repository's own specs, decisions, gates, leases,
    // evidence and run state into every scaffolded project.
    const templateSubtrees = ['orchestrator', 'prompts', 'templates'];
    const templateFiles = ['README.md'];

    if (fs.existsSync(sourceAgenticDir)) {
      for (const subtree of templateSubtrees) {
        const src = path.join(sourceAgenticDir, subtree);
        if (!fs.existsSync(src)) continue;
        this.copyDirRecursive(
          src,
          path.join(targetAgenticDir, subtree),
          options.force || false,
          createdFiles,
          skippedFiles
        );
      }

      for (const file of templateFiles) {
        const src = path.join(sourceAgenticDir, file);
        const dest = path.join(targetAgenticDir, file);
        if (!fs.existsSync(src)) continue;
        if (!fs.existsSync(dest) || options.force) {
          fs.copyFileSync(src, dest);
          createdFiles.push(path.relative(process.cwd(), dest));
        } else {
          skippedFiles.push(path.relative(process.cwd(), dest));
        }
      }
    }

    // Ensure audit log exists
    const targetAuditFile = path.join(targetAgenticDir, 'audit', 'events.jsonl');
    if (!fs.existsSync(targetAuditFile) || options.force) {
      fs.writeFileSync(
        targetAuditFile,
        JSON.stringify({
          time: new Date().toISOString(),
          run: 'SYSTEM',
          type: 'AUDIT_INITIALIZED',
          metadata: { version: 1, target: targetProjectRoot },
        }) + '\n',
        'utf8'
      );
      createdFiles.push('.agentic/audit/events.jsonl');
    }

    // Ensure initial requirement-matrix.json
    const matrixFile = path.join(targetAgenticDir, 'verification', 'requirement-matrix.json');
    if (!fs.existsSync(matrixFile) || options.force) {
      fs.writeFileSync(matrixFile, JSON.stringify({}, null, 2), 'utf8');
      createdFiles.push('.agentic/verification/requirement-matrix.json');
    }

    // Ensure initial tasks/dag.json
    const dagFile = path.join(targetAgenticDir, 'tasks', 'dag.json');
    if (!fs.existsSync(dagFile) || options.force) {
      fs.writeFileSync(
        dagFile,
        JSON.stringify(
          { nodes: [], edges: [], parallel_groups: [], critical_path: [], conflicts: [] },
          null,
          2
        ),
        'utf8'
      );
      createdFiles.push('.agentic/tasks/dag.json');
    }

    // Ensure declared state
    const declaredFile = path.join(targetAgenticDir, 'state', 'declared-state.json');
    if (!fs.existsSync(declaredFile) || options.force) {
      fs.writeFileSync(
        declaredFile,
        JSON.stringify(
          {
            milestone: 'M01',
            phase: 'P01',
            requirements: {},
            tasks: {},
            status: 'in_progress',
          },
          null,
          2
        ),
        'utf8'
      );
      createdFiles.push('.agentic/state/declared-state.json');
    }

    // Declare which artifacts are shared team truth and which are machine-local,
    // and make the append-only audit stream mergeable across branches.
    const team = new TeamCoordinator(targetProjectRoot);
    const policy = team.ensureCollaborationPolicy({ force: options.force });
    createdFiles.push(...policy.written);
    skippedFiles.push(...policy.skipped);

    // Auto-observe and reconcile if requested or on new bootstrap
    if (options.autoObserve) {
      const observer = new Observer(targetProjectRoot);
      const reconciler = new Reconciler(targetProjectRoot);
      const runId = `RUN-BOOTSTRAP-${Date.now()}`;
      const observed = observer.observe(runId);
      reconciler.reconcile(runId, observed);
      createdFiles.push('.agentic/state/observed-state.json');
      createdFiles.push('.agentic/state/reconciled-state.json');
    }

    return { createdDirectories, createdFiles, skippedFiles };
  }

  private copyDirRecursive(
    srcDir: string,
    destDir: string,
    force: boolean,
    createdFiles: string[],
    skippedFiles: string[]
  ) {
    if (!fs.existsSync(srcDir)) return;

    const entries = fs.readdirSync(srcDir, { withFileTypes: true });

    for (const entry of entries) {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);

      if (entry.isDirectory()) {
        if (!fs.existsSync(destPath)) {
          fs.mkdirSync(destPath, { recursive: true });
        }
        this.copyDirRecursive(srcPath, destPath, force, createdFiles, skippedFiles);
      } else {
        // Skip history, run-scoped and generated artifacts: only reusable
        // templates and configuration may reach a scaffolded project.
        if (
          srcPath.includes('history') ||
          srcPath.includes('runs') ||
          entry.name.endsWith('.log') ||
          entry.name.startsWith('BMAD-') ||
          entry.name.startsWith('RUN-')
        ) {
          continue;
        }

        if (!fs.existsSync(destPath) || force) {
          fs.copyFileSync(srcPath, destPath);
          createdFiles.push(path.relative(process.cwd(), destPath));
        } else {
          skippedFiles.push(path.relative(process.cwd(), destPath));
        }
      }
    }
  }
}
