import { OrchestratorState } from '../types/state.js';
import { StateMachineConfig } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';

export type TransitionOutcome =
  | 'next'
  | 'success'
  | 'failure'
  | 'partial_failure'
  | 'findings'
  | 'critical'
  | 'needs_state_repair'
  | 'needs_human'
  | 'no_work'
  | 'no_more_work'
  | 'awaiting_agent'
  | 'blocked_by_gate'
  | 'repeated_failure'
  | 'approved'
  | 'rejected'
  | 'resolved'
  | 'aborted';

export class StateMachine {
  private currentState: OrchestratorState;
  private previousState?: OrchestratorState;
  private config: StateMachineConfig;
  private auditLogger: AuditLogger;
  private runId: string;

  constructor(
    runId: string,
    initialState: OrchestratorState = 'IDLE',
    configLoader?: ConfigLoader,
    auditLogger?: AuditLogger
  ) {
    this.runId = runId;
    this.currentState = initialState;
    const loader = configLoader || new ConfigLoader();
    this.config = loader.loadStateMachineConfig();
    this.auditLogger = auditLogger || new AuditLogger();
  }

  public getState(): OrchestratorState {
    return this.currentState;
  }

  public getPreviousState(): OrchestratorState | undefined {
    return this.previousState;
  }

  public isTerminal(): boolean {
    const stateDef = this.config.states[this.currentState];
    return Boolean(stateDef?.terminal);
  }

  public canTransition(outcome: TransitionOutcome, targetStateOverride?: OrchestratorState): boolean {
    try {
      this.resolveTargetState(outcome, targetStateOverride);
      return true;
    } catch {
      return false;
    }
  }

  private resolveTargetState(outcome: TransitionOutcome, targetStateOverride?: OrchestratorState): OrchestratorState {
    const stateDef = this.config.states[this.currentState];
    if (!stateDef) {
      throw new Error(`Unknown state definition for: ${this.currentState}`);
    }

    if (this.currentState === 'HUMAN_GATE') {
      if (outcome === 'approved') {
        if (targetStateOverride) return targetStateOverride;
        if (this.previousState) return this.previousState;
        return 'OBSERVING';
      }
      if (outcome === 'rejected') {
        return 'STOPPED';
      }
    }

    if (this.currentState === 'BLOCKED') {
      if (outcome === 'resolved') return targetStateOverride || 'OBSERVING';
      if (outcome === 'aborted') return 'STOPPED';
    }

    if (outcome === 'next') {
      if (stateDef.next && stateDef.next.length > 0) {
        return stateDef.next[0] as OrchestratorState;
      }
    }

    const target = (stateDef as Record<string, unknown>)[outcome];
    if (typeof target === 'string') {
      return target as OrchestratorState;
    }

    throw new Error(
      `Invalid transition: cannot transition from ${this.currentState} with outcome '${outcome}'`
    );
  }

  public transition(outcome: TransitionOutcome, targetStateOverride?: OrchestratorState, metadata?: Record<string, unknown>): OrchestratorState {
    const nextState = this.resolveTargetState(outcome, targetStateOverride);
    const fromState = this.currentState;

    this.previousState = fromState;
    this.currentState = nextState;

    this.auditLogger.emit(this.runId, 'STATE_TRANSITION', {
      from: fromState,
      to: nextState,
      metadata: {
        outcome,
        ...metadata,
      },
    });

    if (nextState === 'HUMAN_GATE') {
      this.auditLogger.emit(this.runId, 'HUMAN_GATE_TRIGGERED', {
        from: fromState,
        metadata: {
          reason: outcome,
          ...metadata,
        },
      });
    }

    return this.currentState;
  }
}
