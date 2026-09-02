export type GateStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface GateRequest {
  id: string;
  /** Run that first opened the gate. A decision is NOT scoped to that run. */
  run_id: string;
  /** Key from gates.yaml (e.g. `authentication_change`). */
  gate: string;
  /** What the decision applies to, normally the phase id. */
  scope: string;
  /**
   * Stable hash of (gate, scope, risk details). A decision carries forward to
   * later runs with the same fingerprint; if the underlying risk changes, the
   * fingerprint changes and a fresh decision is required.
   */
  fingerprint: string;
  reason: string;
  /** What the gate is protecting: files, domains, requirements. */
  context: {
    phase?: string;
    milestone?: string;
    requirements?: string[];
    domains?: string[];
    complexity?: string;
    details?: string[];
  };
  requested_by: string;
  requested_at: string;
  status: GateStatus;
  decided_by?: string;
  decided_at?: string;
  note?: string;
}
