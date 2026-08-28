import { describe, it, expect } from 'vitest';
import { RemediationEngine } from '../src/core/remediation.js';
import { VerificationReport } from '../src/types/verification.js';

describe('RemediationEngine', () => {
  const engine = new RemediationEngine();

  const failedReport: VerificationReport = {
    verification_id: 'VER-FAIL-01',
    run_id: 'RUN-TEST-REM',
    status: 'FAIL',
    timestamp: new Date().toISOString(),
    verifier_type: 'fresh_context',
    requirements_checked: [
      {
        requirement_id: 'REQ-017',
        status: 'failed',
        acceptance_criteria_passed: ['AC-017.1'],
        acceptance_criteria_failed: ['AC-017.2'],
        findings: ['Uniqueness constraint missing on competence column'],
      },
    ],
    evidence: {
      tests_passed: 1,
      tests_failed: 1,
    },
    blocking_findings: ['Criteria AC-017.2 failed'],
  };

  it('should generate remediation package on verification failure', () => {
    const { packages, escalateToHumanGate } = engine.createRemediationPackages(failedReport);
    expect(packages.length).toBe(1);
    expect(packages[0].requirement).toBe('REQ-017');
    expect(packages[0].attempt).toBe(1);
    expect(escalateToHumanGate).toBe(false);
  });

  it('should track retry attempts and escalate to human gate after max attempts (3)', () => {
    // Attempt 2
    engine.createRemediationPackages(failedReport);
    // Attempt 3
    engine.createRemediationPackages(failedReport);
    // Attempt 4 -> exceeds 3
    const result = engine.createRemediationPackages(failedReport);
    expect(result.escalateToHumanGate).toBe(true);
  });
});
