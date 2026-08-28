import fs from 'fs';
import path from 'path';
import {
  VerificationReport,
  RequirementClosureMatrix,
  RequirementCheckResult,
  VerificationEvidence,
} from '../types/verification.js';
import { AuditLogger } from './audit-logger.js';

export interface VerificationInput {
  runId: string;
  requirements: Array<{
    id: string;
    tasks: string[];
    acceptanceCriteria: string[];
  }>;
  evidence: VerificationEvidence;
  failedCriteria?: Record<string, string[]>;
  verifierType?: 'fresh_context' | 'local' | 'automated';
}

export class Verifier {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public verify(input: VerificationInput): VerificationReport {
    this.auditLogger.emit(input.runId, 'VERIFICATION_STARTED');

    const verificationId = `VER-${Date.now()}`;
    const requirementsChecked: RequirementCheckResult[] = [];
    const blockingFindings: string[] = [];
    let hasFailures = false;

    if (input.evidence.tests_failed > 0) {
      hasFailures = true;
      blockingFindings.push(`Test execution failed with ${input.evidence.tests_failed} failing test(s).`);
    }

    for (const req of input.requirements) {
      const failed = input.failedCriteria?.[req.id] || [];
      const passed = req.acceptanceCriteria.filter((ac) => !failed.includes(ac));

      const isReqFailed = failed.length > 0 || input.evidence.tests_failed > 0;
      const status: 'verified' | 'failed' | 'untested' = isReqFailed ? 'failed' : 'verified';

      if (isReqFailed) {
        hasFailures = true;
        blockingFindings.push(`Requirement ${req.id} failed verification (failed criteria: [${failed.join(', ')}]).`);
      }

      requirementsChecked.push({
        requirement_id: req.id,
        status,
        acceptance_criteria_passed: passed,
        acceptance_criteria_failed: failed,
      });
    }

    const overallStatus: 'PASS' | 'FAIL' | 'PARTIAL' = hasFailures
      ? 'FAIL'
      : requirementsChecked.length > 0
      ? 'PASS'
      : 'PARTIAL';

    const report: VerificationReport = {
      verification_id: verificationId,
      run_id: input.runId,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      verifier_type: input.verifierType || 'fresh_context',
      requirements_checked: requirementsChecked,
      evidence: input.evidence,
      blocking_findings: blockingFindings.length > 0 ? blockingFindings : undefined,
    };

    if (overallStatus === 'PASS') {
      this.auditLogger.emit(input.runId, 'VERIFICATION_PASSED', {
        metadata: { verificationId },
      });
      this.updateRequirementMatrix(input.runId, verificationId, input.requirements);
    } else {
      this.auditLogger.emit(input.runId, 'VERIFICATION_FAILED', {
        metadata: { verificationId, blockingFindings },
      });
    }

    this.saveVerificationReport(report);
    return report;
  }

  public getRequirementMatrix(): RequirementClosureMatrix {
    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (fs.existsSync(matrixFile)) {
      try {
        return JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
      } catch {
        // ignore
      }
    }
    return {};
  }

  private updateRequirementMatrix(
    runId: string,
    verificationId: string,
    requirements: Array<{ id: string; tasks: string[] }>
  ) {
    const matrix = this.getRequirementMatrix();

    for (const req of requirements) {
      matrix[req.id] = {
        implemented: true,
        tested: true,
        verified: true,
        tasks: req.tasks,
        verification: verificationId,
      };
    }

    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    fs.writeFileSync(matrixFile, JSON.stringify(matrix, null, 2), 'utf8');
  }

  private saveVerificationReport(report: VerificationReport) {
    const reportsDir = path.join(this.projectRoot, '.agentic', 'verification', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const reportFile = path.join(reportsDir, `${report.run_id}-${report.verification_id}.json`);
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2), 'utf8');
  }
}
