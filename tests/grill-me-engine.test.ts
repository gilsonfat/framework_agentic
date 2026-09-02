import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { GrillMeEngine } from '../src/core/grill-me-engine.js';
import { BmadEngine } from '../src/core/bmad-engine.js';

describe('GrillMeEngine (Adversarial Probing & Clarification)', () => {
  let tempDir: string;
  let grillEngine: GrillMeEngine;
  let bmadEngine: BmadEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-grill-'));
    grillEngine = new GrillMeEngine(tempDir);
    bmadEngine = new BmadEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should interrogate ambiguities, failure modes, trade-offs, and security guardrails', () => {
    const raw = 'Criar endpoint de login com JWT';
    const briefing = bmadEngine.enhancePrompt(raw);
    const result = grillEngine.grill(raw, briefing);

    expect(result.raw_prompt).toBe(raw);
    expect(result.probes.length).toBeGreaterThanOrEqual(4);

    const categories = result.probes.map((p) => p.category);
    expect(categories).toContain('ambiguity');
    expect(categories).toContain('failure_mode');
    expect(categories).toContain('trade_off');
    expect(categories).toContain('security');

    for (const probe of result.probes) {
      expect(probe.question).toBeDefined();
      expect(probe.resolved_answer).toBeDefined();
      expect(probe.rationale).toBeDefined();
    }
  });

  it('treats unanswered probes as assumptions, never as resolved decisions', () => {
    const result = grillEngine.grill('Criar endpoint de login com JWT');

    // Nobody answered anything, so nothing may be reported as decided.
    expect(result.fully_resolved).toBe(false);
    expect(result.probes.every((p) => p.assumed)).toBe(true);
    expect(result.unresolved_items.length).toBe(result.probes.length);
    expect(result.assumptions.length).toBe(result.probes.length);
    expect(grillEngine.openQuestions(result).length).toBe(result.probes.length);
  });

  it('should format a report that distinguishes assumptions from decisions', () => {
    const result = grillEngine.grill('Implementar checkout com PIX');
    const report = grillEngine.formatGrillReport(result);

    expect(report).toContain('GRILL-ME ADVERSARIAL PROBING REPORT');
    expect(report).toContain('Assumed defaults:');
    expect(report).toContain('ASSUMED DEFAULT (needs confirmation)');
    expect(report).toContain('Rationale:');
    expect(report).toContain('--answers');
  });

  it('should record human answers as real decisions', () => {
    const result = grillEngine.grill('Criar api de uploads', undefined, {
      userAnswers: {
        'GRILL-001': 'Custom validation: Max size 5MB and JPEG/PNG only.',
      },
      answeredBy: 'dev@example.com',
    });

    const probe = result.probes.find((p) => p.id === 'GRILL-001');
    expect(probe?.resolved_answer).toBe('Custom validation: Max size 5MB and JPEG/PNG only.');
    expect(probe?.assumed).toBe(false);
    expect(probe?.answered_by).toBe('dev@example.com');
    expect(result.unresolved_items.some((item) => item.includes('malformed'))).toBe(false);
  });

  it('is fully resolved only when every probe has a human answer', () => {
    const raw = 'Criar api de uploads';
    const first = grillEngine.grill(raw);
    const answers: Record<string, string> = {};
    for (const probe of first.probes) {
      answers[probe.id] = `Decided: ${probe.recommended_option || probe.resolved_answer}`;
    }

    const result = grillEngine.grill(raw, undefined, { userAnswers: answers, answeredBy: 'lead@example.com' });
    expect(result.fully_resolved).toBe(true);
    expect(result.unresolved_items).toEqual([]);
  });
});
