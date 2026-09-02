import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { SkillRegistry } from '../src/core/skill-registry.js';
import { AgentBridge } from '../src/core/agent-bridge.js';
import { TaskCompiler } from '../src/core/task-compiler.js';
import { Executor } from '../src/core/executor.js';
import { Doctor } from '../src/core/doctor.js';
import { TaskDAGNode } from '../src/types/task.js';

describe('SkillRegistry (mattpocock/skills pack)', () => {
  let tempDir: string;

  const installPack = () => {
    // The installer materializes the skills as directories; detection must look
    // at the filesystem, not at configuration.
    fs.mkdirSync(path.join(tempDir, '.agents', 'skills', 'to-spec'), { recursive: true });
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-skills-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore: only the doctor assertions depend on git being present
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ships the mattpocock pack mapped across the cycle stages', () => {
    const packs = new SkillRegistry(tempDir).listPacks();
    const pack = packs.find((p) => p.id === 'mattpocock');

    expect(pack).toBeDefined();
    expect(pack?.source).toBe('mattpocock/skills');
    expect(pack?.enabled).toBe(true);
    expect(pack?.installCommands).toContain('claude plugins install mattpocock-skills');
    expect(pack?.installCommands).toContain('npx skills@latest add mattpocock/skills');
    expect(pack?.postInstall).toBe('/setup-matt-pocock-skills');
    expect(pack?.stagesCovered).toContain('implement');
    expect(pack?.stagesCovered).toContain('review');
    expect(pack?.stagesCovered).toContain('specify');
  });

  it('reports the pack as missing until it is actually on disk', () => {
    expect(new SkillRegistry(tempDir).statusOf('mattpocock').installed).toBe(false);

    installPack();
    const status = new SkillRegistry(tempDir).statusOf('mattpocock');
    expect(status.installed).toBe(true);
    expect(status.detectedAt).toContain('to-spec');
  });

  it('resolves the stage skills, flagging availability honestly', () => {
    const missing = new SkillRegistry(tempDir).forStage('implement');
    expect(missing.map((r) => r.skill)).toEqual(['implement', 'tdd']);
    expect(missing.every((r) => r.installed)).toBe(false);
    expect(missing[0].invocation).toBe('/implement');

    // Nothing installed means nothing to invoke.
    expect(new SkillRegistry(tempDir).forStage('implement', { onlyInstalled: true })).toEqual([]);

    installPack();
    const available = new SkillRegistry(tempDir).forStage('review', { onlyInstalled: true });
    expect(available.map((r) => r.invocation)).toEqual(['/code-review']);
  });

  it('adds domain-specific skills on top of the stage skills', () => {
    installPack();
    const registry = new SkillRegistry(tempDir);

    const frontend = registry.forStage('implement', { domain: 'frontend' }).map((r) => r.skill);
    expect(frontend).toEqual(['implement', 'tdd', 'prototype']);

    const backend = registry.forStage('implement', { domain: 'backend' }).map((r) => r.skill);
    expect(backend).toEqual(['implement', 'tdd']);
  });

  it('carries the disambiguation note for skills that collide with framework commands', () => {
    const probe = new SkillRegistry(tempDir).forStage('probe').find((r) => r.skill === 'grill-me');
    expect(probe?.note).toContain('/agentic-grill');
  });

  it('reports stage coverage for diagnostics', () => {
    const before = new SkillRegistry(tempDir).coverage();
    expect(before.installedPacks).toEqual([]);
    expect(before.covered).toEqual([]);
    expect(before.uncovered).toContain('implement');

    installPack();
    const after = new SkillRegistry(tempDir).coverage();
    expect(after.installedPacks).toEqual(['mattpocock']);
    expect(after.covered).toContain('implement');
    expect(after.uncovered).toEqual([]);
  });

  it('honours a disabled pack', () => {
    installPack();
    const skillsFile = path.join(tempDir, '.agentic', 'orchestrator', 'skills.yaml');
    const config = YAML.parse(fs.readFileSync(skillsFile, 'utf8'));
    config.packs.mattpocock.enabled = false;
    fs.writeFileSync(skillsFile, YAML.stringify(config), 'utf8');

    const registry = new SkillRegistry(tempDir);
    expect(registry.forStage('implement')).toEqual([]);
    expect(registry.coverage().installedPacks).toEqual([]);
    expect(registry.statusOf('mattpocock').enabled).toBe(false);
  });

  it('falls back to an empty registry when no skills.yaml exists', () => {
    fs.unlinkSync(path.join(tempDir, '.agentic', 'orchestrator', 'skills.yaml'));
    const registry = new SkillRegistry(tempDir);

    expect(registry.listPacks()).toEqual([]);
    expect(registry.forStage('implement')).toEqual([]);
    expect(registry.renderPromptSection('implement')).toBe('');
  });

  describe('prompt pack injection', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Build the product list endpoint',
        domain: 'frontend',
        requirements: ['REQ-001'],
        acceptance_criteria: ['AC-001.1'],
        dependencies: [],
        ownership: { write: ['src/products/**'] },
      },
    ];

    const dispatch = () => {
      const dag = new TaskCompiler(tempDir).compile(nodes);
      const contracts = nodes.map((node) => new Executor(tempDir).createTaskContract(node));
      return new AgentBridge(tempDir).dispatch({
        runId: 'RUN-SKILLS',
        dag,
        contracts,
        goal: 'Deliver the product list',
      });
    };

    it('tells the agent which installed skill to use for this step', () => {
      installPack();
      const result = dispatch();
      const pack = fs.readFileSync(path.join(tempDir, result.dispatched[0].prompt_file), 'utf8');

      expect(pack).toContain('## 8. Skills To Use (implementation)');
      expect(pack).toContain('Installed and expected for this step:');
      expect(pack).toContain('`/tdd`');
      expect(pack).toContain('`/prototype`'); // frontend domain extra
      expect(pack).toContain('## 9. Skills To Use (when a test will not go green)');
      expect(pack).toContain('`/diagnosing-bugs`');
    });

    it('never tells the agent to invoke a skill that is not installed', () => {
      const result = dispatch();
      const pack = fs.readFileSync(path.join(tempDir, result.dispatched[0].prompt_file), 'utf8');

      expect(pack).toContain('Not installed on this machine');
      expect(pack).not.toContain('Installed and expected for this step');
    });
  });

  it('surfaces the pack in doctor as a warning, never as a failure', () => {
    const report = new Doctor(tempDir).runDiagnostics();
    const check = report.checks.find((c) => c.name === 'Skill pack: mattpocock');

    expect(check?.status).toBe('WARN');
    expect(check?.details).toContain('claude plugins install mattpocock-skills');
    // A missing technique pack degrades the run; it must not block the project.
    expect(report.checks.some((c) => c.status === 'FAIL')).toBe(false);

    installPack();
    const installedReport = new Doctor(tempDir).runDiagnostics();
    expect(installedReport.checks.find((c) => c.name === 'Skill pack: mattpocock')?.status).toBe('PASS');
  });
});
