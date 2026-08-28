import { describe, it, expect } from 'vitest';
import { Doctor } from '../src/core/doctor.js';

describe('Doctor', () => {
  const doctor = new Doctor();

  it('should run diagnostic checks and report readiness', () => {
    const report = doctor.runDiagnostics();
    expect(report).toBeDefined();
    expect(report.checks.length).toBeGreaterThanOrEqual(6);
    expect(report.ready).toBe(true);

    const formatted = doctor.formatReport(report);
    expect(formatted).toContain('Agentic SDLC Doctor Diagnostic');
    expect(formatted).toContain('STATUS: READY');
  });
});
