import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Observer } from '../src/core/observer.js';
import { Reconciler } from '../src/core/reconciler.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { ObservedState, DeclaredState } from '../src/types/state.js';

describe('Observer & Reconciler', () => {
  let tempDir: string;
  let observer: Observer;
  let reconciler: Reconciler;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-observe-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
    observer = new Observer(tempDir);
    reconciler = new Reconciler(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should observe current repository metadata without mutating source code', () => {
    const state = observer.observe('RUN-TEST-OBS');
    expect(state.run_id).toBe('RUN-TEST-OBS');
    expect(state.git).toBeDefined();
    expect(state.project.name).toBeDefined();
    expect(state.tests).toBeDefined();
    expect(Array.isArray(state.risks)).toBe(true);
  });

  it('reports an unmeasured test suite as pending, never as passing', () => {
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fixture', scripts: { test: 'exit 0' } }),
      'utf8'
    );

    const notMeasured = observer.observe('RUN-TEST-PENDING', { runTests: false });
    expect(notMeasured.tests.status).toBe('pending');
    expect(notMeasured.tests.evidence_id).toBeUndefined();
    expect(notMeasured.risks.join(' ')).toContain('not measured');

    const measured = observer.observe('RUN-TEST-MEASURED', { runTests: true });
    expect(measured.tests.status).toBe('pass');
    expect(measured.tests.evidence_id).toBeDefined();
    expect(observer.getLastEvidence()?.source).toBe('executed');
  });

  it('rewrites the declared state from observed truth when asked to sync', () => {
    const observed: ObservedState = {
      run_id: 'RUN-TEST-SYNC',
      git: { branch: 'main', commit: 'abc', is_clean: true, dirty_files: [], recent_commits: [] },
      project: { name: 'fixture', stack: [], scripts: {}, migrations: [] },
      tests: { status: 'pass', passed: 3, failed: 0, skipped: 0, duration_ms: 10, failed_test_files: [] },
      requirements: { 'REQ-042': { status: 'done', verified: true } },
      tasks: { 'TASK-001': { status: 'completed' } },
      specs: { planned: [], as_built: [] },
      risks: [],
      blockers: [],
      timestamp: new Date().toISOString(),
    };

    const declared = reconciler.syncDeclaredState('RUN-TEST-SYNC', observed, { phase: 'P-042' });
    expect(declared.requirements['REQ-042'].status).toBe('done');
    expect(declared.tasks['TASK-001'].status).toBe('completed');
    expect(declared.phase).toBe('P-042');
    expect(declared.status).toBe('complete');

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tempDir, '.agentic', 'state', 'declared-state.json'), 'utf8')
    );
    expect(onDisk.requirements['REQ-042'].status).toBe('done');
  });

  it('should detect mismatch when declared done but observed is not_started', () => {
    const mockObserved: ObservedState = {
      run_id: 'RUN-TEST-REC',
      git: { branch: 'main', commit: 'abc', is_clean: true, dirty_files: [], recent_commits: [] },
      project: { name: 'test', stack: ['node'], scripts: {}, migrations: [] },
      tests: { status: 'pass', passed: 10, failed: 0, skipped: 0, duration_ms: 100, failed_test_files: [] },
      requirements: {},
      tasks: {},
      specs: { planned: [], as_built: [] },
      risks: [],
      blockers: [],
      timestamp: new Date().toISOString(),
    };

    const mockDeclared: DeclaredState = {
      milestone: 'M01',
      phase: 'P01',
      requirements: {
        'REQ-017': { status: 'done', title: 'Prevent duplicates' },
      },
      tasks: {},
      status: 'in_progress',
    };

    const rec = reconciler.reconcile('RUN-TEST-REC', mockObserved, mockDeclared);
    expect(rec.status).toBe('MISMATCH');
    expect(rec.mismatches.length).toBe(1);
    expect(rec.mismatches[0].id).toBe('REQ-017');
    expect(rec.mismatches[0].result).toBe('MISMATCH');
  });

  it('should match when declared done and observed is verified done', () => {
    const mockObserved: ObservedState = {
      run_id: 'RUN-TEST-REC-2',
      git: { branch: 'main', commit: 'abc', is_clean: true, dirty_files: [], recent_commits: [] },
      project: { name: 'test', stack: ['node'], scripts: {}, migrations: [] },
      tests: { status: 'pass', passed: 10, failed: 0, skipped: 0, duration_ms: 100, failed_test_files: [] },
      requirements: {
        'REQ-017': { status: 'done', verified: true },
      },
      tasks: {},
      specs: { planned: [], as_built: [] },
      risks: [],
      blockers: [],
      timestamp: new Date().toISOString(),
    };

    const mockDeclared: DeclaredState = {
      milestone: 'M01',
      phase: 'P01',
      requirements: {
        'REQ-017': { status: 'done' },
      },
      tasks: {},
      status: 'complete',
    };

    const rec = reconciler.reconcile('RUN-TEST-REC-2', mockObserved, mockDeclared);
    expect(rec.status).toBe('MATCH');
    expect(rec.matches.length).toBe(1);
    expect(rec.mismatches.length).toBe(0);
  });
});
