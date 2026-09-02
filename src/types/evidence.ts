/**
 * Executable evidence types.
 *
 * The core invariant of the framework — "No requirement is DONE without evidence" —
 * is only meaningful if evidence is *collected from a real process execution*.
 * Every field here describes something that was actually observed, never declared.
 */

export type EvidenceSource = 'executed' | 'declared' | 'absent';

export type EvidenceStatus = 'pass' | 'fail' | 'error' | 'unavailable';

export interface EvidenceRecord {
  /** Stable id: EV-<timestamp>-<short hash of command> */
  id: string;
  run_id: string;
  /** Where the numbers came from. Only 'executed' can close a requirement. */
  source: EvidenceSource;
  status: EvidenceStatus;
  command: string;
  cwd: string;
  exit_code: number | null;
  passed: number;
  failed: number;
  skipped: number;
  /** True when the parser could not extract counters (exit code is then the only signal). */
  counters_inferred: boolean;
  parser: string;
  duration_ms: number;
  failed_test_files: string[];
  /** Last N characters of combined stdout+stderr, kept for auditability. */
  output_tail: string;
  /** SHA-256 of the full combined output, so a tail cannot be silently edited. */
  output_sha256: string;
  commit: string;
  collected_at: string;
  notes?: string[];
}

export interface EvidenceConfig {
  version: number;
  evidence: {
    /** Explicit test command. When absent it is auto-detected from the project. */
    test_command?: string;
    timeout_ms: number;
    output_tail_chars: number;
    /** Refuse to collect evidence while the working tree is dirty. */
    require_clean_tree: boolean;
    /** Allow `observe` to execute the test suite. */
    run_tests_on_observe: boolean;
  };
}

export const DEFAULT_EVIDENCE_CONFIG: EvidenceConfig = {
  version: 1,
  evidence: {
    timeout_ms: 900_000,
    output_tail_chars: 4000,
    require_clean_tree: false,
    run_tests_on_observe: false,
  },
};
