import fs from 'fs';
import path from 'path';
import { ObservedState, DeclaredState, ReconciledState, ReconciledItem } from '../types/state.js';

export class Reconciler {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
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
