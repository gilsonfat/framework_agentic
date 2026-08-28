import { describe, it, expect } from 'vitest';
import { StateMachine } from '../src/core/state-machine.js';
import { ConfigLoader } from '../src/core/config-loader.js';

describe('StateMachine', () => {
  const configLoader = new ConfigLoader();

  it('should initialize in IDLE state', () => {
    const sm = new StateMachine('RUN-TEST-001', 'IDLE', configLoader);
    expect(sm.getState()).toBe('IDLE');
    expect(sm.isTerminal()).toBe(false);
  });

  it('should transition through normal successful SDLC cycle', () => {
    const sm = new StateMachine('RUN-TEST-002', 'IDLE', configLoader);

    expect(sm.transition('next')).toBe('OBSERVING');
    expect(sm.transition('success')).toBe('RECONCILING');
    expect(sm.transition('success')).toBe('PLANNING');
    expect(sm.transition('success')).toBe('SPECIFYING');
    expect(sm.transition('success')).toBe('SPEC_READY');
    expect(sm.transition('next')).toBe('COMPILING');
    expect(sm.transition('success')).toBe('EXECUTION_READY');
    expect(sm.transition('next')).toBe('EXECUTING');
    expect(sm.transition('success')).toBe('REVIEWING');
    expect(sm.transition('success')).toBe('VERIFYING');
    expect(sm.transition('success')).toBe('RECONCILING_IMPLEMENTATION');
    expect(sm.transition('success')).toBe('AS_BUILT');
    expect(sm.transition('success')).toBe('UPDATING_STATE');
    expect(sm.transition('no_more_work')).toBe('COMPLETE');
    expect(sm.isTerminal()).toBe(true);
  });

  it('should reject invalid transitions', () => {
    const sm = new StateMachine('RUN-TEST-003', 'IDLE', configLoader);
    expect(() => sm.transition('success')).toThrow(/Invalid transition/);
    expect(sm.canTransition('success')).toBe(false);
  });

  it('should route to HUMAN_GATE and allow approval or rejection', () => {
    const sm = new StateMachine('RUN-TEST-004', 'SPECIFYING', configLoader);
    expect(sm.transition('needs_human')).toBe('HUMAN_GATE');

    // Test rejection -> STOPPED
    const smReject = new StateMachine('RUN-TEST-005', 'HUMAN_GATE', configLoader);
    expect(smReject.transition('rejected')).toBe('STOPPED');
    expect(smReject.isTerminal()).toBe(true);

    // Test approval -> target state override
    const smApprove = new StateMachine('RUN-TEST-006', 'HUMAN_GATE', configLoader);
    expect(smApprove.transition('approved', 'PLANNING')).toBe('PLANNING');
  });

  it('should route verification failure to REMEDIATING and back to VERIFYING', () => {
    const sm = new StateMachine('RUN-TEST-007', 'VERIFYING', configLoader);
    expect(sm.transition('failure')).toBe('REMEDIATING');
    expect(sm.transition('success')).toBe('VERIFYING');
  });
});
