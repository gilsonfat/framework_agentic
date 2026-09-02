import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { RemediationEngine } from '../src/core/remediation.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { VerificationReport } from '../src/types/verification.js';

describe('RemediationEngine', () => {
  let tempDir: string;
  let engine: RemediationEngine;

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

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-remediation-'));
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
    engine = new RemediationEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate a remediation package on verification failure', () => {
    const { packages, escalateToHumanGate } = engine.createRemediationPackages(failedReport);

    expect(packages.length).toBe(1);
    expect(packages[0].requirement).toBe('REQ-017');
    expect(packages[0].attempt).toBe(1);
    expect(escalateToHumanGate).toBe(false);
    expect(
      fs.existsSync(path.join(tempDir, '.agentic', 'execution', 'work-packages', 'remediation-REQ-017-1.yaml'))
    ).toBe(true);
  });

  it('should escalate to a human gate after the configured maximum attempts', () => {
    engine.createRemediationPackages(failedReport);
    engine.createRemediationPackages(failedReport);
    engine.createRemediationPackages(failedReport);
    const result = engine.createRemediationPackages(failedReport);

    expect(result.escalateToHumanGate).toBe(true);
    expect(engine.isExhausted('REQ-017')).toBe(true);
  });

  it('persists the attempt budget across processes so a new run cannot reset it', () => {
    engine.createRemediationPackages(failedReport);
    engine.createRemediationPackages(failedReport);

    // A brand new engine instance (as in a fresh CLI invocation) must remember.
    const revived = new RemediationEngine(tempDir);
    expect(revived.getAttemptCount('ANY-RUN', 'REQ-017')).toBe(2);

    const next = revived.createRemediationPackages({ ...failedReport, run_id: 'RUN-DIFFERENT' });
    expect(next.packages[0].attempt).toBe(3);
  });

  it('clears the budget once the requirement verifies green', () => {
    engine.createRemediationPackages(failedReport);
    engine.resetAttempts(['REQ-017']);

    expect(engine.getAttemptCount('RUN-TEST-REM', 'REQ-017')).toBe(0);
    expect(engine.isExhausted('REQ-017')).toBe(false);
  });
});
