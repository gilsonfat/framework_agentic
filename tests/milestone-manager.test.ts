import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { MilestoneManager } from '../src/core/milestone-manager.js';
import { GateKeeper } from '../src/core/gate-keeper.js';
import { EvidenceCollector } from '../src/core/evidence-collector.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { NextActionResolver } from '../src/core/next-action.js';
import { runCli } from '../src/cli/cli-runner.js';

describe('MilestoneManager (the roadmap advances on evidence)', () => {
  let tempDir: string;

  /** Closes a requirement the way the Verifier does: with a real evidence record. */
  const closeRequirement = (requirement: string, backed = true) => {
    const matrixFile = path.join(tempDir, '.agentic', 'verification', 'requirement-matrix.json');
    const matrix = JSON.parse(fs.readFileSync(matrixFile, 'utf8')) as Record<string, unknown>;

    let evidenceId: string | undefined;
    if (backed) {
      evidenceId = new EvidenceCollector(tempDir).collect({ runId: 'RUN-FIXTURE', command: 'exit 0' }).id;
    }

    matrix[requirement] = {
      implemented: true,
      tested: true,
      verified: true,
      tasks: ['TASK-001'],
      evidence: evidenceId,
    };
    fs.writeFileSync(matrixFile, JSON.stringify(matrix, null, 2), 'utf8');
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-milestone-'));
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email road@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Road', { cwd: tempDir, stdio: 'ignore' });
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('starts with an active milestone even before any roadmap file exists', () => {
    const manager = new MilestoneManager(tempDir);

    expect(manager.currentMilestoneId()).toMatch(/^M-\d+$/);
    expect(manager.currentMilestone().status).toBe('active');
    expect(manager.progress().phasesTotal).toBe(0);
  });

  it('registers a phase and reports its progress against the matrix', () => {
    const manager = new MilestoneManager(tempDir);
    manager.registerPhase({ phase: 'P-001', title: 'Checkout', requirements: ['REQ-001', 'REQ-002'] });

    let progress = manager.progress();
    expect(progress.phasesTotal).toBe(1);
    expect(progress.requirementsTotal).toBe(2);
    expect(progress.requirementsClosed).toBe(0);
    expect(progress.readyToClose).toBe(false);

    closeRequirement('REQ-001');
    progress = manager.progress();
    expect(progress.requirementsClosed).toBe(1);
    expect(progress.readyToClose).toBe(false);
  });

  it('closes a phase only when every requirement is backed by evidence', () => {
    const manager = new MilestoneManager(tempDir);
    manager.registerPhase({ phase: 'P-001', title: 'Checkout', requirements: ['REQ-001', 'REQ-002'] });

    closeRequirement('REQ-001');
    expect(manager.advance().closedPhases).toEqual([]);
    expect(manager.advance().blockers.join(' ')).toContain('1/2 requirements closed');

    closeRequirement('REQ-002');
    const result = manager.advance();
    expect(result.closedPhases).toEqual(['P-001']);
    expect(manager.progress().phases[0].status).toBe('complete');
  });

  it('refuses to advance a phase whose closure has no usable evidence', () => {
    const manager = new MilestoneManager(tempDir);
    manager.registerPhase({ phase: 'P-001', title: 'Checkout', requirements: ['REQ-001'] });

    closeRequirement('REQ-001', false);

    const progress = manager.progress();
    expect(progress.phases[0].requirementsUnbacked).toEqual(['REQ-001']);
    expect(progress.requirementsClosed).toBe(0);

    const result = manager.advance();
    expect(result.closedPhases).toEqual([]);
    expect(result.blockers.join(' ')).toContain('no usable evidence');
  });

  it('closes the milestone once every phase is complete', () => {
    const manager = new MilestoneManager(tempDir);
    manager.registerPhase({ phase: 'P-001', title: 'A', requirements: ['REQ-001'] });
    manager.registerPhase({ phase: 'P-002', title: 'B', requirements: ['REQ-002'] });

    closeRequirement('REQ-001');
    closeRequirement('REQ-002');

    const result = manager.advance();
    expect(result.closedPhases.sort()).toEqual(['P-001', 'P-002']);
    expect(result.closedMilestone).toBe(manager.load().milestones[0].id);
    expect(manager.currentMilestone().status).toBe('complete');
  });

  describe('opening a milestone', () => {
    it('keeps it planned behind the new_milestone gate, then activates it on approval', () => {
      const manager = new MilestoneManager(tempDir);
      const first = manager.currentMilestoneId();

      const opened = manager.open('Segundo milestone', { goal: 'cobranca' });
      expect(opened.gateId).toBeDefined();
      expect(opened.milestone.status).toBe('planned');
      // The current milestone did not change while the gate is pending.
      expect(manager.currentMilestoneId()).toBe(first);

      const blocked = manager.activate(opened.milestone.id);
      expect(blocked.activated).toBe(false);
      expect(blocked.reason).toContain('gate');

      new GateKeeper(tempDir).decide(opened.gateId!, 'APPROVED', 'planejamento aprovado');
      const activated = manager.activate(opened.milestone.id);

      expect(activated.activated).toBe(true);
      expect(manager.currentMilestoneId()).toBe(opened.milestone.id);
    });

    it('activates immediately when the gate is not required', () => {
      const gatesFile = path.join(tempDir, '.agentic', 'orchestrator', 'gates.yaml');
      const gates = YAML.parse(fs.readFileSync(gatesFile, 'utf8'));
      gates.human_gates.new_milestone.required = false;
      fs.writeFileSync(gatesFile, YAML.stringify(gates), 'utf8');

      const manager = new MilestoneManager(tempDir);
      const opened = manager.open('Sem gate');

      expect(opened.gateId).toBeUndefined();
      expect(manager.currentMilestoneId()).toBe(opened.milestone.id);
    });

    it('allocates sequential milestone ids', () => {
      const gatesFile = path.join(tempDir, '.agentic', 'orchestrator', 'gates.yaml');
      const gates = YAML.parse(fs.readFileSync(gatesFile, 'utf8'));
      gates.human_gates.new_milestone.required = false;
      fs.writeFileSync(gatesFile, YAML.stringify(gates), 'utf8');

      const manager = new MilestoneManager(tempDir);
      const a = manager.open('Um').milestone.id;
      const b = manager.open('Dois').milestone.id;

      expect(a).not.toBe(b);
      expect(Number(b.replace('M-', ''))).toBe(Number(a.replace('M-', '')) + 1);
    });
  });

  describe('inside the cycle', () => {
    const seedRun = async () => {
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
        YAML.stringify({ version: 1, evidence: { test_command: 'exit 0' } }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
        YAML.stringify({
          run_id: 'RUN-SEED',
          milestone: 'IGNORED',
          phase: 'P-001',
          goal: 'Entregar a fase',
          scope: { include: ['src/**'], exclude: [] },
          requirements: ['REQ-001'],
          change_kind: 'feature',
          dependencies: [],
          risks: [],
          blockers: [],
          complexity: 'S',
          expected_domains: ['backend'],
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(tempDir, '.agentic', 'specs', 'planned', 'SPEC-001.md'), '# REQ-001\n', 'utf8');
      return new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
    };

    it('registers the phase on the roadmap and stamps the work package with the real milestone', async () => {
      const manager = new MilestoneManager(tempDir);
      const expected = manager.currentMilestoneId();

      const run = await seedRun();

      expect(run.work_package.milestone).toBe(expected);
      expect(manager.currentMilestone().phases.map((p) => p.id)).toContain('P-001');
    });

    it('closes the phase automatically when the run closes with evidence', async () => {
      const run = await seedRun();
      const { AgentBridge } = await import('../src/core/agent-bridge.js');
      new AgentBridge(tempDir).recordResult({
        runId: run.run_id,
        taskId: 'TASK-001',
        status: 'completed',
        commit: 'HEAD',
      });

      const closed = await new Orchestrator(tempDir).closeCycle(run, {});
      expect(closed.status).toBe('COMPLETE');

      const progress = new MilestoneManager(tempDir).progress();
      expect(progress.phases.find((p) => p.phase === 'P-001')?.status).toBe('complete');
    });
  });

  describe('agentic next', () => {
    it('asks for initialization outside a project', () => {
      const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-bare-'));
      try {
        expect(new NextActionResolver(bare).resolve()).toMatchObject({ kind: 'init', command: 'agentic init' });
      } finally {
        fs.rmSync(bare, { recursive: true, force: true });
      }
    });

    it('prioritizes migration over everything else', () => {
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'execution', 'current-run.json'),
        JSON.stringify({ run_id: 'RUN-2026-01-01-0001', status: 'COMPLETE', work_package: {} }),
        'utf8'
      );

      const action = new NextActionResolver(tempDir).resolve();
      expect(action.kind).toBe('migrate');
      expect(action.command).toBe('agentic migrate --apply');
    });

    it('prioritizes a pending gate over pending work', () => {
      new GateKeeper(tempDir).open({ runId: 'RUN-X', gate: 'architecture_change', reason: 'fixture' });

      const action = new NextActionResolver(tempDir).resolve();
      expect(action.kind).toBe('decide_gate');
      expect(action.details.join(' ')).toContain('architecture_change');
    });

    it('points at the awaiting task, then at verification', async () => {
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
        YAML.stringify({ version: 1, evidence: { test_command: 'exit 0' } }),
        'utf8'
      );
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
        YAML.stringify({
          run_id: 'RUN-SEED',
          milestone: 'M-01',
          phase: 'P-001',
          goal: 'fixture',
          scope: { include: ['src/**'], exclude: [] },
          requirements: ['REQ-001'],
          change_kind: 'feature',
          dependencies: [],
          risks: [],
          blockers: [],
          complexity: 'S',
          expected_domains: ['backend'],
        }),
        'utf8'
      );
      fs.writeFileSync(path.join(tempDir, '.agentic', 'specs', 'planned', 'SPEC-001.md'), '# REQ-001\n', 'utf8');

      const run = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
      const awaiting = new NextActionResolver(tempDir).resolve();
      expect(awaiting.kind).toBe('implement');
      expect(awaiting.details.join(' ')).toContain('TASK-001');

      const { AgentBridge } = await import('../src/core/agent-bridge.js');
      new AgentBridge(tempDir).recordResult({
        runId: run.run_id,
        taskId: 'TASK-001',
        status: 'completed',
        commit: 'HEAD',
      });

      const ready = new NextActionResolver(tempDir).resolve();
      expect(ready.kind).toBe('verify');
      expect(ready.autoRunnable).toBe(true);
    });

    it('is the same answer the status dashboard prints', async () => {
      const { StatusDashboard } = await import('../src/core/status.js');
      const action = new NextActionResolver(tempDir).resolve();
      const dashboard = new StatusDashboard(tempDir).getStatusData();

      expect(dashboard.nextAction).toContain(action.summary);
    });
  });

  describe('through the CLI', () => {
    it('reports milestone status and refuses to advance without evidence', async () => {
      new MilestoneManager(tempDir).registerPhase({
        phase: 'P-001',
        title: 'Checkout',
        requirements: ['REQ-001'],
      });

      const out: string[] = [];
      const original = console.log;
      console.log = (...args: unknown[]) => void out.push(args.join(' '));

      expect(await runCli(['node', 'agentic', 'milestone', 'status'], tempDir)).toBe(0);
      expect(await runCli(['node', 'agentic', 'milestone', 'advance'], tempDir)).toBe(0);

      console.log = original;
      const text = out.join('\n');
      expect(text).toContain('P-001');
      expect(text).toContain('Still open');
    });
  });
});
