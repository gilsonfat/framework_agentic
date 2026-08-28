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

      const completedTasks: string[] = [];
      const pendingTasks: string[] = [];

      for (const task of run.tasks || []) {
        if (run.commits && run.commits.length > 0) {
          completedTasks.push(task.id);
        } else {
          pendingTasks.push(task.id);
        }
      }

      let resumableState: OrchestratorState = run.status;
      if (run.status === 'BLOCKED') {
        resumableState = 'OBSERVING';
      }

      return {
        canResume: true,
        runId: run.run_id,
        resumableState,
        completedTasks,
        pendingTasks,
        reason: `Resuming run ${run.run_id} from checkpoint state ${resumableState}.`,
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
