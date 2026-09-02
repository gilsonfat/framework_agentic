import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { DecisionRecorder } from '../src/core/decision-recorder.js';
import { GrillMeEngine } from '../src/core/grill-me-engine.js';

describe('DecisionRecorder (ADR & Decision Ledger)', () => {
  let tempDir: string;
  let recorder: DecisionRecorder;
  let grillEngine: GrillMeEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decisions-test-'));
    recorder = new DecisionRecorder(tempDir);
    grillEngine = new GrillMeEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate and persist formal ADR markdown files and update ledger JSON', () => {
    const raw = 'Implementar autenticação JWT';
    const grillResult = grillEngine.grill(raw);

    const records = recorder.recordDecisions('RUN-TEST-123', grillResult, {
      title: 'Autenticação JWT',
      requirementId: 'REQ-101',
    });

    expect(records.length).toBeGreaterThan(0);
    const primary = records[0];
    expect(primary.id).toMatch(/^ADR-\d+$/);
    // Probes were left on engine defaults, so the ADR is a proposal, not a ruling.
    expect(primary.status).toBe('PROPOSED');
    expect(primary.linked_requirements).toContain('REQ-101');
    expect(primary.alternatives_considered.length).toBeGreaterThanOrEqual(1);

    // Verify .agentic/specs/decisions directory
    const decisionsDir = path.join(tempDir, '.agentic', 'specs', 'decisions');
    expect(fs.existsSync(decisionsDir)).toBe(true);

    const files = fs.readdirSync(decisionsDir);
    const adrFile = files.find((f) => f.startsWith('ADR-') && f.endsWith('.md'));
    expect(adrFile).toBeDefined();

    const adrContent = fs.readFileSync(path.join(decisionsDir, adrFile!), 'utf8');
    expect(adrContent).toContain('# ADR-');
    expect(adrContent).toContain('Architectural Probes & Trade-Off Resolutions');
    expect(adrContent).toContain('Verification Criteria');

    // Verify decision ledger JSON
    const ledgerFile = path.join(decisionsDir, 'decision-ledger.json');
    expect(fs.existsSync(ledgerFile)).toBe(true);
    const ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    expect(ledger[primary.id]).toBeDefined();
    expect(ledger[primary.id].title).toBe(primary.title);
  });

  it('ratifies the ADR as ACCEPTED once every probe is answered by a human', () => {
    const raw = 'Implementar autenticacao JWT';
    const probeIds = grillEngine.grill(raw).probes.map((p) => p.id);
    const answers = Object.fromEntries(probeIds.map((id) => [id, `Team decision for ${id}`]));

    const grillResult = grillEngine.grill(raw, {
      userAnswers: answers,
      answeredBy: 'lead@example.com',
    });
    const records = recorder.recordDecisions('RUN-TEST-124', grillResult, { requirementId: 'REQ-102' });

    expect(grillResult.fully_resolved).toBe(true);
    expect(records[0].status).toBe('ACCEPTED');
  });

  it('allocates sequential, non-colliding ADR identifiers', () => {
    const first = recorder.recordDecisions('RUN-A', grillEngine.grill('Primeira decisao'), {
      requirementId: 'REQ-201',
    });
    const second = recorder.recordDecisions('RUN-B', grillEngine.grill('Segunda decisao'), {
      requirementId: 'REQ-202',
    });

    expect(first[0].id).not.toBe(second[0].id);
    const firstNumber = Number(first[0].id.replace('ADR-', ''));
    const secondNumber = Number(second[0].id.replace('ADR-', ''));
    expect(secondNumber).toBe(firstNumber + 1);
  });
});
