import { describe, it, expect } from 'vitest';
import { Observer } from '../src/core/observer.js';
import { Reconciler } from '../src/core/reconciler.js';
import { ObservedState, DeclaredState } from '../src/types/state.js';

describe('Observer & Reconciler', () => {
  const observer = new Observer();
  const reconciler = new Reconciler();

  it('should observe current repository metadata without mutating source code', () => {
    const state = observer.observe('RUN-TEST-OBS');
    expect(state.run_id).toBe('RUN-TEST-OBS');
    expect(state.git).toBeDefined();
    expect(state.project.name).toBeDefined();
    expect(state.tests).toBeDefined();
    expect(Array.isArray(state.risks)).toBe(true);
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
