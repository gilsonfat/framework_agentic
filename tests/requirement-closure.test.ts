import { describe, it, expect } from 'vitest';
import { Verifier } from '../src/core/verifier.js';

describe('Verifier & Requirement Closure Matrix', () => {
  const verifier = new Verifier();

  it('should verify requirements when all criteria and tests pass', () => {
    const report = verifier.verify({
      runId: 'RUN-TEST-VER-1',
      requirements: [
        {
          id: 'REQ-001',
          tasks: ['TASK-001'],
          acceptanceCriteria: ['AC-001.1', 'AC-001.2'],
        },
      ],
      evidence: {
        tests_passed: 5,
        tests_failed: 0,
        test_suite_output: 'PASS',
      },
      verifierType: 'fresh_context',
    });

    expect(report.status).toBe('PASS');
    expect(report.requirements_checked[0].status).toBe('verified');
    expect(report.requirements_checked[0].acceptance_criteria_passed).toEqual(['AC-001.1', 'AC-001.2']);

    const matrix = verifier.getRequirementMatrix();
    expect(matrix['REQ-001']).toBeDefined();
    expect(matrix['REQ-001'].implemented).toBe(true);
    expect(matrix['REQ-001'].tested).toBe(true);
    expect(matrix['REQ-001'].verified).toBe(true);
  });

  it('should mark verification FAIL when acceptance criteria fail', () => {
    const report = verifier.verify({
      runId: 'RUN-TEST-VER-2',
      requirements: [
        {
          id: 'REQ-002',
          tasks: ['TASK-002'],
          acceptanceCriteria: ['AC-002.1', 'AC-002.2'],
        },
      ],
      failedCriteria: {
        'REQ-002': ['AC-002.2'],
      },
      evidence: {
        tests_passed: 2,
        tests_failed: 1,
      },
    });

    expect(report.status).toBe('FAIL');
    expect(report.requirements_checked[0].status).toBe('failed');
    expect(report.requirements_checked[0].acceptance_criteria_failed).toContain('AC-002.2');
  });
});
