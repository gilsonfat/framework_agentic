import fs from 'fs';
import path from 'path';
import { RunDescriptor } from '../types/run.js';
import { OrchestratorState } from '../types/state.js';

export interface RecoveryPlan {
  canResume: boolean;
  runId: string;
  resumableState: OrchestratorState;
  completedTasks: string[];
  pendingTasks: string[];
  reason: string;
}

export class RecoveryEngine {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public planRecovery(): RecoveryPlan {
    const currentRunFile = path.join(this.projectRoot, '.agentic', 'execution', 'current-run.json');
    if (!fs.existsSync(currentRunFile)) {
      return {
        canResume: false,
        runId: 'NONE',
        resumableState: 'IDLE',
        completedTasks: [],
        pendingTasks: [],
        reason: 'No active run descriptor found (current-run.json does not exist).',
      };
    }

    try {
      const run = JSON.parse(fs.readFileSync(currentRunFile, 'utf8')) as RunDescriptor;

      if (!run.run_id || run.run_id === 'RUN-NONE') {
        return {
          canResume: false,
          runId: run.run_id || 'NONE',
          resumableState: 'IDLE',
          completedTasks: [],
          pendingTasks: [],
          reason: 'No in-flight run registered in current-run.json.',
        };
      }

      if (run.status === 'COMPLETE' || run.status === 'STOPPED') {
        return {
          canResume: false,
          runId: run.run_id,
          resumableState: run.status,
          completedTasks: [],
          pendingTasks: [],
          reason: `Run ${run.run_id} has already reached terminal status ${run.status}.`,
        };
      }

      // Task progress is read from reported results, not inferred from the
      // presence of commits: a commit says nothing about which task produced it.
      const completedTasks: string[] = [];
      const pendingTasks: string[] = [];
      const resultsDir = path.join(this.projectRoot, '.agentic', 'execution', 'results');

      for (const node of run.dag?.nodes || []) {
        const resultFile = path.join(resultsDir, `${node.id}.json`);
        let completed = false;
        if (fs.existsSync(resultFile)) {
          try {
            const result = JSON.parse(fs.readFileSync(resultFile, 'utf8')) as {
              run_id: string;
              status: string;
            };
            completed = result.run_id === run.run_id && result.status === 'completed';
          } catch {
            completed = false;
          }
        }
        (completed ? completedTasks : pendingTasks).push(node.id);
      }

      let resumableState: OrchestratorState = run.status;
      if (run.status === 'BLOCKED') {
        resumableState = 'OBSERVING';
      }

      const reason =
        run.status === 'AWAITING_AGENT'
          ? pendingTasks.length > 0
            ? `Run ${run.run_id} is awaiting implementation of ${pendingTasks.length} task(s): ${pendingTasks.join(', ')}. Report them, then run \`agentic verify\`.`
            : `Run ${run.run_id} has every task reported. Close it with \`agentic verify\`.`
          : `Resuming run ${run.run_id} from checkpoint state ${resumableState}.`;

      return {
        canResume: true,
        runId: run.run_id,
        resumableState,
        completedTasks,
        pendingTasks,
        reason,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        canResume: false,
        runId: 'CORRUPT',
        resumableState: 'BLOCKED',
        completedTasks: [],
        pendingTasks: [],
        reason: `Failed to parse current-run.json: ${msg}`,
      };
    }
  }
}
