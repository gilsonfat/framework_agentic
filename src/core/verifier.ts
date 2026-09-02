import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import {
  VerificationReport,
  RequirementClosureMatrix,
  RequirementCheckResult,
  VerificationEvidence,
} from '../types/verification.js';
import { EvidenceRecord } from '../types/evidence.js';
import { PoliciesConfig } from '../types/config.js';
import { AuditLogger } from './audit-logger.js';
import { ConfigLoader } from './config-loader.js';
import { EvidenceCollector } from './evidence-collector.js';

export interface VerificationInput {
  runId: string;
  requirements: Array<{
    id: string;
    tasks: string[];
    acceptanceCriteria: string[];
    files?: string[];
    commit?: string;
    authoredBy?: string;
  }>;
  /**
   * Executed evidence. Prefer passing an `EvidenceRecord` produced by
   * `EvidenceCollector`; the legacy counter-only shape is still accepted but is
   * treated as `declared` and can never close a requirement while
   * `policies.evidence_required_for_done` is on.
   */
  evidence: EvidenceRecord | VerificationEvidence;
  failedCriteria?: Record<string, string[]>;
  verifierType?: 'fresh_context' | 'local' | 'automated';
  /** Bypass the evidence gate (only for explicitly configured non-code work). */
  allowUnverifiedClosure?: boolean;
}

function isEvidenceRecord(value: EvidenceRecord | VerificationEvidence): value is EvidenceRecord {
  return typeof (value as EvidenceRecord).source === 'string' && typeof (value as EvidenceRecord).id === 'string';
}

/**
 * Independent verifier and the single writer of the requirement closure matrix.
 *
 * Hard rule: a requirement is only closed when backed by an `EvidenceRecord`
 * whose source is `executed` and whose run exited zero. Anything else yields
 * BLOCKED — explicitly *not* a pass — so a run can no longer mark work DONE
 * from synthesized counters.
 */
