export type IdKind = 'REQ' | 'SPEC' | 'ADR' | 'TASK' | 'PHASE' | 'MILESTONE' | 'RUN';

export interface IdAllocation {
  id: string;
  kind: IdKind;
  title?: string;
  run_id?: string;
  actor: string;
  allocated_at: string;
}

export interface IdRegistryFile {
  version: number;
  /** Highest number already handed out per kind. */
  counters: Partial<Record<IdKind, number>>;
  /** Append-only allocation ledger, used for traceability and conflict forensics. */
  allocations: IdAllocation[];
}
