import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { AgentIntegrations, ALL_PRODUCT_IDS } from '../src/core/agent-integrations.js';
import { SetupOrchestrator } from '../src/core/setup-orchestrator.js';
import { Doctor } from '../src/core/doctor.js';

describe('AgentIntegrations (one workflow, every AI product)', () => {
  let tempDir: string;

  const read = (relative: string) => fs.readFileSync(path.join(tempDir, relative), 'utf8');
  const exists = (relative: string) => fs.existsSync(path.join(tempDir, relative));

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-integrations-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('wires every supported product by default', () => {
    const results = new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    expect(results.map((r) => r.product).sort()).toEqual([...ALL_PRODUCT_IDS].sort());

    // Claude Code
    expect(exists('CLAUDE.md')).toBe(true);
    expect(exists('.claude/commands/agentic.md')).toBe(true);
    expect(exists('.claude/skills/agentic/SKILL.md')).toBe(true);
    expect(exists('.claude/settings.json')).toBe(true);

    // Antigravity
    expect(exists('AGENTS.md')).toBe(true);
    expect(exists('.agents/skills/agentic/SKILL.md')).toBe(true);
    expect(exists('.agents/workflows/agentic.md')).toBe(true);

    // Gemini CLI
    expect(exists('GEMINI.md')).toBe(true);
    expect(exists('.gemini/commands/agentic.toml')).toBe(true);
    expect(exists('.gemini/commands/agentic/verify.toml')).toBe(true);

    // Codex / ChatGPT / editors
    expect(exists('CODEX.md')).toBe(true);
    expect(exists('.agentic/agents/CHATGPT.md')).toBe(true);
    expect(exists('.cursor/rules/agentic.mdc')).toBe(true);
    expect(exists('.github/copilot-instructions.md')).toBe(true);
    expect(exists('.windsurfrules')).toBe(true);
  });

  it('writes only the requested products', () => {
    const results = new AgentIntegrations(tempDir).install({
      processEngine: 'native',
      products: ['gemini', 'codex'],
    });

    expect(results.map((r) => r.product)).toEqual(['gemini', 'codex']);
    expect(exists('GEMINI.md')).toBe(true);
    expect(exists('AGENTS.md')).toBe(true);
    expect(exists('CLAUDE.md')).toBe(false);
    expect(exists('.cursor/rules/agentic.mdc')).toBe(false);
  });

  it('gives each product its own entry point while sharing one protocol', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    expect(read('CLAUDE.md')).toContain('You are running in Claude Code');
    expect(read('GEMINI.md')).toContain('You are running in Gemini CLI');
    expect(read('CODEX.md')).toContain('You are running in OpenAI Codex');
    expect(read('AGENTS.md')).toContain('Google Antigravity');

    // ...but the two-phase protocol and the evidence rule are identical everywhere.
    for (const file of ['CLAUDE.md', 'GEMINI.md', 'CODEX.md', 'AGENTS.md']) {
      expect(read(file)).toContain('agentic prompt');
      expect(read(file)).toContain('agentic verify');
      expect(read(file)).toContain('No requirement is DONE without executed evidence');
    }
  });

  it('keeps always-injected files compact for the editors that read them on every request', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    const compact = read('.github/copilot-instructions.md');
    expect(compact).toContain('Agentic SDLC - Mandatory Workflow');
    expect(compact).toContain('agentic verify');
    // The full rules file is several times larger; this one must stay short.
    expect(compact.length).toBeLessThan(read('AGENTS.md').length);

    const cursorRule = read('.cursor/rules/agentic.mdc');
    expect(cursorRule.startsWith('---')).toBe(true);
    expect(cursorRule).toContain('alwaysApply: true');
  });

  it('produces Gemini commands in the TOML shape the CLI expects', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    const command = read('.gemini/commands/agentic.toml');
    expect(command).toMatch(/^description = ".+"$/m);
    expect(command).toContain('prompt = """');
    expect(command).toContain('{{args}}');
    expect(command).toContain('agentic prompt');
  });

  it('gives ChatGPT a paste-ready bootstrap that never assumes command output', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    const bootstrap = read('.agentic/agents/CHATGPT.md');
    expect(bootstrap).toContain('Paste this whole file');
    expect(bootstrap).toContain('You cannot run commands yourself');
    expect(bootstrap).toContain('agentic report');
  });

  it('merges .claude/settings.json instead of overwriting the user config', () => {
    const settingsPath = path.join(tempDir, '.claude', 'settings.json');
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(npm test)'] } }, null, 2),
      'utf8'
    );

    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers', products: ['claude'] });

    const settings = JSON.parse(read('.claude/settings.json'));
    expect(settings.model).toBe('opus');
    expect(settings.permissions.allow).toContain('Bash(npm test)');
    expect(settings.permissions.allow).toContain('Bash(agentic verify:*)');
    expect(JSON.stringify(settings.hooks)).toContain('agentic status');

    // Running it twice must not duplicate the hook.
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers', products: ['claude'] });
    const again = JSON.parse(read('.claude/settings.json'));
    expect(again.hooks.SessionStart).toHaveLength(1);
  });

  it('does not pre-approve decisions that must stay human', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers', products: ['claude'] });
    const allow: string[] = JSON.parse(read('.claude/settings.json')).permissions.allow;

    expect(allow.some((rule) => rule.includes('gate approve'))).toBe(false);
    expect(allow.some((rule) => rule.includes('gate reject'))).toBe(false);
    expect(allow.some((rule) => rule.includes('team release'))).toBe(false);
    expect(allow).toContain('Bash(agentic gate list)');
  });

  it('honours --without-hooks and --without-permissions', () => {
    new AgentIntegrations(tempDir).install({
      processEngine: 'superpowers',
      products: ['claude'],
      permissions: false,
    });
    expect(exists('.claude/settings.json')).toBe(false);

    new AgentIntegrations(tempDir).install({
      processEngine: 'superpowers',
      products: ['claude'],
      hooks: false,
    });
    const settings = JSON.parse(read('.claude/settings.json'));
    expect(settings.permissions.allow.length).toBeGreaterThan(0);
    expect(settings.hooks).toBeUndefined();
  });

  it('keeps a hand-written instruction file and appends the protocol to it', () => {
    fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), '# Our own house rules\n', 'utf8');

    const first = new AgentIntegrations(tempDir).install({
      processEngine: 'superpowers',
      products: ['antigravity'],
    });
    // Their rules survive, and the product is actually governed: skipping the file
    // would leave Antigravity and Codex reading nothing about the workflow.
    expect(first[0].files.find((f) => f.path === 'AGENTS.md')?.action).toBe('appended');
    expect(read('AGENTS.md')).toContain('# Our own house rules');
    expect(read('AGENTS.md')).toContain('BEGIN AGENTIC SDLC PROTOCOL');

    const forced = new AgentIntegrations(tempDir).install({
      processEngine: 'superpowers',
      products: ['antigravity'],
      force: true,
    });
    expect(forced[0].files.find((f) => f.path === 'AGENTS.md')?.action).toBe('updated');
    expect(read('AGENTS.md')).toContain('AGENTIC SDLC ORCHESTRATOR');
  });

  it('refreshes a file the framework itself generated, without --force', () => {
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers', products: ['antigravity'] });
    const second = new AgentIntegrations(tempDir).install({
      processEngine: 'ecc',
      products: ['antigravity'],
    });

    expect(second[0].files.find((f) => f.path === 'AGENTS.md')?.action).toBe('updated');
    expect(read('AGENTS.md')).toContain('ECC');
  });

  it('reports wiring status per product', () => {
    const integrations = new AgentIntegrations(tempDir);
    expect(integrations.status().every((s) => !s.installed)).toBe(true);

    integrations.install({ processEngine: 'superpowers', products: ['gemini'] });
    const status = new AgentIntegrations(tempDir).status();

    expect(status.find((s) => s.definition.id === 'gemini')?.installed).toBe(true);
    expect(status.find((s) => s.definition.id === 'windsurf')?.installed).toBe(false);
  });

  describe('through the setup orchestrator', () => {
    it('wires every product and reports them in the result', () => {
      const result = new SetupOrchestrator(tempDir).runFullSetup({ installEngines: false, quiet: true });

      expect(result.integrations).toHaveLength(ALL_PRODUCT_IDS.length);
      expect(result.rulesConfigured).toContain('AGENTS.md');
      expect(result.rulesConfigured).toContain('GEMINI.md');
      expect(result.rulesConfigured).toContain('.gemini/commands/agentic.toml');
      expect(result.rulesConfigured).toContain('.claude/skills/agentic/SKILL.md');
      expect(result.doctorReport.ready).toBe(true);
    });

    it('limits the wiring to the selected products', () => {
      const result = new SetupOrchestrator(tempDir).runFullSetup({
        installEngines: false,
        quiet: true,
        products: ['claude'],
      });

      expect(result.integrations.map((i) => i.product)).toEqual(['claude']);
      expect(exists('GEMINI.md')).toBe(false);
      expect(exists('CLAUDE.md')).toBe(true);
    });

    it('surfaces the integrations in doctor', () => {
      new SetupOrchestrator(tempDir).runFullSetup({ installEngines: false, quiet: true });
      const check = new Doctor(tempDir).runDiagnostics().checks.find((c) => c.name === 'AI integrations');

      expect(check?.status).toBe('PASS');
      expect(check?.details).toContain('Claude Code');
      expect(check?.details).toContain('Gemini CLI');
    });

    it('warns when no AI product is wired', () => {
      const report = new Doctor(tempDir).runDiagnostics();
      const check = report.checks.find((c) => c.name === 'AI integrations');

      expect(check?.status).toBe('WARN');
      expect(check?.details).toContain('agentic agents sync');
    });
  });
});
