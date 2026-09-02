import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { AgentIntegrations } from '../src/core/agent-integrations.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { MilestoneManager } from '../src/core/milestone-manager.js';
import { PlanningIngestor } from '../src/core/planning-ingestor.js';
import { Doctor } from '../src/core/doctor.js';

/**
 * Adoption in a repository that already exists is the hardest case: it has its
 * own history, its own instructions and its own plan, and none of it may be
 * destroyed or silently ignored.
 */
describe('Brownfield adoption', () => {
  let tempDir: string;

  const read = (relative: string) => fs.readFileSync(path.join(tempDir, relative), 'utf8');

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-brownfield-'));
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dev@empresa.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Dev', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"loja","scripts":{"test":"exit 0"}}', 'utf8');
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('instruction files the team already owns', () => {
    const houseRules = '# Regras da casa\n\nConventional commits. Nunca commite direto na main.\n';

    beforeEach(() => {
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), houseRules, 'utf8');
    });

    it('appends the protocol instead of overwriting or skipping', () => {
      const results = new AgentIntegrations(tempDir).install({
        processEngine: 'superpowers',
        products: ['antigravity'],
      });

      const agentsFile = results[0].files.find((f) => f.path === 'AGENTS.md');
      expect(agentsFile?.action).toBe('appended');

      const content = read('AGENTS.md');
      expect(content).toContain('Regras da casa');
      expect(content).toContain('Conventional commits');
      expect(content).toContain('BEGIN AGENTIC SDLC PROTOCOL');
      expect(content).toContain('agentic verify');
    });

    it('is idempotent: repeated syncs neither duplicate the block nor delete the house rules', () => {
      const integrations = new AgentIntegrations(tempDir);
      for (let i = 0; i < 3; i++) {
        integrations.install({ processEngine: 'superpowers', products: ['antigravity', 'codex'] });
      }

      const content = read('AGENTS.md');
      expect(content.match(/BEGIN AGENTIC SDLC PROTOCOL/g)).toHaveLength(1);
      expect(content).toContain('Regras da casa');
    });

    it('refreshes the block in place when the protocol changes', () => {
      const integrations = new AgentIntegrations(tempDir);
      integrations.install({ processEngine: 'superpowers', products: ['antigravity'] });
      expect(read('AGENTS.md')).toContain('Superpowers');

      integrations.install({ processEngine: 'ecc', products: ['antigravity'] });
      const content = read('AGENTS.md');

      expect(content).toContain('ECC');
      expect(content).not.toContain('Strict TDD (Superpowers)');
      expect(content.match(/BEGIN AGENTIC SDLC PROTOCOL/g)).toHaveLength(1);
      expect(content).toContain('Regras da casa');
    });

    it('still regenerates a file the framework itself wrote', () => {
      const integrations = new AgentIntegrations(tempDir);
      integrations.install({ processEngine: 'superpowers', products: ['claude'] });

      // CLAUDE.md is ours end to end: no marker, full rules, regenerated wholesale.
      expect(read('CLAUDE.md')).toContain('AGENTIC SDLC ORCHESTRATOR');
      expect(read('CLAUDE.md')).not.toContain('BEGIN AGENTIC SDLC PROTOCOL');

      const second = integrations.install({ processEngine: 'ecc', products: ['claude'] });
      expect(second[0].files.find((f) => f.path === 'CLAUDE.md')?.action).toBe('updated');
    });

    it('reports a product as partial - never wired - while its file carries no protocol', () => {
      const integrations = new AgentIntegrations(tempDir);
      // Only Codex's second file is written, so AGENTS.md stays as the team wrote it.
      fs.writeFileSync(path.join(tempDir, 'CODEX.md'), '# nosso codex\n', 'utf8');

      const before = integrations.status().find((s) => s.definition.id === 'codex');
      expect(before?.state).toBe('partial');
      expect(before?.installed).toBe(false);
      expect(before?.withoutProtocol).toContain('AGENTS.md');

      integrations.install({ processEngine: 'superpowers', products: ['codex'] });

      const after = new AgentIntegrations(tempDir).status().find((s) => s.definition.id === 'codex');
      expect(after?.state).toBe('installed');
      expect(after?.withoutProtocol).toEqual([]);
    });

    it('doctor warns when a wired product loses the protocol', () => {
      new Scaffolder().scaffold(tempDir, { autoObserve: false });
      new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

      // Someone replaces the shared instructions with their own file: the files
      // still exist, so nothing looks broken, but Codex and Antigravity now read
      // nothing about the workflow.
      fs.writeFileSync(path.join(tempDir, 'AGENTS.md'), houseRules, 'utf8');

      const report = new Doctor(tempDir).runDiagnostics();
      const check = report.checks.find((c) => c.name === 'Ungoverned AI products');

      expect(check?.status).toBe('WARN');
      expect(check?.details).toContain('AGENTS.md');
      // A warning, not a failure: the project still works.
      expect(report.checks.some((c) => c.status === 'FAIL')).toBe(false);
    });
  });

  describe('a roadmap the project already had', () => {
    const roadmap = '# Roadmap\n\n- [x] Listagem de pedidos\n- [ ] Detalhe do pedido\n- [ ] Cancelamento\n';

    it('is found at the repository root, not only inside .planning/', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      const ingested = new PlanningIngestor(tempDir).ingest();

      expect(ingested.executedPhases.map((p) => p.name)).toEqual(['Listagem de pedidos']);
      expect(ingested.pendingPhases.map((p) => p.name)).toEqual(['Detalhe do pedido', 'Cancelamento']);
    });

    it('is found under docs/ as well', () => {
      fs.mkdirSync(path.join(tempDir, 'docs'), { recursive: true });
      fs.writeFileSync(path.join(tempDir, 'docs', 'ROADMAP.md'), roadmap, 'utf8');

      expect(new PlanningIngestor(tempDir).ingest().pendingPhases).toHaveLength(2);
    });

    it('becomes phases on the roadmap when the project is initialized', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      new Scaffolder().scaffold(tempDir, { autoObserve: false });

      const progress = new MilestoneManager(tempDir).progress();
      expect(progress.phasesTotal).toBe(3);
      expect(progress.phases.map((p) => p.title)).toEqual([
        'Listagem de pedidos',
        'Detalhe do pedido',
        'Cancelamento',
      ]);
    });

    it('never imports a ticked item as complete: a checkbox is a declaration, not evidence', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      new Scaffolder().scaffold(tempDir, { autoObserve: false });

      const progress = new MilestoneManager(tempDir).progress();
      const imported = progress.phases[0];

      expect(imported.status).toBe('planned');
      expect(imported.declaredComplete).toBe(true);
      expect(progress.phasesComplete).toBe(0);
      // Nothing was closed, so the milestone cannot be closed either.
      expect(progress.readyToClose).toBe(false);
    });

    it('explains why an imported phase cannot advance', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      new Scaffolder().scaffold(tempDir, { autoObserve: false });

      const result = new MilestoneManager(tempDir).advance();
      expect(result.closedPhases).toEqual([]);
      expect(result.blockers.join(' ')).toContain('imported from');
      expect(result.blockers.join(' ')).toContain('agentic prompt');
    });

    it('does not duplicate phases when initialization runs twice', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      new Scaffolder().scaffold(tempDir, { autoObserve: false });
      new Scaffolder().scaffold(tempDir, { autoObserve: false });

      expect(new MilestoneManager(tempDir).progress().phasesTotal).toBe(3);
    });

    it('gives imported phases an id space that cannot collide with allocated ones', () => {
      fs.writeFileSync(path.join(tempDir, 'ROADMAP.md'), roadmap, 'utf8');
      new Scaffolder().scaffold(tempDir, { autoObserve: false });

      const manager = new MilestoneManager(tempDir);
      expect(manager.progress().phases.map((p) => p.phase)).toEqual(['P-L01', 'P-L02', 'P-L03']);

      manager.registerPhase({ phase: 'P-001', title: 'Nova fase', requirements: ['REQ-001'] });
      const ids = manager.progress().phases.map((p) => p.phase);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  it('leaves the existing project untouched', () => {
    fs.mkdirSync(path.join(tempDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, '.github', 'workflows', 'ci.yml'), 'name: CI\non: [push]\n', 'utf8');
    fs.mkdirSync(path.join(tempDir, '.claude'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, '.claude', 'settings.json'),
      JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(npm test)'] } }),
      'utf8'
    );

    new Scaffolder().scaffold(tempDir, { autoObserve: false });
    new AgentIntegrations(tempDir).install({ processEngine: 'superpowers' });

    // Their CI is untouched, and ours is not written over it.
    expect(read('.github/workflows/ci.yml')).toBe('name: CI\non: [push]\n');

    // Their Claude settings are merged, not replaced.
    const settings = JSON.parse(read('.claude/settings.json'));
    expect(settings.model).toBe('opus');
    expect(settings.permissions.allow).toContain('Bash(npm test)');
    expect(settings.permissions.allow.some((rule: string) => rule.includes('agentic'))).toBe(true);
  });
});
