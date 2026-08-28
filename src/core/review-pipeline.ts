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
