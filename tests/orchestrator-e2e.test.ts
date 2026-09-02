import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { Orchestrator } from '../src/core/orchestrator.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { AgentBridge } from '../src/core/agent-bridge.js';
import { Verifier } from '../src/core/verifier.js';
import { GateKeeper } from '../src/core/gate-keeper.js';
import { TeamCoordinator } from '../src/core/team.js';

/**
 * These tests encode the central behavioural contract of the cycle:
 * the orchestrator prepares and enforces, an agent implements, and closure
 * happens only against executed evidence.
 */
describe('Orchestrator delivery cycle', () => {
  let tempDir: string;

  const writeWorkPackage = (overrides: Record<string, unknown> = {}) => {
    const workPackage = {
      run_id: 'RUN-SEED',
      milestone: 'M01',
      phase: 'P-001',
      goal: 'Deliver the seeded requirement',
      scope: { include: ['src/**'], exclude: [] },
      requirements: ['REQ-001'],
      dependencies: [],
      risks: [],
      blockers: [],
      complexity: 'S',
      expected_domains: ['backend'],
      human_gate_required: false,
      ...overrides,
    };
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'planning', 'current-work-package.yaml'),
      YAML.stringify(workPackage),
      'utf8'
    );
  };

  const configureEvidence = (command: string) => {
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
      YAML.stringify({ version: 1, evidence: { test_command: command, timeout_ms: 60000, output_tail_chars: 2000 } }),
      'utf8'
    );
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-e2e-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: true });
    writeWorkPackage();
    configureEvidence('exit 0');
  });

  afterEach(() => {
    delete process.env.AGENTIC_ACTOR;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('parks in AWAITING_AGENT after dispatching prompt packs instead of faking implementation', async () => {
    const result = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });

    expect(result.run_id).toMatch(/^RUN-/);
    expect(result.status).toBe('AWAITING_AGENT');
    expect(result.verification).toBeUndefined();
    expect(result.dag?.nodes.length).toBeGreaterThan(0);

    const inbox = path.join(tempDir, '.agentic', 'execution', 'inbox');
    expect(fs.existsSync(path.join(inbox, 'INDEX.md'))).toBe(true);
    expect(fs.existsSync(path.join(inbox, 'TASK-001.md'))).toBe(true);

    const promptPack = fs.readFileSync(path.join(inbox, 'TASK-001.md'), 'utf8');
    expect(promptPack).toContain('Ownership Boundaries');
    expect(promptPack).toContain('AC-001.1');
    expect(promptPack).toContain('agentic report TASK-001');

    // Nothing may be closed at this point.
    expect(new Verifier(tempDir).getRequirementMatrix()).toEqual({});
  });

  it('refuses to close the cycle while tasks have not been reported', async () => {
    const orchestrator = new Orchestrator(tempDir);
    const dispatched = await orchestrator.runCycle({ phaseId: 'P-001' });

    const closed = await orchestrator.closeCycle(dispatched, {});
    expect(closed.status).toBe('AWAITING_AGENT');
    expect(closed.blockers?.join(' ')).toContain('no reported result');
  });

  it('closes the cycle with executed evidence once the agent reports its tasks', async () => {
    const orchestrator = new Orchestrator(tempDir);
    const dispatched = await orchestrator.runCycle({ phaseId: 'P-001' });

    new AgentBridge(tempDir).recordResult({
      runId: dispatched.run_id,
      taskId: 'TASK-001',
      status: 'completed',
      filesChanged: ['src/auth/login.ts'],
      testsAdded: ['tests/login.test.ts'],
      commit: 'abc1234',
    });

    const closed = await orchestrator.closeCycle(dispatched, {});

    expect(closed.status).toBe('COMPLETE');
    expect(closed.verification?.status).toBe('PASS');
    expect(closed.evidence?.source).toBe('executed');
    expect(closed.evidence?.exit_code).toBe(0);

    const entry = new Verifier(tempDir).getRequirementMatrix()['REQ-001'];
    expect(entry.verified).toBe(true);
    expect(entry.evidence).toBe(closed.evidence?.id);

    const asBuiltDir = path.join(tempDir, '.agentic', 'specs', 'as-built', 'P-001');
    expect(fs.existsSync(asBuiltDir)).toBe(true);

    const declared = JSON.parse(
      fs.readFileSync(path.join(tempDir, '.agentic', 'state', 'declared-state.json'), 'utf8')
    );
    expect(declared.requirements['REQ-001'].status).toBe('done');
  });

  it('refuses closure when the test suite fails', async () => {
    configureEvidence('exit 1');
    const orchestrator = new Orchestrator(tempDir);
    const dispatched = await orchestrator.runCycle({ phaseId: 'P-001' });

    new AgentBridge(tempDir).recordResult({
      runId: dispatched.run_id,
      taskId: 'TASK-001',
      status: 'completed',
      commit: 'abc1234',
    });

    const closed = await orchestrator.closeCycle(dispatched, {});
    expect(closed.status).toBe('REMEDIATING');
    expect(closed.verification?.status).toBe('FAIL');
    expect(closed.remediations?.length).toBeGreaterThan(0);
    expect(new Verifier(tempDir).getRequirementMatrix()['REQ-001']).toBeUndefined();
  });

  it('blocks the run behind a human gate for security work', async () => {
    writeWorkPackage({ expected_domains: ['security'], phase: 'P-002' });

    const result = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-002' });
    expect(result.status).toBe('HUMAN_GATE');

    const pending = new GateKeeper(tempDir).listPending();
    expect(pending.length).toBeGreaterThan(0);
    expect(result.blockers?.join(' ')).toContain('agentic gate approve');

    // No prompt pack is dispatched while the gate is pending.
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'TASK-001.md'))).toBe(false);
  });

  it('refuses to run a phase claimed by a teammate, and honours --force', async () => {
    // Simulate a teammate holding the phase.
    process.env.AGENTIC_ACTOR = 'teammate@example.com';
    new TeamCoordinator(tempDir).claim('P-001', { note: 'already working on it' });
    delete process.env.AGENTIC_ACTOR;

    const blocked = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001' });
    expect(blocked.status).toBe('BLOCKED');
    expect(blocked.blockers?.join(' ')).toContain('teammate@example.com');
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'TASK-001.md'))).toBe(false);

    const forced = await new Orchestrator(tempDir).runCycle({ phaseId: 'P-001', force: true, resume: false });
    expect(forced.status).toBe('AWAITING_AGENT');
  });

  it('resumes a parked run instead of starting a new one', async () => {
    const orchestrator = new Orchestrator(tempDir);
    const first = await orchestrator.runCycle({ phaseId: 'P-001' });

    new AgentBridge(tempDir).recordResult({
      runId: first.run_id,
      taskId: 'TASK-001',
      status: 'completed',
      commit: 'abc1234',
    });

    const resumed = await orchestrator.runCycle({});
    expect(resumed.run_id).toBe(first.run_id);
    expect(resumed.status).toBe('COMPLETE');
  });
});
