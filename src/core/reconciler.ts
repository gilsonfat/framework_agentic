import fs from 'fs';
import path from 'path';
import { ObservedState, DeclaredState, ReconciledState, ReconciledItem } from '../types/state.js';
import { AuditLogger } from './audit-logger.js';

export class Reconciler {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public reconcile(runId: string, observed: ObservedState, declared?: DeclaredState): ReconciledState {
    const declaredState = declared || this.loadDeclaredState();

    const matches: ReconciledItem[] = [];
    const partials: ReconciledItem[] = [];
    const mismatches: ReconciledItem[] = [];
    const unknowns: ReconciledItem[] = [];

    // Reconcile Requirements
    for (const [reqId, declReq] of Object.entries(declaredState.requirements || {})) {
      const obsReq = observed.requirements[reqId];
      const declaredStatus = declReq.status.toLowerCase();

      if (!obsReq) {
        if (declaredStatus === 'done' || declaredStatus === 'complete') {
          mismatches.push({
            id: reqId,
            type: 'requirement',
            declared: declaredStatus,
            observed: 'not_started',
            result: 'MISMATCH',
            evidence: ['Declared completed but no verification matrix entry found in observed state.'],
          });
        } else {
          unknowns.push({
            id: reqId,
            type: 'requirement',
            declared: declaredStatus,
            observed: 'not_observed',
            result: 'UNKNOWN',
            evidence: ['Requirement declared but not present in observed verification matrix.'],
          });
        }
        continue;
      }

      if (declaredStatus === 'done' || declaredStatus === 'complete') {
        if (obsReq.status === 'done' && obsReq.verified) {
          matches.push({
            id: reqId,
            type: 'requirement',
            declared: declaredStatus,
            observed: 'done',
            result: 'MATCH',
            evidence: ['Implementation, test, and verification passed in observed matrix.'],
          });
        } else if (obsReq.status === 'partial') {
          partials.push({
            id: reqId,
            type: 'requirement',
            declared: declaredStatus,
            observed: 'partial',
            result: 'PARTIAL',
            evidence: ['Implemented or tested, but not yet independently verified.'],
          });
        } else {
          mismatches.push({
            id: reqId,
            type: 'requirement',
            declared: declaredStatus,
            observed: obsReq.status,
            result: 'MISMATCH',
            evidence: [`Declared complete but observed status is ${obsReq.status}.`],
          });
        }
      } else {
        matches.push({
          id: reqId,
          type: 'requirement',
          declared: declaredStatus,
          observed: obsReq.status,
          result: 'MATCH',
          evidence: ['Declared and observed statuses match.'],
        });
      }
    }

    // Reconcile Tasks (previously declared tasks were parsed and then ignored).
    for (const [taskId, declTask] of Object.entries(declaredState.tasks || {})) {
      const obsTask = observed.tasks[taskId];
      const declaredStatus = declTask.status.toLowerCase();

      if (!obsTask) {
        (declaredStatus === 'completed' || declaredStatus === 'done' ? mismatches : unknowns).push({
          id: taskId,
          type: 'task',
          declared: declaredStatus,
          observed: 'not_observed',
          result: declaredStatus === 'completed' || declaredStatus === 'done' ? 'MISMATCH' : 'UNKNOWN',
          evidence: ['Task declared but absent from the compiled DAG and task results.'],
        });
        continue;
      }

      if (declaredStatus === obsTask.status) {
        matches.push({
          id: taskId,
          type: 'task',
          declared: declaredStatus,
          observed: obsTask.status,
          result: 'MATCH',
          evidence: ['Declared and observed task statuses match.'],
        });
      } else if (declaredStatus === 'completed' || declaredStatus === 'done') {
        mismatches.push({
          id: taskId,
          type: 'task',
          declared: declaredStatus,
          observed: obsTask.status,
          result: 'MISMATCH',
          evidence: [`Task declared complete but observed status is ${obsTask.status}.`],
        });
      } else {
        partials.push({
          id: taskId,
          type: 'task',
          declared: declaredStatus,
          observed: obsTask.status,
          result: 'PARTIAL',
          evidence: ['Task progressed beyond its declared status.'],
        });
      }
    }

    // Reconcile the measured test suite against the declaration of health.
    if (observed.tests.status === 'fail') {
      mismatches.push({
        id: 'TEST-SUITE',
        type: 'test',
        declared: 'green',
        observed: `fail (${observed.tests.failed} failing)`,
        result: 'MISMATCH',
        evidence: [
          observed.tests.evidence_id
            ? `Executed evidence ${observed.tests.evidence_id}: ${observed.tests.command}`
            : 'Test suite reported failures.',
        ],
      });
    }