export class Verifier {
  private projectRoot: string;
  private auditLogger: AuditLogger;
  private policies: PoliciesConfig | undefined;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger, configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
    try {
      this.policies = (configLoader || new ConfigLoader(this.projectRoot)).loadPoliciesConfig();
    } catch {
      this.policies = undefined;
    }
  }

  public verify(input: VerificationInput): VerificationReport {
    this.auditLogger.emit(input.runId, 'VERIFICATION_STARTED');

    const verificationId = `VER-${Date.now()}`;
    const verifiedBy = this.actor();
    const record = isEvidenceRecord(input.evidence) ? input.evidence : undefined;
    const evidence = this.normalizeEvidence(input.evidence);

    const evidenceRequired = this.policies?.policies.evidence_required_for_done !== false;
    const closable = record ? EvidenceCollector.isClosable(record) : false;
    const blockingFindings: string[] = [];

    // 1. Evidence gate: refuse closure without an executed test run.
    if (evidenceRequired && !closable && !input.allowUnverifiedClosure) {
      if (!record) {
        blockingFindings.push(
          'No executed evidence record supplied. Run `agentic verify` (or EvidenceCollector.collect) so the test suite actually runs before closing requirements.'
        );
      } else if (record.source !== 'executed') {
        blockingFindings.push(`Evidence ${record.id} has source '${record.source}': only 'executed' evidence can close a requirement.`);
      } else if (record.status !== 'pass' || record.exit_code !== 0 || record.failed > 0) {
        blockingFindings.push(
          `Evidence ${record.id} shows a failing suite (exit_code=${String(record.exit_code)}, failed=${record.failed}).`
        );
      }
    }

    // 2. Author != verifier policy.
    // A `fresh_context` verification already satisfies the invariant (the verifier
    // reasons from the spec and the evidence, not from the author's context), so the
    // identity check only applies to `local` verifications.
    const authors = new Set(input.requirements.map((r) => r.authoredBy).filter(Boolean) as string[]);
    const verifierType = input.verifierType || 'fresh_context';
    if (
      this.policies?.policies.author_must_differ_from_verifier &&
      verifierType === 'local' &&
      authors.size > 0 &&
      authors.has(verifiedBy)
    ) {
      blockingFindings.push(
        `Policy author_must_differ_from_verifier: '${verifiedBy}' both implemented and verified this work. A different identity (or a fresh-context verifier) must confirm it.`
      );
    }

    // 3. Per-requirement criteria evaluation.
    const requirementsChecked: RequirementCheckResult[] = [];
    let anyFailed = false;

    for (const req of input.requirements) {
      const failed = input.failedCriteria?.[req.id] || [];
      const passed = req.acceptanceCriteria.filter((ac) => !failed.includes(ac));
      const suiteFailed = record ? record.failed > 0 || record.status === 'fail' || record.status === 'error' : evidence.tests_failed > 0;

      let status: RequirementCheckResult['status'];
      if (failed.length > 0 || suiteFailed) {
        status = 'failed';
        anyFailed = true;
        blockingFindings.push(
          `Requirement ${req.id} failed verification (failed criteria: [${failed.join(', ') || 'none'}], suite failing: ${suiteFailed}).`
        );
      } else if (blockingFindings.length > 0) {
        status = 'untested';
      } else if (req.acceptanceCriteria.length === 0) {
        status = 'untested';
        blockingFindings.push(
          `Requirement ${req.id} has no acceptance criteria, so nothing executable proves it. Specify AC ids before closing it.`
        );
      } else {
        status = 'verified';
      }

      requirementsChecked.push({
        requirement_id: req.id,
        status,
        acceptance_criteria_passed: status === 'verified' ? passed : [],
        acceptance_criteria_failed: failed,
      });
    }

    // 4. Overall status.
    let overallStatus: VerificationReport['status'];
    if (requirementsChecked.length === 0) {
      overallStatus = 'PARTIAL';
    } else if (anyFailed) {
      overallStatus = 'FAIL';
    } else if (blockingFindings.length > 0) {
      overallStatus = 'BLOCKED';
    } else {
      overallStatus = 'PASS';
    }

    const report: VerificationReport = {
      verification_id: verificationId,
      run_id: input.runId,
      status: overallStatus,
      timestamp: new Date().toISOString(),
      verifier_type: input.verifierType || 'fresh_context',
      verified_by: verifiedBy,
      authored_by: authors.size === 1 ? Array.from(authors)[0] : undefined,
      requirements_checked: requirementsChecked,
      evidence,
      blocking_findings: blockingFindings.length > 0 ? blockingFindings : undefined,
    };

    if (overallStatus === 'PASS') {
      this.auditLogger.emit(input.runId, 'VERIFICATION_PASSED', {
        metadata: { verificationId, evidence: record?.id },
      });
      this.updateRequirementMatrix(input, verificationId, record, verifiedBy);
    } else {
      this.auditLogger.emit(
        input.runId,
        overallStatus === 'BLOCKED' ? 'EVIDENCE_REJECTED' : 'VERIFICATION_FAILED',
        { metadata: { verificationId, status: overallStatus, blockingFindings } }
      );
    }

    this.saveVerificationReport(report);
    return report;
  }

  public getRequirementMatrix(): RequirementClosureMatrix {
    const matrixFile = this.matrixFile();
    if (fs.existsSync(matrixFile)) {
      try {
        return JSON.parse(fs.readFileSync(matrixFile, 'utf8'));
      } catch {
        // corrupted matrix is treated as empty rather than silently trusted
      }
    }
    return {};
  }

  /** Requirements the matrix claims are closed but whose evidence is missing or unusable. */
  public auditMatrixIntegrity(): Array<{ requirement: string; problem: string }> {
    const matrix = this.getRequirementMatrix();
    const collector = new EvidenceCollector(this.projectRoot);
    const problems: Array<{ requirement: string; problem: string }> = [];

    for (const [id, entry] of Object.entries(matrix)) {
      if (!(entry.implemented && entry.tested && entry.verified)) continue;
      if (!entry.evidence) {
        problems.push({ requirement: id, problem: 'closed without an evidence record reference' });
        continue;
      }
      const record = collector.load(entry.evidence);
      if (!record) {
        problems.push({ requirement: id, problem: `evidence record '${entry.evidence}' not found on disk` });
      } else if (!EvidenceCollector.isClosable(record)) {
        problems.push({
          requirement: id,
          problem: `evidence '${record.id}' is not closable (source=${record.source}, status=${record.status})`,
        });
      }
    }

    return problems;
  }

  private normalizeEvidence(input: EvidenceRecord | VerificationEvidence): VerificationEvidence {
    if (isEvidenceRecord(input)) {
      return {
        tests_passed: input.passed,
        tests_failed: input.failed,
        test_suite_output: input.output_tail,
        evidence_id: input.id,
        source: input.source,
        command: input.command,
        exit_code: input.exit_code,
        output_sha256: input.output_sha256,
      };
    }
    return { ...input, source: input.source || 'declared' };
  }

  private updateRequirementMatrix(
    input: VerificationInput,
    verificationId: string,
    record: EvidenceRecord | undefined,
    verifiedBy: string
  ) {
    const matrix = this.getRequirementMatrix();

    for (const req of input.requirements) {
      const previous = matrix[req.id];
      matrix[req.id] = {
        implemented: true,
        tested: true,
        verified: true,
        tasks: req.tasks,
        files: req.files || previous?.files,
        tests: record ? [record.command] : previous?.tests,
        commits: req.commit ? Array.from(new Set([...(previous?.commits || []), req.commit])) : previous?.commits,
        verification: verificationId,
        evidence: record?.id,
        verified_by: verifiedBy,
        verified_at: new Date().toISOString(),
        closed_by_run: input.runId,
        commit: req.commit || record?.commit,
      };
    }

    const file = this.matrixFile();
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(matrix, null, 2), 'utf8');
  }

  private matrixFile(): string {
    return path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
  }

  private saveVerificationReport(report: VerificationReport) {
    const reportsDir = path.join(this.projectRoot, '.agentic', 'verification', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(reportsDir, `${report.run_id}-${report.verification_id}.json`),
      JSON.stringify(report, null, 2),
      'utf8'
    );
  }

  private actor(): string {
    if (process.env.AGENTIC_VERIFIER) return process.env.AGENTIC_VERIFIER;
    if (process.env.AGENTIC_ACTOR) return process.env.AGENTIC_ACTOR;
    try {
      return (
        execSync('git config user.email', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
          .toString()
          .trim() || 'unknown'
      );
    } catch {
      return 'unknown';
    }
  }
}
