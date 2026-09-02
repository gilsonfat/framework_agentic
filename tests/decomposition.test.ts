import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { PromptOrchestrator } from '../src/core/prompt-orchestrator.js';
import { WorktreeManager } from '../src/core/worktree-manager.js';

/**
 * Until now every run produced exactly one task, so the DAG, the waves and the
 * write-conflict detection were implemented but never exercised by a real flow.
 */
describe('Decomposition, waves and worktree isolation', () => {
  let tempDir: string;

  const setPolicy = (mutate: (config: Record<string, never>) => void) => {
    const file = path.join(tempDir, '.agentic', 'orchestrator', 'policies.yaml');
    const config = YAML.parse(fs.readFileSync(file, 'utf8'));
    mutate(config);
    fs.writeFileSync(file, YAML.stringify(config), 'utf8');
  };

  const writeWorkPackage = (overrides: Record<string, unknown>) => {
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
      YAML.stringify({
        run_id: 'RUN-SEED',
        milestone: 'M01',
        phase: 'P-001',
        goal: 'Deliver the epic',
        scope: { include: ['src/**'], exclude: [] },
        requirements: [],
        change_kind: 'feature',
        dependencies: [],
        risks: [],
        blockers: [],
        complexity: 'M',
        expected_domains: ['backend'],
        ...overrides,
      }),
      'utf8'
    );
    fs.writeFileSync(path.join(tempDir, '.agentic', 'specs', 'planned', 'SPEC-001.md'), '# REQ-001 REQ-002\n', 'utf8');
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-dag-flow-'));
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email dag@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Dag', { cwd: tempDir, stdio: 'ignore' });
    fs.mkdirSync(path.join(tempDir, 'apps', 'api'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'apps', 'web'), { recursive: true });
    fs.writeFileSync(path.join(tempDir, 'apps', 'api', 'package.json'), '{"name":"api"}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'apps', 'web', 'package.json'), '{"name":"web"}', 'utf8');
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"mono","scripts":{"test":"exit 0"}}', 'utf8');
    execSync('git add -A && git commit -qm init', { cwd: tempDir, stdio: 'ignore' });

    new Scaffolder().scaffold(tempDir, { autoObserve: false });
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
      YAML.stringify({ version: 1, evidence: { test_command: 'exit 0' } }),
      'utf8'
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      try {
        new WorktreeManager(tempDir).cleanup({ force: true });
      } catch {
        // best effort
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('compiles one task per slice and keeps independent slices in the same wave', async () => {
    writeWorkPackage({
      requirements: ['REQ-001', 'REQ-002'],
      slices: [
        { requirement: 'REQ-001', title: 'API endpoint', domain: 'backend', scope: ['apps/api/**'], depends_on: [] },
        { requirement: 'REQ-002', title: 'Web screen', domain: 'frontend', scope: ['apps/web/**'], depends_on: [] },
      ],
    });

    const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', noWorktrees: true });

    expect(run.dag?.nodes).toHaveLength(2);
    expect(run.dag?.parallel_groups).toEqual([['TASK-001', 'TASK-002']]);
    expect(run.dag?.conflicts).toEqual([]);

    // Each task owns only its own module.
    expect(run.dag?.nodes[0].ownership.write).toEqual(['apps/api/**']);
    expect(run.dag?.nodes[1].ownership.write).toEqual(['apps/web/**']);
    expect(run.dag?.nodes[1].domain).toBe('frontend');
  });

  it('serializes slices whose write paths collide instead of racing them', async () => {
    writeWorkPackage({
      requirements: ['REQ-001', 'REQ-002'],
      slices: [
        { requirement: 'REQ-001', title: 'Repository', scope: ['apps/api/**'], depends_on: [] },
        { requirement: 'REQ-002', title: 'Handler', scope: ['apps/api/**'], depends_on: [] },
      ],
    });

    const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', noWorktrees: true });

    // Declared as independent, but they write the same paths: two waves.
    expect(run.dag?.parallel_groups).toEqual([['TASK-001'], ['TASK-002']]);
    expect(run.dag?.nodes[1].dependencies).toContain('TASK-001');
  });

  it('honours declared dependencies between slices', async () => {
    writeWorkPackage({
      requirements: ['REQ-001', 'REQ-002'],
      slices: [
        { requirement: 'REQ-001', title: 'Migration', scope: ['apps/api/db/**'], depends_on: [] },
        { requirement: 'REQ-002', title: 'Endpoint', scope: ['apps/web/**'], depends_on: ['REQ-001'] },
      ],
    });

    const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', noWorktrees: true });

    expect(run.dag?.parallel_groups).toEqual([['TASK-001'], ['TASK-002']]);
    expect(run.dag?.nodes[1].dependencies).toEqual(['TASK-001']);
  });

  describe('worktree isolation', () => {
    it('creates an isolated checkout per task when a wave runs in parallel', async () => {
      writeWorkPackage({
        requirements: ['REQ-001', 'REQ-002'],
        slices: [
          { requirement: 'REQ-001', title: 'API', scope: ['apps/api/**'], depends_on: [] },
          { requirement: 'REQ-002', title: 'Web', scope: ['apps/web/**'], depends_on: [] },
        ],
      });

      const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
      const worktrees = new WorktreeManager(tempDir).list();

      expect(worktrees).toHaveLength(2);
      expect(fs.existsSync(worktrees[0].directory)).toBe(true);

      const pack = fs.readFileSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'TASK-001.md'), 'utf8');
      expect(pack).toContain('Where To Work (isolated checkout)');
      expect(pack).toContain(worktrees[0].branch);

      const index = fs.readFileSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'INDEX.md'), 'utf8');
      expect(index).toContain('isolated checkout');
      expect(run.dispatch).toBeDefined();
    });

    it('does not create worktrees for a single-task wave', async () => {
      writeWorkPackage({ requirements: ['REQ-001'] });

      await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
      expect(new WorktreeManager(tempDir).list()).toEqual([]);
    });

    it('respects --no-worktrees and the policy switch', async () => {
      writeWorkPackage({
        requirements: ['REQ-001', 'REQ-002'],
        slices: [
          { requirement: 'REQ-001', title: 'API', scope: ['apps/api/**'], depends_on: [] },
          { requirement: 'REQ-002', title: 'Web', scope: ['apps/web/**'], depends_on: [] },
        ],
      });

      await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', noWorktrees: true });
      expect(new WorktreeManager(tempDir).list()).toEqual([]);

      setPolicy((config: never) => {
        (config as unknown as { policies: { worktree: { parallel_agents: string } } }).policies.worktree.parallel_agents =
          'optional';
      });
      await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', resume: false });
      expect(new WorktreeManager(tempDir).list()).toEqual([]);
    });

    it('cleans up the checkouts it created', async () => {
      writeWorkPackage({
        requirements: ['REQ-001', 'REQ-002'],
        slices: [
          { requirement: 'REQ-001', title: 'API', scope: ['apps/api/**'], depends_on: [] },
          { requirement: 'REQ-002', title: 'Web', scope: ['apps/web/**'], depends_on: [] },
        ],
      });
      await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });

      const manager = new WorktreeManager(tempDir);
      const directories = manager.list().map((w) => w.directory);
      const result = manager.cleanup({ force: true });

      expect(result.removed.sort()).toEqual(['TASK-001', 'TASK-002']);
      expect(directories.every((dir) => !fs.existsSync(dir))).toBe(true);
      expect(manager.list()).toEqual([]);
    });

    it('reports why isolation is unavailable instead of failing the dispatch', () => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-nogit-'));
      try {
        const manager = new WorktreeManager(bare);
        expect(manager.isSupported().ok).toBe(false);

        const result = manager.ensure('RUN-X', ['TASK-001']);
        expect(result.worktrees).toEqual([]);
        expect(result.skipped[0].reason).toContain('git');
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });
  });

  describe('through the prompt orchestrator', () => {
    it('turns --split slices into requirements, specs and parallel tasks', async () => {
      const run = await new PromptOrchestrator(tempDir).dispatchPrompt('Entregar checkout completo', {
        slices: ['criar endpoint no modulo api', 'criar tela no modulo web'],
        parallelSlices: true,
        noWorktrees: true,
      });

      expect(run.work_package.slices).toHaveLength(2);
      expect(run.work_package.requirements).toHaveLength(2);
      expect(run.dag?.nodes).toHaveLength(2);
      expect(run.dag?.parallel_groups).toEqual([['TASK-001', 'TASK-002']]);

      // Each slice got its own contract and its own module scope.
      const planned = fs.readdirSync(path.join(tempDir, '.agentic', 'specs', 'planned'));
      expect(planned.filter((f) => f.startsWith('SPEC-')).length).toBeGreaterThanOrEqual(2);
      expect(run.dag?.nodes[0].ownership.write).toEqual(['apps/api/**']);
      expect(run.dag?.nodes[1].ownership.write).toEqual(['apps/web/**']);
    });

    it('chains slices sequentially unless --parallel is given', async () => {
      const run = await new PromptOrchestrator(tempDir).dispatchPrompt('Entregar checkout completo', {
        slices: ['criar endpoint no modulo api', 'criar tela no modulo web'],
        noWorktrees: true,
      });

      expect(run.dag?.parallel_groups).toEqual([['TASK-001'], ['TASK-002']]);
    });

    it('records the change classification on the work package', async () => {
      const run = await new PromptOrchestrator(tempDir).dispatchPrompt('Criar tabela de pedidos com migration', {
        noWorktrees: true,
      });

      expect(run.work_package.change_kind).toBe('database_change');
    });
  });

  it('blocks a feature that has no specification at all', async () => {
    // No planned spec, no spec kit doc: policies.spec_required.feature applies.
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
      YAML.stringify({
        run_id: 'RUN-SEED',
        milestone: 'M01',
        phase: 'P-009',
        goal: 'Criar endpoint de listagem',
        scope: { include: ['src/**'], exclude: [] },
        requirements: ['REQ-777'],
        dependencies: [],
        risks: [],
        blockers: [],
        complexity: 'S',
        expected_domains: ['backend'],
      }),
      'utf8'
    );

    const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-009' });

    expect(run.status).toBe('BLOCKED');
    expect(run.blockers?.join(' ')).toContain('policies.spec_required.feature');
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'TASK-001.md'))).toBe(false);
  });
});