    const overallStatus =
      mismatches.length > 0 ? 'MISMATCH' : partials.length > 0 ? 'PARTIAL' : 'MATCH';

    const reconciled: ReconciledState = {
      timestamp: new Date().toISOString(),
      status: overallStatus,
      matches,
      partials,
      mismatches,
      unknowns,
    };

    this.saveReconciliationArtifacts(runId, reconciled);
    return reconciled;
  }

  /**
   * Rewrites the declared state from observed truth ("Observed State > Declared
   * State" applied, not just reported). Step 12 of the cycle previously emitted
   * an audit event and changed nothing, so the loop could never converge and the
   * same mismatches were re-reported on every run.
   */
  public syncDeclaredState(
    runId: string,
    observed: ObservedState,
    context: { milestone?: string; phase?: string } = {}
  ): DeclaredState {
    const current = this.loadDeclaredState();

    const requirements: DeclaredState['requirements'] = { ...current.requirements };
    for (const [id, obs] of Object.entries(observed.requirements)) {
      requirements[id] = {
        ...(requirements[id] || {}),
        status: obs.status,
      };
    }

    const tasks: DeclaredState['tasks'] = { ...current.tasks };
    for (const [id, obs] of Object.entries(observed.tasks)) {
      tasks[id] = { ...(tasks[id] || {}), status: obs.status };
    }

    const pendingRequirements = Object.values(requirements).filter((r) => r.status !== 'done').length;

    const next: DeclaredState = {
      milestone: context.milestone || current.milestone,
      phase: context.phase || current.phase,
      requirements,
      tasks,
      status: pendingRequirements === 0 && Object.keys(requirements).length > 0 ? 'complete' : 'in_progress',
    };

    fs.writeFileSync(
      path.join(this.projectRoot, '.agentic', 'state', 'declared-state.json'),
      JSON.stringify(next, null, 2),
      'utf8'
    );

    this.auditLogger.emit(runId, 'DECLARED_STATE_SYNCED', {
      metadata: {
        milestone: next.milestone,
        phase: next.phase,
        requirements: Object.keys(requirements).length,
        pending: pendingRequirements,
      },
    });

    return next;
  }

  private loadDeclaredState(): DeclaredState {
    const file = path.join(this.projectRoot, '.agentic', 'state', 'declared-state.json');
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        // ignore
      }
    }
    return {
      milestone: 'M01',
      phase: 'P01',
      requirements: {},
      tasks: {},
      status: 'in_progress',
    };
  }

  private saveReconciliationArtifacts(runId: string, reconciled: ReconciledState) {
    const stateDir = path.join(this.projectRoot, '.agentic', 'state');
    fs.writeFileSync(
      path.join(stateDir, 'reconciled-state.json'),
      JSON.stringify(reconciled, null, 2),
      'utf8'
    );

    const diffFile = path.join(stateDir, 'diff.json');
    fs.writeFileSync(
      diffFile,
      JSON.stringify(
        {
          timestamp: reconciled.timestamp,
          status: reconciled.status,
          mismatches: reconciled.mismatches,
          partials: reconciled.partials,
        },
        null,
        2
      ),
      'utf8'
    );

    const reportsDir = path.join(this.projectRoot, '.agentic', 'reconciliation', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportMd = this.generateReportMarkdown(runId, reconciled);
    fs.writeFileSync(path.join(reportsDir, `${runId}.md`), reportMd, 'utf8');
  }

  private generateReportMarkdown(runId: string, state: ReconciledState): string {
    return `# Reconciliation Report: ${runId}

- **Status**: ${state.status}
- **Timestamp**: ${state.timestamp}
- **Matches**: ${state.matches.length}
- **Partials**: ${state.partials.length}
- **Mismatches**: ${state.mismatches.length}
- **Unknowns**: ${state.unknowns.length}

## Mismatches & Deviations
${
  state.mismatches.length === 0
    ? '_No direct mismatches detected._'
    : state.mismatches
        .map((m) => `- **${m.id}** (${m.type}): Declared \`${m.declared}\`, Observed \`${m.observed}\` — ${m.evidence.join('; ')}`)
        .join('\n')
}

## Partial Progress
${
  state.partials.length === 0
    ? '_No partial requirements pending verification._'
    : state.partials
        .map((p) => `- **${p.id}**: Declared \`${p.declared}\`, Observed \`${p.observed}\` — ${p.evidence.join('; ')}`)
        .join('\n')
}
`;
  }
}
