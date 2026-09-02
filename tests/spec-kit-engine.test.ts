import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SpecEngine } from '../src/core/spec-engine.js';

describe('SpecEngine (GitHub Spec Kit & TLC Integration)', () => {
  let tempDir: string;
  let specEngine: SpecEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spec-kit-test-'));
    specEngine = new SpecEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate a complete GitHub Spec Kit document from the request', () => {
    const raw = 'Implementar rota de autenticação JWT';
    const doc = specEngine.generateGitHubSpecKit({
      reqId: 'REQ-456',
      phaseId: 'P-456',
      milestone: 'M01',
      promptText: raw,
      title: 'Rota de autenticação JWT',
    });

    expect(doc.title).toBe('Rota de autenticação JWT');
    expect(doc.overview.problem_statement).toContain(raw);

    expect(doc.spec_id).toBe('SPEC-456');
    expect(doc.status).toBe('PLANNED');
    expect(doc.overview.problem_statement).toBeDefined();
    expect(doc.contracts.inputs.length).toBeGreaterThan(0);
    expect(doc.contracts.outputs.length).toBeGreaterThan(0);
    expect(doc.contracts.error_envelopes.length).toBeGreaterThan(0);

    // Requirements & Acceptance Criteria
    expect(doc.requirements.length).toBe(1);
    const req = doc.requirements[0];
    expect(req.id).toBe('REQ-456');
    expect(req.acceptance_criteria.length).toBeGreaterThanOrEqual(3);
    expect(req.scenarios.length).toBeGreaterThanOrEqual(2);
    expect(req.scenarios[0].given).toBeDefined();
    expect(req.scenarios[0].when).toBeDefined();
    expect(req.scenarios[0].then).toBeDefined();

    // Render markdown and save
    const savedPath = specEngine.saveGitHubSpecKit(doc);
    expect(fs.existsSync(savedPath)).toBe(true);

    const content = fs.readFileSync(savedPath, 'utf8');
    expect(content).toContain('# GitHub Spec Kit:');
    expect(content).toContain('Acceptance Criteria Matrix');
    expect(content).toContain('Scenario Trees (Given-When-Then)');
    expect(content).toContain('Interface Contracts');
  });

  it('should validate requirement IDs and AC IDs correctly', () => {
    expect(specEngine.validateRequirementId('REQ-001')).toBe(true);
    expect(specEngine.validateRequirementId('REQ-AUTH-JWT')).toBe(true);
    expect(specEngine.validateRequirementId('INVALID-001')).toBe(false);

    expect(specEngine.validateAcceptanceCriteriaId('AC-001.1')).toBe(true);
    expect(specEngine.validateAcceptanceCriteriaId('AC-AUTH.2')).toBe(true);
    expect(specEngine.validateAcceptanceCriteriaId('INVALID-AC')).toBe(false);
  });
});
