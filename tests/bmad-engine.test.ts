import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BmadEngine } from '../src/core/bmad-engine.js';

describe('BmadEngine (BMAD Method Framework)', () => {
  let tempDir: string;
  let bmadEngine: BmadEngine;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmad-test-'));
    fs.mkdirSync(path.join(tempDir, '.agentic', 'prompts'), { recursive: true });
    bmadEngine = new BmadEngine(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should enhance a raw prompt into a structured BMAD Briefing across 4 pillars', () => {
    const raw = 'Criar autenticação JWT com refresh token';
    const briefing = bmadEngine.enhancePrompt(raw, { domain: 'security' });

    expect(briefing.raw_prompt).toBe(raw);
    expect(briefing.title).toContain('Autenticação JWT');
    expect(briefing.business.objective).toContain('robust');
    expect(briefing.business.scope_in.length).toBeGreaterThan(0);
    expect(briefing.business.business_rules.length).toBeGreaterThan(0);

    // Modeling
    expect(briefing.modeling.domain_entities).toContain('User');
    expect(briefing.modeling.domain_entities).toContain('AuthToken');
    expect(briefing.modeling.state_models.length).toBeGreaterThan(0);

    // Architecture
    expect(briefing.architecture.style).toContain('Architecture');
    expect(briefing.architecture.security_boundaries.length).toBeGreaterThan(0);
    expect(briefing.architecture.performance_nfrs.length).toBeGreaterThan(0);

    // Delivery
    expect(briefing.delivery.slices.length).toBeGreaterThanOrEqual(3);
    expect(briefing.delivery.testability_strategy).toContain('TDD');

    // Enhanced Prompt Text
    expect(briefing.enhanced_prompt).toContain('### [BMAD ENHANCED BRIEFING]');
    expect(briefing.enhanced_prompt).toContain('Domain Modeling');
  });

  it('should persist BMAD briefing markdown file in .agentic/prompts', () => {
    const raw = 'Implementar webhook stripe idempotente';
    const briefing = bmadEngine.enhancePrompt(raw);
    const savedPath = bmadEngine.saveBriefing(briefing, 'RUN-TEST-001');

    expect(fs.existsSync(savedPath)).toBe(true);
    const content = fs.readFileSync(savedPath, 'utf8');
    expect(content).toContain('# BMAD Briefing:');
    expect(content).toContain('BMAD (Business, Modeling, Architecture, Delivery)');
    expect(content).toContain('Domain & Data Modeling');
  });

  it('should throw error when prompt is empty or whitespace', () => {
    expect(() => bmadEngine.enhancePrompt('')).toThrow('BMAD prompt instruction cannot be empty.');
    expect(() => bmadEngine.enhancePrompt('   ')).toThrow('BMAD prompt instruction cannot be empty.');
  });
});
