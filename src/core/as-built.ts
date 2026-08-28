import fs from 'fs';
import path from 'path';
import { VerificationReport } from '../types/verification.js';
import { WorkPackage } from '../types/task.js';
import { AuditLogger } from './audit-logger.js';

export interface AsBuiltInput {
  runId: string;
  milestone: string;
  phase: string;
  baselineCommit: string;
  resultCommit: string;
  verificationReport: VerificationReport;
  workPackage: WorkPackage;
  filesChanged: string[];
  testsSummary: string;
  deviations?: string[];
}

export class AsBuiltGenerator {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public generate(input: AsBuiltInput): string {
    const verifiedReqs = input.verificationReport.requirements_checked
      .filter((r) => r.status === 'verified')
      .map((r) => `- **${r.requirement_id}**: ${r.acceptance_criteria_passed.join(', ')}`)
      .join('\n');

    const filesList = input.filesChanged.map((f) => `- \`${f}\``).join('\n');

    const traceabilityRows = input.verificationReport.requirements_checked
      .map(
        (r) =>
          `| ${r.requirement_id} | ${input.workPackage.requirements.join(', ')} | ${input.filesChanged.length} files | ${input.verificationReport.evidence.tests_passed} passed | ${input.resultCommit} | ${input.verificationReport.verification_id} |`
      )
      .join('\n');

    const content = `# As-Built Specification

## Metadata

- **Run ID**: ${input.runId}
- **Milestone**: ${input.milestone}
- **Phase**: ${input.phase}
- **Baseline Commit**: ${input.baselineCommit}
- **Result Commit**: ${input.resultCommit}
- **Verification ID**: ${input.verificationReport.verification_id}
- **Timestamp**: ${new Date().toISOString()}

## Implemented Requirements
${verifiedReqs || '_None verified_'}

## Architecture Changes
- Implemented features for phase ${input.phase} under milestone ${input.milestone}.

## Files Modified
${filesList || '_No files changed_'}

## Tests & Verification Evidence
- **Tests Passed**: ${input.verificationReport.evidence.tests_passed}
- **Tests Failed**: ${input.verificationReport.evidence.tests_failed}
- **Summary**: ${input.testsSummary}

## Deviations From Planned Spec
${input.deviations?.map((d) => `- ${d}`).join('\n') || '_No deviations from planned specification._'}

## Traceability Matrix

| Requirement | Tasks | Files | Tests | Commit | Verification |
|---|---|---|---|---|---|
${traceabilityRows || '| None | None | None | None | None | None |'}
`;

    this.saveAsBuilt(input.phase, input.runId, content);
    this.auditLogger.emit(input.runId, 'AS_BUILT_GENERATED', {
      metadata: { phase: input.phase, verificationId: input.verificationReport.verification_id },
    });

    return content;
  }

  private saveAsBuilt(phase: string, runId: string, content: string) {
    const asBuiltDir = path.join(this.projectRoot, '.agentic', 'specs', 'as-built', phase);
    if (!fs.existsSync(asBuiltDir)) {
      fs.mkdirSync(asBuiltDir, { recursive: true });
    }
    const filename = path.join(asBuiltDir, `${runId}.md`);
    fs.writeFileSync(filename, content, 'utf8');
  }
}
