import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Doctor } from '../src/core/doctor.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { AuditLogger } from '../src/core/audit-logger.js';

describe('Doctor', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-doctor-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      // ignore: the git check itself is asserted below
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should run diagnostic checks and report readiness', () => {
    const doctor = new Doctor(tempDir);
    const report = doctor.runDiagnostics();

    expect(report.checks.length).toBeGreaterThanOrEqual(6);
    expect(report.ready).toBe(true);

    const formatted = doctor.formatReport(report);
    expect(formatted).toContain('Agentic SDLC Doctor Diagnostic');
    expect(formatted).toContain('STATUS: READY');
  });

  it('warns instead of passing when the project cannot produce test evidence', () => {
    const report = new Doctor(tempDir).runDiagnostics();
    const evidence = report.checks.find((c) => c.name === 'Evidence capability');

    expect(evidence?.status).toBe('WARN');
    expect(evidence?.details).toContain('no requirement can be closed');
  });

  it('fails when a requirement is closed without usable evidence', () => {
    const matrixFile = path.join(tempDir, '.agentic', 'verification', 'requirement-matrix.json');
    fs.writeFileSync(
      matrixFile,
      JSON.stringify({ 'REQ-500': { implemented: true, tested: true, verified: true, tasks: [] } }, null, 2),
      'utf8'
    );

    const report = new Doctor(tempDir).runDiagnostics();
    const closure = report.checks.find((c) => c.name === 'Closure evidence');

    expect(closure?.status).toBe('FAIL');
    expect(report.ready).toBe(false);
  });

  it('fails when the audit hash chain is tampered with', () => {
    const logger = new AuditLogger(tempDir);
    logger.emit('RUN-DOCTOR', 'RUN_STARTED');
    logger.emit('RUN-DOCTOR', 'VERIFICATION_PASSED');

    const auditFile = path.join(tempDir, '.agentic', 'audit', 'events.jsonl');
    const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const tampered = lines.map((line) => {
      const event = JSON.parse(line);
      if (event.hash) {
        event.metadata = { ...(event.metadata || {}), injected: 'after the fact' };
      }
      return JSON.stringify(event);
    });
    fs.writeFileSync(auditFile, tampered.join('\n') + '\n', 'utf8');

    const report = new Doctor(tempDir).runDiagnostics();
    const chain = report.checks.find((c) => c.name === 'Audit hash chain');
    expect(chain?.status).toBe('FAIL');
  });
});
