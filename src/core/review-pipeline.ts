export type ReviewSeverity = 'CRITICAL' | 'MAJOR' | 'MINOR' | 'PASS';

export interface ReviewFinding {
  layer: 'L1' | 'L2' | 'L3' | 'L4';
  category: string;
  severity: ReviewSeverity;
  description: string;
  file?: string;
  line?: number;
  recommendation?: string;
}

export interface ReviewReport {
  runId: string;
  status: 'PASS' | 'FINDINGS' | 'CRITICAL';
  findings: ReviewFinding[];
  timestamp: string;
}

/**
 * The 4-layer review, and where each layer actually happens:
 *
 * - **L1 (worker self-review)** - performed by the implementing agent and
 *   surfaced here through the reported task status (`failed`/`blocked` becomes a
 *   MAJOR finding).
 * - **L2 (integration)** - the executed test suite. It is not re-implemented
 *   here: `EvidenceCollector` runs it and `Verifier` judges it, so there is a
 *   single source of truth for "the suite is green".
 * - **L3 (independent correctness)** - acceptance-criteria checking in
 *   `Verifier`, from the spec rather than from the implementation.
 * - **L4 (security, read-only)** - `runSecurityChecks` below, over the files the
 *   agent reported as changed.
 *
 * `evaluateReview` aggregates whatever findings the caller collected; a CRITICAL
 * finding stops the run before verification.
 */
export class ReviewPipeline {
  public evaluateReview(runId: string, findings: ReviewFinding[]): ReviewReport {
    let status: 'PASS' | 'FINDINGS' | 'CRITICAL' = 'PASS';

    for (const finding of findings) {
      if (finding.severity === 'CRITICAL') {
        status = 'CRITICAL';
        break;
      } else if (finding.severity === 'MAJOR' || finding.severity === 'MINOR') {
        status = 'FINDINGS';
      }
    }

    return {
      runId,
      status,
      findings,
      timestamp: new Date().toISOString(),
    };
  }

  public runSecurityChecks(filesChanged: string[]): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    const sensitiveFilePatterns = [/\.env.*/i, /credentials/i, /secrets/i, /id_rsa/i, /private\.key/i];

    for (const file of filesChanged) {
      for (const pattern of sensitiveFilePatterns) {
        if (pattern.test(file)) {
          findings.push({
            layer: 'L4',
            category: 'secrets',
            severity: 'CRITICAL',
            description: `Potential secret or credential file touched: ${file}`,
            file,
            recommendation: 'Ensure secrets are not committed or exposed in plaintext.',
          });
        }
      }
    }

    return findings;
  }
}
