export interface TeamIdentity {
  email: string;
  name: string;
  host: string;
}

export interface Lease {
  /** Scope of the lease: a phase id (`P-012`) or a task id. */
  scope: string;
  scope_type: 'phase' | 'task';
  run_id?: string;
  owner_email: string;
  owner_name: string;
  host: string;
  branch: string;
  acquired_at: string;
  heartbeat_at: string;
  expires_at: string;
  note?: string;
}

export interface LeaseCheck {
  available: boolean;
  lease?: Lease;
  reason: string;
  /** True when the blocking lease belongs to the current identity. */
  mine: boolean;
  expired: boolean;
}
