import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Verifier } from '../src/core/verifier.js';
import { EvidenceCollector } from '../src/core/evidence-collector.js';
import { Scaffolder } from '../src/core/scaffolder.js';

describe('Verifier & Requirement Closure Matrix', () => {
  let tempDir: string;
  let verifier: Verifier;
  let collector: EvidenceCollector;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-closure-'));
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
    verifier = new Verifier(tempDir);
    collector = new EvidenceCollector(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  const requirement = {
    id: 'REQ-001',
    tasks: ['TASK-001'],
    acceptanceCriteria: ['AC-001.1', 'AC-001.2'],
  };

  it('closes a requirement only when backed by executed evidence', () => {
    const evidence = collector.collect({ runId: 'RUN-CLOSE-PASS', command: 'exit 0' });
    const report = verifier.verify({
      runId: 'RUN-CLOSE-PASS',
      requirements: [requirement],
      evidence,
      verifierType: 'fresh_context',
    });

    expect(report.status).toBe('PASS');
    expect(report.requirements_checked[0].status).toBe('verified');
    expect(report.requirements_checked[0].acceptance_criteria_passed).toEqual(['AC-001.1', 'AC-001.2']);

    const entry = verifier.getRequirementMatrix()['REQ-001'];
    expect(entry.implemented && entry.tested && entry.verified).toBe(true);
    expect(entry.evidence).toBe(evidence.id);
    expect(entry.verified_by).toBeDefined();
    expect(verifier.auditMatrixIntegrity()).toEqual([]);
  });

  it('refuses closure (BLOCKED) when evidence is merely declared', () => {
    const report = verifier.verify({
      runId: 'RUN-CLOSE-DECLARED',
      requirements: [requirement],
      // Legacy counter-only shape: numbers nobody executed.
      evidence: { tests_passed: 5, tests_failed: 0, test_suite_output: 'PASS' },
    });

    expect(report.status).toBe('BLOCKED');
    expect(report.requirements_checked[0].status).toBe('untested');
    expect(report.blocking_findings?.join(' ')).toContain('No executed evidence');
    expect(verifier.getRequirementMatrix()['REQ-001']).toBeUndefined();
  });

  it('refuses closure when the executed suite fails', () => {
    const evidence = collector.collect({ runId: 'RUN-CLOSE-FAIL', command: 'exit 1' });
    const report = verifier.verify({
      runId: 'RUN-CLOSE-FAIL',
      requirements: [requirement],
      evidence,
    });

    expect(report.status).toBe('FAIL');
    expect(verifier.getRequirementMatrix()['REQ-001']).toBeUndefined();
  });

  it('marks verification FAIL when specific acceptance criteria fail', () => {
    const evidence = collector.collect({ runId: 'RUN-CLOSE-AC', command: 'exit 0' });
    const report = verifier.verify({
      runId: 'RUN-CLOSE-AC',
      requirements: [{ id: 'REQ-002', tasks: ['TASK-002'], acceptanceCriteria: ['AC-002.1', 'AC-002.2'] }],
      failedCriteria: { 'REQ-002': ['AC-002.2'] },
      evidence,
    });

    expect(report.status).toBe('FAIL');
    expect(report.requirements_checked[0].status).toBe('failed');
    expect(report.requirements_checked[0].acceptance_criteria_failed).toContain('AC-002.2');
  });

  it('refuses to close a requirement that has no acceptance criteria', () => {
    const evidence = collector.collect({ runId: 'RUN-CLOSE-NOAC', command: 'exit 0' });
    const report = verifier.verify({
      runId: 'RUN-CLOSE-NOAC',
      requirements: [{ id: 'REQ-003', tasks: ['TASK-003'], acceptanceCriteria: [] }],
      evidence,
    });

    expect(report.status).toBe('BLOCKED');
    expect(report.blocking_findings?.join(' ')).toContain('no acceptance criteria');
  });

  it('detects requirements closed without usable evidence', () => {
    const matrixFile = path.join(tempDir, '.agentic', 'verification', 'requirement-matrix.json');
    fs.writeFileSync(
      matrixFile,
      JSON.stringify({ 'REQ-099': { implemented: true, tested: true, verified: true, tasks: ['TASK-099'] } }, null, 2),
      'utf8'
    );

    const problems = verifier.auditMatrixIntegrity();
    expect(problems).toHaveLength(1);
    expect(problems[0].requirement).toBe('REQ-099');
    expect(problems[0].problem).toContain('without an evidence record');
  });
});
