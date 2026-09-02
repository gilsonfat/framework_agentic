import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { GateKeeper } from '../src/core/gate-keeper.js';
import { AuditLogger } from '../src/core/audit-logger.js';
import { IdRegistry } from '../src/core/id-registry.js';
import { AgentBridge } from '../src/core/agent-bridge.js';
import { TaskCompiler } from '../src/core/task-compiler.js';
import { Executor } from '../src/core/executor.js';
import { WorkPackage, TaskDAGNode } from '../src/types/task.js';

const workPackage: WorkPackage = {
  run_id: 'RUN-GOV',
  milestone: 'M01',
  phase: 'P-010',
  goal: 'Governance fixture',
  scope: { include: ['src/**'], exclude: [] },
  requirements: ['REQ-010'],
  dependencies: [],
  risks: [],
  blockers: [],
  complexity: 'M',
  expected_domains: ['backend'],
};

describe('Governance: gates, audit chain, identifiers and agent handoff', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-gov-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email gov@example.com', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('GateKeeper', () => {
    it('opens a blocking gate for security work and clears it once approved', () => {
      const keeper = new GateKeeper(tempDir);
      const first = keeper.evaluate({
        runId: 'RUN-GOV-1',
        workPackage: { ...workPackage, expected_domains: ['security'] },
      });

      expect(first.blocked).toBe(true);
      expect(first.triggered.length).toBeGreaterThan(0);
      expect(keeper.listPending().length).toBe(first.triggered.length);

      for (const gate of first.triggered) {
        keeper.decide(gate.id, 'APPROVED', 'reviewed by the security lead');
      }

      const second = keeper.evaluate({
        runId: 'RUN-GOV-1',
        workPackage: { ...workPackage, expected_domains: ['security'] },
      });
      expect(second.blocked).toBe(false);
      expect(second.approved.length).toBeGreaterThan(0);
      expect(keeper.listPending()).toEqual([]);
    });

    it('carries an approval forward to later runs of the same risk', () => {
      const keeper = new GateKeeper(tempDir);
      const secure = { ...workPackage, expected_domains: ['security'] };

      const first = keeper.evaluate({ runId: 'RUN-CARRY-1', workPackage: secure });
      for (const gate of first.triggered) {
        keeper.decide(gate.id, 'APPROVED', 'approved once');
      }

      // A brand new run id must not re-open a decided gate, otherwise the gate
      // mechanism loops forever.
      const second = keeper.evaluate({ runId: 'RUN-CARRY-2', workPackage: secure });
      expect(second.blocked).toBe(false);
      expect(second.triggered).toEqual([]);
      expect(second.approved[0].fingerprint).toBe(first.triggered[0].fingerprint);
    });

    it('requires a fresh decision when the underlying risk changes', () => {
      const keeper = new GateKeeper(tempDir);
      const approved = keeper.open({
        runId: 'RUN-RISK-1',
        gate: 'destructive_database_change',
        reason: 'drop customers',
        scope: 'P-010',
        context: { phase: 'P-010', details: ['destructive statement found in migrations/001.sql'] },
      });
      keeper.decide(approved.id, 'APPROVED');

      const differentRisk = keeper.open({
        runId: 'RUN-RISK-2',
        gate: 'destructive_database_change',
        reason: 'drop orders',
        scope: 'P-010',
        context: { phase: 'P-010', details: ['destructive statement found in migrations/002.sql'] },
      });

      expect(differentRisk.fingerprint).not.toBe(approved.fingerprint);
      expect(keeper.listPending().map((g) => g.id)).toContain(differentRisk.id);
    });

    it('does not gate ordinary backend work', () => {
      const evaluation = new GateKeeper(tempDir).evaluate({ runId: 'RUN-GOV-2', workPackage });
      expect(evaluation.blocked).toBe(false);
      expect(evaluation.triggered).toEqual([]);
    });

    it('gates a destructive migration detected in the working tree', () => {
      const migrationsDir = path.join(tempDir, 'migrations');
      fs.mkdirSync(migrationsDir, { recursive: true });
      fs.writeFileSync(path.join(migrationsDir, '001_drop.sql'), 'DROP TABLE customers;', 'utf8');

      const evaluation = new GateKeeper(tempDir).evaluate({
        runId: 'RUN-GOV-3',
        workPackage,
        observed: {
          run_id: 'RUN-GOV-3',
          git: { branch: 'main', commit: 'abc', is_clean: false, dirty_files: ['?? migrations/001_drop.sql'], recent_commits: [] },
          project: { name: 'fixture', stack: [], scripts: {}, migrations: [] },
          tests: { status: 'pending', passed: 0, failed: 0, skipped: 0, duration_ms: 0, failed_test_files: [] },
          requirements: {},
          tasks: {},
          specs: { planned: [], as_built: [] },
          risks: [],
          blockers: [],
          timestamp: new Date().toISOString(),
        },
      });

      expect(evaluation.blocked).toBe(true);
      expect(evaluation.triggered.some((g) => g.gate === 'destructive_database_change')).toBe(true);
    });

    it('refuses to decide the same gate twice', () => {
      const keeper = new GateKeeper(tempDir);
      const gate = keeper.open({ runId: 'RUN-GOV-4', gate: 'architecture_change', reason: 'fixture' });
      keeper.decide(gate.id, 'APPROVED');
      expect(() => keeper.decide(gate.id, 'REJECTED')).toThrow(/already approved/i);
    });
  });

  describe('AuditLogger hash chain', () => {
    it('links events and validates the chain', () => {
      const logger = new AuditLogger(tempDir);
      logger.emit('RUN-AUDIT', 'RUN_STARTED');
      logger.emit('RUN-AUDIT', 'SPEC_READY');
      logger.emit('RUN-AUDIT', 'RUN_COMPLETED');

      const events = logger.getEvents('RUN-AUDIT');
      expect(events).toHaveLength(3);
      expect(events[0].hash).toMatch(/^[0-9a-f]{64}$/);
      expect(events[1].prev_hash).toBe(events[0].hash);
      expect(events[2].actor).toBe('gov@example.com');
      const integrity = logger.verifyIntegrity();
      expect(integrity.valid).toBe(true);
      expect(integrity.forks).toBe(0);
    });

    it('detects a retroactively edited event', () => {
      const logger = new AuditLogger(tempDir);
      logger.emit('RUN-TAMPER', 'RUN_STARTED');
      logger.emit('RUN-TAMPER', 'VERIFICATION_PASSED');

      const auditFile = path.join(tempDir, '.agentic', 'audit', 'events.jsonl');
      const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter((l) => l.trim());
      const last = JSON.parse(lines[lines.length - 1]);
      last.type = 'VERIFICATION_FAILED';
      lines[lines.length - 1] = JSON.stringify(last);
      fs.writeFileSync(auditFile, lines.join('\n') + '\n', 'utf8');

      const result = logger.verifyIntegrity();
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not match its recorded hash');
    });

    it('detects a deleted event', () => {
      const logger = new AuditLogger(tempDir);
      logger.emit('RUN-DEL', 'RUN_STARTED');
      logger.emit('RUN-DEL', 'REVIEW_FINDING');
      logger.emit('RUN-DEL', 'RUN_COMPLETED');

      const auditFile = path.join(tempDir, '.agentic', 'audit', 'events.jsonl');
      const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter((l) => l.trim());
      lines.splice(lines.length - 2, 1);
      fs.writeFileSync(auditFile, lines.join('\n') + '\n', 'utf8');

      const result = logger.verifyIntegrity();
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('an event was removed');
    });

    it('reports concurrent appends as forks, not as tampering', () => {
      // Two loggers racing on the same tip is what parallel agents actually do.
      const a = new AuditLogger(tempDir);
      const b = new AuditLogger(tempDir);
      a.emit('RUN-FORK', 'RUN_STARTED');

      const auditFile = path.join(tempDir, '.agentic', 'audit', 'events.jsonl');
      const before = fs.readFileSync(auditFile, 'utf8');
      a.emit('RUN-FORK', 'TASK_COMPLETED');
      const afterFirst = fs.readFileSync(auditFile, 'utf8');

      // Simulate a race: rewind the file, let the second logger chain onto the
      // older tip, then restore the concurrent event.
      fs.writeFileSync(auditFile, before, 'utf8');
      b.emit('RUN-FORK', 'REVIEW_FINDING');
      const raced = fs.readFileSync(auditFile, 'utf8');
      fs.writeFileSync(auditFile, afterFirst + raced.slice(before.length), 'utf8');

      const result = new AuditLogger(tempDir).verifyIntegrity();
      expect(result.valid).toBe(true);
      expect(result.forks).toBeGreaterThan(0);
    });
  });

  describe('IdRegistry', () => {
    it('allocates sequential identifiers per kind', () => {
      const registry = new IdRegistry(tempDir);
      expect(registry.allocate('REQ')).toBe('REQ-001');
      expect(registry.allocate('REQ')).toBe('REQ-002');
      expect(registry.allocate('ADR')).toBe('ADR-001');
      expect(registry.list('REQ')).toHaveLength(2);
      expect(registry.isKnown('REQ-002')).toBe(true);
    });

    it('never reissues an identifier that already exists on disk', () => {
      const plannedDir = path.join(tempDir, '.agentic', 'specs', 'planned');
      fs.mkdirSync(plannedDir, { recursive: true });
      fs.writeFileSync(path.join(plannedDir, 'SPEC-042.md'), '# existing', 'utf8');

      const registry = new IdRegistry(tempDir);
      expect(registry.allocate('SPEC')).toBe('SPEC-043');
    });

    it('rebuilds from disk when the registry file is lost', () => {
      const registry = new IdRegistry(tempDir);
      registry.allocate('REQ');
      registry.allocate('REQ');
      fs.unlinkSync(path.join(tempDir, '.agentic', 'registry', 'ids.json'));

      const plannedDir = path.join(tempDir, '.agentic', 'specs', 'planned');
      fs.mkdirSync(plannedDir, { recursive: true });
      fs.writeFileSync(path.join(plannedDir, 'SPEC-002.md'), '# REQ-002', 'utf8');

      expect(new IdRegistry(tempDir).allocate('REQ')).toBe('REQ-003');
    });

    it('keeps requirement, spec and phase numbers aligned for one work unit', () => {
      const unit = new IdRegistry(tempDir).allocateWorkUnit({ title: 'checkout' });
      const number = unit.reqId.split('-')[1];
      expect(unit.specId).toBe(`SPEC-${number}`);
      expect(unit.phaseId).toBe(`P-${number}`);
    });
  });

  describe('AgentBridge handoff', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Create the products repository',
        domain: 'backend',
        requirements: ['REQ-010'],
        acceptance_criteria: ['AC-010.1'],
        dependencies: [],
        ownership: { write: ['src/products/**'], forbidden: ['.env'] },
      },
    ];

    it('writes a self-contained prompt pack and an index, awaiting a report', () => {
      const dag = new TaskCompiler(tempDir).compile(nodes);
      const contracts = nodes.map((node) => new Executor(tempDir).createTaskContract(node));
      const bridge = new AgentBridge(tempDir);

      const dispatch = bridge.dispatch({
        runId: 'RUN-BRIDGE',
        dag,
        contracts,
        goal: 'Deliver product listing',
        decisionRefs: ['ADR-001'],
        openQuestions: ['Which pagination strategy?'],
        assumptions: ['Reject malformed payloads with 400'],
      });

      expect(dispatch.mode).toBe('delegated');
      expect(dispatch.awaiting).toEqual(['TASK-001']);

      const pack = fs.readFileSync(path.join(tempDir, dispatch.dispatched[0].prompt_file), 'utf8');
      expect(pack).toContain('AC-010.1');
      expect(pack).toContain('src/products/**');
      expect(pack).toContain('FORBIDDEN');
      expect(pack).toContain('ADR-001');
      expect(pack).toContain('Which pagination strategy?');
      expect(pack).toContain('Reject malformed payloads with 400');
      expect(pack).toContain('RED');
    });

    it('records a reported result and stops awaiting that task', () => {
      const dag = new TaskCompiler(tempDir).compile(nodes);
      const contracts = nodes.map((node) => new Executor(tempDir).createTaskContract(node));
      const bridge = new AgentBridge(tempDir);
      bridge.dispatch({ runId: 'RUN-BRIDGE-2', dag, contracts, goal: 'Deliver product listing' });

      bridge.recordResult({
        runId: 'RUN-BRIDGE-2',
        taskId: 'TASK-001',
        status: 'completed',
        filesChanged: ['src/products/repository.ts'],
        commit: 'cafe123',
      });

      const results = bridge.collectResults('RUN-BRIDGE-2', ['TASK-001']);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('completed');
      expect(results[0].commit).toBe('cafe123');

      // A result from a different run must never satisfy this run.
      expect(bridge.collectResults('RUN-OTHER', ['TASK-001'])).toEqual([]);
    });
  });
});
