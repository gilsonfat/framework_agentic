export type AuditEventType =
  | 'RUN_STARTED'
  | 'STATE_TRANSITION'
  | 'WORK_PACKAGE_CREATED'
  | 'SPEC_READY'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'REVIEW_FINDING'
  | 'VERIFICATION_STARTED'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_FAILED'
  | 'REMEDIATION_STARTED'
  | 'REMEDIATION_COMPLETED'
  | 'AS_BUILT_GENERATED'
  | 'STATE_UPDATED'
  | 'RUN_COMPLETED'
  | 'RUN_BLOCKED'
  | 'HUMAN_GATE_TRIGGERED'
  | 'HUMAN_GATE_APPROVED'
  | 'HUMAN_GATE_REJECTED'
  | 'EVIDENCE_COLLECTION_STARTED'
  | 'EVIDENCE_COLLECTED'
  | 'EVIDENCE_REJECTED'
  | 'TASKS_DISPATCHED'
  | 'AGENT_HANDOFF'
  | 'AGENT_RESULT_RECORDED'
  | 'ID_ALLOCATED'
  | 'LEASE_ACQUIRED'
  | 'LEASE_RELEASED'
  | 'LEASE_DENIED'
  | 'DECLARED_STATE_SYNCED'
  | 'POLICY_VIOLATION'
  | 'POLICY_OVERRIDDEN'
  | 'WORKTREE_CREATED'
  | 'WORKTREE_REMOVED'
  | 'MILESTONE_ACTIVATED'
  | 'MILESTONE_CLOSED'
  | 'PHASE_CLOSED'
  | 'AUDIT_INITIALIZED';

export interface AuditEvent {
  time: string;
  run: string;
  type: AuditEventType;
  /** Monotonic sequence number within the audit stream. */
  seq?: number;
  /** SHA-256 of the previous event's `hash`, forming a tamper-evident chain. */
  prev_hash?: string;
  /** SHA-256 over this event's canonical payload plus `prev_hash`. */
  hash?: string;
  /** Identity (git user.email) that produced the event. */
  actor?: string;
  from?: string;
  to?: string;
  task?: string;
  requirement?: string;
  commit?: string;
  metadata?: Record<string, unknown>;
}
