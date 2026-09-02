import fs from 'fs';
import path from 'path';
import { ObservedState } from '../types/state.js';
import { RunDescriptor } from '../types/run.js';
import { RequirementClosureMatrix } from '../types/verification.js';
import { TaskResult } from '../types/execution.js';
import { GateKeeper } from './gate-keeper.js';
import { TeamCoordinator } from './team.js';
import { EvidenceCollector } from './evidence-collector.js';

export interface StatusDashboardData {
  runId: string;
  state: string;
  milestone: string;
  phase: string;
  requirementsVerified: number;
  requirementsTotal: number;
  tasksCompleted: number;
  tasksTotal: number;
  tasksAwaiting: string[];
  testsPassed: number;
  testsFailed: number;
  testStatus: string;
  evidenceSummary: string;
  reviewFindingsCount: number;
  pendingGates: string[];
  leases: string[];
  blockers: string[];
  nextAction: string;
}

/**
 * Operator-facing view of the cycle.
 *
 * It reports what the framework knows and, crucially, what it does not: a test
 * status of `pending` is displayed as "not measured", never folded into a pass.
 */
export class StatusDashboard {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public getStatusData(): StatusDashboardData {
    const data: StatusDashboardData = {
      runId: 'RUN-NONE',
      state: 'IDLE',
      milestone: 'M01',
      phase: 'P01',
      requirementsVerified: 0,
      requirementsTotal: 0,
      tasksCompleted: 0,
      tasksTotal: 0,
      tasksAwaiting: [],
      testsPassed: 0,
      testsFailed: 0,
      testStatus: 'unknown',
      evidenceSummary: 'no evidence collected',
      reviewFindingsCount: 0,
      pendingGates: [],
      leases: [],
      blockers: [],
      nextAction: 'Start a cycle: agentic prompt "<instruction>"',
    };

    const run = this.readJson<RunDescriptor>(
      path.join(this.projectRoot, '.agentic', 'execution', 'current-run.json')
    );
    if (run) {
      data.runId = run.run_id || data.runId;
      data.state = run.status || data.state;
      data.milestone = run.work_package?.milestone || data.milestone;
      data.phase = run.work_package?.phase || data.phase;
      data.blockers = run.blockers || [];
      data.reviewFindingsCount = Array.isArray((run.review as { findings?: unknown[] })?.findings)
        ? ((run.review as { findings: unknown[] }).findings.length as number)
        : 0;

      const taskIds = (run.dag?.nodes || []).map((n) => n.id);
      data.tasksTotal = taskIds.length;
      for (const taskId of taskIds) {
        const result = this.readJson<TaskResult>(
          path.join(this.projectRoot, '.agentic', 'execution', 'results', `${taskId}.json`)
        );
        if (result && result.run_id === run.run_id && result.status === 'completed') {
          data.tasksCompleted += 1;
        } else {
          data.tasksAwaiting.push(taskId);
        }
      }
    }

    const matrix = this.readJson<RequirementClosureMatrix>(
      path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json')
    );
    if (matrix) {
      const entries = Object.values(matrix);
      data.requirementsTotal = entries.length;
      data.requirementsVerified = entries.filter((e) => e.implemented && e.tested && e.verified).length;
    }

    const observed = this.readJson<ObservedState>(
      path.join(this.projectRoot, '.agentic', 'state', 'observed-state.json')
    );
    if (observed) {
      data.testsPassed = observed.tests?.passed || 0;
      data.testsFailed = observed.tests?.failed || 0;
      data.testStatus =
        observed.tests?.status === 'pending' ? 'not measured in last observation' : observed.tests?.status || 'unknown';
    }

    const evidence = new EvidenceCollector(this.projectRoot).latest();
    if (evidence) {
      data.evidenceSummary = `${evidence.id} [${evidence.source}/${evidence.status}] ${evidence.passed}p/${evidence.failed}f via \`${evidence.command}\` at ${evidence.collected_at}`;
    }

    try {
      data.pendingGates = new GateKeeper(this.projectRoot).listPending().map((g) => `${g.id} (${g.gate})`);
    } catch {
      // gates config unavailable in a non-scaffolded project
    }

    data.leases = new TeamCoordinator(this.projectRoot)
      .list()
      .map((l) => `${l.scope} -> ${l.owner_email} (until ${l.expires_at})`);

    data.nextAction = this.deriveNextAction(data);
    return data;
  }

  private deriveNextAction(data: StatusDashboardData): string {
    if (data.pendingGates.length > 0) {
      return `Decide ${data.pendingGates.length} human gate(s): agentic gate list`;
    }
    switch (data.state) {
      case 'AWAITING_AGENT':
        return data.tasksAwaiting.length > 0
          ? `Implement .agentic/execution/inbox/ then: agentic report ${data.tasksAwaiting[0]} --status completed`
          : 'All tasks reported. Close the cycle: agentic verify';
      case 'BLOCKED':
        return 'Resolve the blockers above, then: agentic run';
      case 'REMEDIATING':
        return 'Apply the remediation package in .agentic/execution/work-packages/, then: agentic verify';
      case 'HUMAN_GATE':
        return 'A human decision is required: agentic gate list';
      case 'COMPLETE':
        return 'Cycle closed with evidence. Start the next: agentic prompt "<instruction>"';
      default:
        return 'Start or continue a cycle: agentic run';
    }
  }

  private readJson<T>(file: string): T | undefined {
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  public render(data?: StatusDashboardData): string {
    const d = data || this.getStatusData();
    const lines = [
      '',
      'Agentic SDLC Status',
      '-----------------------------------------------------------',
      `Run           ${d.runId}`,
      `State         ${d.state}`,
      `Milestone     ${d.milestone}`,
      `Phase         ${d.phase}`,
      '',
      `Requirements  ${d.requirementsVerified} / ${d.requirementsTotal} closed with evidence`,
      `Tasks         ${d.tasksCompleted} / ${d.tasksTotal} reported complete`,
      `Tests         ${d.testsPassed} pass, ${d.testsFailed} fail (${d.testStatus})`,
      `Evidence      ${d.evidenceSummary}`,
      `Review        ${d.reviewFindingsCount} finding(s)`,
    ];

    if (d.tasksAwaiting.length > 0) {
      lines.push('', `Awaiting      ${d.tasksAwaiting.join(', ')}`);
    }
    if (d.pendingGates.length > 0) {
      lines.push('', 'Pending gates');
      for (const gate of d.pendingGates) lines.push(`  - ${gate}`);
    }
    if (d.leases.length > 0) {
      lines.push('', 'Active claims');
      for (const lease of d.leases) lines.push(`  - ${lease}`);
    }
    if (d.blockers.length > 0) {
      lines.push('', 'Blockers');
      for (const blocker of d.blockers) lines.push(`  - ${blocker}`);
    }

    lines.push('', 'Next action', `  ${d.nextAction}`, '-----------------------------------------------------------', '');
    return lines.join('\n');
  }
}
