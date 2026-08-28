import fs from 'fs';
import path from 'path';
import { ObservedState, ReconciledState } from '../types/state.js';
import { RunDescriptor } from '../types/run.js';
import { RequirementClosureMatrix } from '../types/verification.js';

export interface StatusDashboardData {
  runId: string;
  state: string;
  milestone: string;
  phase: string;
  requirementsVerified: number;
  requirementsTotal: number;
  tasksCompleted: number;
  tasksTotal: number;
  testsPassed: number;
  testsFailed: number;
  reviewFindingsCount: number;
  nextAction: string;
}

export class StatusDashboard {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public getStatusData(): StatusDashboardData {
    let runId = 'RUN-NONE';
    let state = 'IDLE';
    let milestone = 'M01';
    let phase = 'P01';
    let requirementsVerified = 0;
    let requirementsTotal = 0;
    let tasksCompleted = 0;
    let tasksTotal = 0;
    let testsPassed = 0;
    let testsFailed = 0;
    let reviewFindingsCount = 0;
    let nextAction = 'Run /agentic-run or /agentic-observe to start a cycle.';

    const runFile = path.join(this.projectRoot, '.agentic', 'execution', 'current-run.json');
    if (fs.existsSync(runFile)) {
      try {
        const run = JSON.parse(fs.readFileSync(runFile, 'utf8')) as RunDescriptor;
        runId = run.run_id || runId;
        state = run.status || state;
        milestone = run.work_package?.milestone || milestone;
        phase = run.work_package?.phase || phase;
      } catch {
        // ignore
      }
    }

    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (fs.existsSync(matrixFile)) {
      try {
        const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8')) as RequirementClosureMatrix;
        const entries = Object.values(matrix);
        requirementsTotal = entries.length;
        requirementsVerified = entries.filter((e) => e.implemented && e.tested && e.verified).length;
      } catch {
        // ignore
      }
    }

    const obsFile = path.join(this.projectRoot, '.agentic', 'state', 'observed-state.json');
    if (fs.existsSync(obsFile)) {
      try {
        const obs = JSON.parse(fs.readFileSync(obsFile, 'utf8')) as ObservedState;
        testsPassed = obs.tests?.passed || 0;
        testsFailed = obs.tests?.failed || 0;
        const taskEntries = Object.values(obs.tasks || {});
        tasksTotal = taskEntries.length;
        tasksCompleted = taskEntries.filter((t) => t.status === 'completed').length;
      } catch {
        // ignore
      }
    }

    if (state === 'OBSERVING') {
      nextAction = 'Observing repository state';
    } else if (state === 'RECONCILING') {
      nextAction = 'Reconciling observed state with declared state';
    } else if (state === 'PLANNING') {
      nextAction = 'Compiling work package';
    } else if (state === 'EXECUTING') {
      nextAction = 'Dispatching tasks to worker agents';
    } else if (state === 'VERIFYING') {
      nextAction = 'TLC Fresh Context Verifier running';
    } else if (state === 'REMEDIATING') {
      nextAction = 'Executing remediation package';
    } else if (state === 'HUMAN_GATE') {
      nextAction = 'Waiting for human gate decision';
    } else if (state === 'COMPLETE') {
      nextAction = 'All milestone requirements verified';
    }

    return {
      runId,
      state,
      milestone,
      phase,
      requirementsVerified,
      requirementsTotal,
      tasksCompleted,
      tasksTotal,
      testsPassed,
      testsFailed,
      reviewFindingsCount,
      nextAction,
    };
  }

  public render(data?: StatusDashboardData): string {
    const d = data || this.getStatusData();

    return `
Agentic SDLC Status
-------------------------------------------
Run          ${d.runId}
State        ${d.state}

Milestone    ${d.milestone}
Phase        ${d.phase}

Requirements
${d.requirementsVerified} / ${d.requirementsTotal} verified

Tasks
${d.tasksCompleted} / ${d.tasksTotal} complete

Tests
${d.testsPassed} pass, ${d.testsFailed} fail

Review
${d.reviewFindingsCount} findings

Next Action
${d.nextAction}
-------------------------------------------
`;
  }
}
