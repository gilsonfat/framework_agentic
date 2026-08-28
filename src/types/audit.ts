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
  | 'AUDIT_INITIALIZED';

export interface AuditEvent {
  time: string;
  run: string;
  type: AuditEventType;
  from?: string;
  to?: string;
  task?: string;
  requirement?: string;
  commit?: string;
  metadata?: Record<string, unknown>;
}
