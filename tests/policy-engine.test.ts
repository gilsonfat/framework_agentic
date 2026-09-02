import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { PolicyEngine } from '../src/core/policy-engine.js';
import { runCli } from '../src/cli/cli-runner.js';
import { AgentBridge } from '../src/core/agent-bridge.js';
import { Orchestrator } from '../src/core/orchestrator.js';

describe('PolicyEngine (policies.yaml is enforced, not decorative)', () => {
  let tempDir: string;
  let head: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-policy-'));
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email policy@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Policy', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'README.md'), '# fixture\n', 'utf8');
    execSync('git add -A && git commit -qm init', { cwd: tempDir, stdio: 'ignore' });
    head = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf8' }).trim();
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('change classification', () => {
    it('routes each request to the kind its policies key on', () => {
      const policy = new PolicyEngine(tempDir);

      expect(policy.classify('Criar tabela de produtos com migration').kind).toBe('database_change');
      expect(policy.classify('Refatorar arquitetura em microservicos').kind).toBe('architecture_change');
      expect(policy.classify('Atualizar o README').kind).toBe('documentation_only');
      expect(policy.classify('Extrair helper duplicado').kind).toBe('refactor');
      expect(policy.classify('Corrigir bug no calculo', { complexity: 'S' }).kind).toBe('bugfix_small');
      expect(policy.classify('Criar endpoint de listagem').kind).toBe('feature');
    });

    it('escalates by complexity even without architectural wording', () => {
      expect(new PolicyEngine(tempDir).classify('Reescrever o modulo', { complexity: 'XL' }).kind).toBe(
        'architecture_change'
      );
    });

    it('derives the spec and TDD obligations from policies.yaml', () => {
      const policy = new PolicyEngine(tempDir);

      expect(policy.classificationFor('feature')).toMatchObject({ specRequired: true, tdd: 'required' });
      expect(policy.classificationFor('bugfix_small')).toMatchObject({ specRequired: false, tdd: 'required' });
      expect(policy.classificationFor('documentation_only')).toMatchObject({ specRequired: false, tdd: 'optional' });
      expect(policy.classificationFor('config_only').tdd).toBe('optional');
    });

    it('follows the file when the policy changes', () => {
      const file = path.join(tempDir, '.agentic', 'orchestrator', 'policies.yaml');
      const config = YAML.parse(fs.readFileSync(file, 'utf8'));
      config.policies.tdd.feature = 'optional';
      config.policies.git.atomic_commit_per_task = false;
      fs.writeFileSync(file, YAML.stringify(config), 'utf8');

      const policy = new PolicyEngine(tempDir);
      expect(policy.tddRequirement('feature')).toBe('optional');
      expect(policy.requiresAtomicCommitPerTask()).toBe(false);
    });
  });

  describe('task report verdicts', () => {
    const report = (overrides: Record<string, unknown> = {}) => ({
      taskId: 'TASK-001',
      status: 'completed' as const,
      filesChanged: ['src/a.ts'],
      testsAdded: ['tests/a.test.ts'],
      commit: head,
      ...overrides,
    });

    it('accepts a report that satisfies TDD and the atomic commit rule', () => {
      const policy = new PolicyEngine(tempDir);
      expect(policy.checkTaskReport(report(), policy.classificationFor('feature'))).toEqual([]);
    });

    it('rejects a completed feature with no test', () => {
      const policy = new PolicyEngine(tempDir);
      const violations = policy.checkTaskReport(report({ testsAdded: [] }), policy.classificationFor('feature'));

      expect(violations).toHaveLength(1);
      expect(violations[0].code).toBe('tdd_required');
      expect(violations[0].policy).toBe('policies.tdd.feature');
      expect(violations[0].remedy).toContain('--tests');
    });

    it('rejects a report with no commit, and one whose commit does not exist', () => {
      const policy = new PolicyEngine(tempDir);

      expect(
        policy.checkTaskReport(report({ commit: undefined }), policy.classificationFor('feature'))[0].code
      ).toBe('atomic_commit_required');
      expect(
        policy.checkTaskReport(report({ commit: 'deadbeef' }), policy.classificationFor('feature'))[0].code
      ).toBe('commit_not_found');
    });

    it('does not police a task that reported blocked', () => {
      const policy = new PolicyEngine(tempDir);
      const violations = policy.checkTaskReport(
        report({ status: 'blocked', testsAdded: [], commit: undefined }),
        policy.classificationFor('feature')
      );

      expect(violations).toEqual([]);
    });

    it('leaves documentation-only work alone', () => {
      const policy = new PolicyEngine(tempDir);
      const violations = policy.checkTaskReport(
        report({ testsAdded: [] }),
        policy.classificationFor('documentation_only')
      );

      expect(violations.map((v) => v.code)).toEqual([]);
    });
  });

  describe('spec_required', () => {
    it('blocks a feature with no specification and allows one with a spec', () => {
      const policy = new PolicyEngine(tempDir);
      const classification = policy.classificationFor('feature');

      expect(policy.checkSpecRequirement(classification, { hasSpec: false })[0].code).toBe('spec_required');
      expect(policy.checkSpecRequirement(classification, { hasSpec: true })).toEqual([]);
    });

    it('does not require a spec for a small bugfix', () => {
      const policy = new PolicyEngine(tempDir);
      expect(policy.checkSpecRequirement(policy.classificationFor('bugfix_small'), { hasSpec: false })).toEqual([]);
    });
  });

  describe('through the CLI', () => {
    const seedRun = async (changeKind: string) => {
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
        YAML.stringify({ version: 1, evidence: { test_command: 'exit 0' } }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
        YAML.stringify({
          run_id: 'RUN-SEED',
          milestone: 'M01',
          phase: 'P-001',
          goal: 'fixture',
          scope: { include: ['src/**'], exclude: [] },
          requirements: ['REQ-001'],
          change_kind: changeKind,
          dependencies: [],
          risks: [],
          blockers: [],
          complexity: 'S',
          expected_domains: ['backend'],
        }),
        'utf8'
      );
      // A planned spec, so spec_required does not block the dispatch.
      fs.writeFileSync(path.join(tempDir, '.agentic', 'specs', 'planned', 'SPEC-001.md'), '# REQ-001\n', 'utf8');
      return new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
    };

    it('refuses a report that breaks TDD, and records the reason', async () => {
      const run = await seedRun('feature');
      expect(run.status).toBe('AWAITING_AGENT');

      const errors: string[] = [];
      const spy = console.error;
      console.error = (...args: unknown[]) => void errors.push(args.join(' '));
      const code = await runCli(
        ['node', 'agentic', 'report', 'TASK-001', '--status', 'completed', '--commit', head],
        tempDir
      );
      console.error = spy;

      expect(code).toBe(1);
      expect(errors.join('\n')).toContain('policies.tdd.feature');
      // Nothing was recorded.
      expect(new AgentBridge(tempDir).collectResults(run.run_id, ['TASK-001'])).toEqual([]);
    });

    it('accepts the same report once the tests are declared', async () => {
      const run = await seedRun('feature');

      const code = await runCli(
        [
          'node',
          'agentic',
          'report',
          'TASK-001',
          '--status',
          'completed',
          '--tests',
          'tests/a.test.ts',
          '--commit',
          head,
        ],
        tempDir
      );

      expect(code).toBe(0);
      expect(new AgentBridge(tempDir).collectResults(run.run_id, ['TASK-001'])).toHaveLength(1);
    });

    it('allows a deliberate override and keeps the violation on record', async () => {
      const run = await seedRun('feature');

      const code = await runCli(
        ['node', 'agentic', 'report', 'TASK-001', '--status', 'completed', '--commit', head, '--force'],
        tempDir
      );

      expect(code).toBe(0);
      const [result] = new AgentBridge(tempDir).collectResults(run.run_id, ['TASK-001']);
      expect(result.notes?.join(' ')).toContain('POLICY OVERRIDE');
    });
  });
});
