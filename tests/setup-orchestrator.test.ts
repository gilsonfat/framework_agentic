import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { SetupOrchestrator } from '../src/core/setup-orchestrator.js';

describe('SetupOrchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-setup-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should run full automated setup in target directory by default', () => {
    const setup = new SetupOrchestrator(tempDir);
    const result = setup.runFullSetup({ installEngines: false });

    expect(result.scaffoldSuccess).toBe(true);
    expect(result.gitInitialized).toBe(true);
    expect(result.processEngine).toBe('superpowers');
    expect(result.rulesConfigured).toContain('AGENTS.md');
    expect(result.rulesConfigured).toContain('GEMINI.md');
    expect(result.rulesConfigured).toContain('CLAUDE.md');
    expect(result.rulesConfigured).toContain('CODEX.md');

    expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'CODEX.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agents', 'skills', 'agentic', 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.claude', 'commands', 'agentic.md'))).toBe(true);

    expect(fs.existsSync(path.join(tempDir, '.agentic', 'state', 'observed-state.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'state', 'reconciled-state.json'))).toBe(true);
    expect(result.doctorReport.ready).toBe(true);
  });

  it('should allow customizing setup with ECC as the process engine and selective modules', () => {
    const setup = new SetupOrchestrator(tempDir);
    const result = setup.runFullSetup({
      installEngines: false,
      processEngine: 'ecc',
      enableGsd: false,
      enableRuflo: false,
    });

    expect(result.scaffoldSuccess).toBe(true);
    expect(result.processEngine).toBe('ecc');

    // Verify providers.yaml in target project was updated
    const providersPath = path.join(tempDir, '.agentic', 'orchestrator', 'providers.yaml');
    const parsed = YAML.parse(fs.readFileSync(providersPath, 'utf8'));

    expect(parsed.providers.process.engine).toBe('ecc');
    expect(parsed.providers.project_planner.engine).toBe('native-planner');
    expect(parsed.providers.execution.engine).toBe('native-swarm');
    expect(parsed.providers.specification.engine).toBe('tlc-spec-driven');

    // Verify rules mention ECC
    const agentsContent = fs.readFileSync(path.join(tempDir, 'AGENTS.md'), 'utf8');
    expect(agentsContent).toContain('ECC');

    expect(result.doctorReport.ready).toBe(true);
  });

  it('should persist granular preferences (testCommand, executionMode, grillMode, skills, preferences.yaml)', () => {
    const setup = new SetupOrchestrator(tempDir);
    const result = setup.runFullSetup({
      installEngines: false,
      testCommand: 'pnpm vitest run',
      executionMode: 'command',
      grillMode: 'strict',
      skills: ['mattpocock'],
    });

    expect(result.scaffoldSuccess).toBe(true);

    // 1. providers.yaml execution mode
    const providersPath = path.join(tempDir, '.agentic', 'orchestrator', 'providers.yaml');
    const providersParsed = YAML.parse(fs.readFileSync(providersPath, 'utf8'));
    expect(providersParsed.providers.execution.mode).toBe('command');

    // 2. evidence.yaml test command
    const evidencePath = path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml');
    const evidenceParsed = YAML.parse(fs.readFileSync(evidencePath, 'utf8'));
    expect(evidenceParsed.evidence.test_command).toBe('pnpm vitest run');

    // 3. preferences.yaml
    const prefPath = path.join(tempDir, '.agentic', 'orchestrator', 'preferences.yaml');
    expect(fs.existsSync(prefPath)).toBe(true);
    const prefParsed = YAML.parse(fs.readFileSync(prefPath, 'utf8'));
    expect(prefParsed.test_command).toBe('pnpm vitest run');
    expect(prefParsed.execution_mode).toBe('command');
    expect(prefParsed.grill_mode).toBe('strict');
    expect(prefParsed.skills).toEqual(['mattpocock']);
  });
});
