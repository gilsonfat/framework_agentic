import { EvidenceRecord } from './evidence.js';

export interface RequirementCheckResult {
  requirement_id: string;
  status: 'verified' | 'failed' | 'untested';
  acceptance_criteria_passed: string[];
  acceptance_criteria_failed: string[];
  findings?: string[];
}

export interface VerificationEvidence {
  tests_passed: number;
  tests_failed: number;
  test_suite_output?: string;
  artifacts?: string[];
  /** Id of the executed evidence record backing these numbers. */
  evidence_id?: string;
  /** 'executed' is the only source that may close a requirement. */
  source?: EvidenceRecord['source'];
  command?: string;
  exit_code?: number | null;
  output_sha256?: string;
}

export interface VerificationReport {
  verification_id: string;
  run_id: string;
  /**
   * PASS      — all criteria verified against executed evidence
   * FAIL      — evidence exists and contradicts the claim
   * PARTIAL   — nothing to check
   * BLOCKED   — no executable evidence, so closure is refused (not a pass, not a fail)
   */
  status: 'PASS' | 'FAIL' | 'PARTIAL' | 'BLOCKED';
  timestamp: string;
  verifier_type: 'fresh_context' | 'local' | 'automated';
  /** Identity that produced the verification, used for author != verifier checks. */
  verified_by?: string;
  /** Identity that implemented the work, when known. */
  authored_by?: string;
  requirements_checked: RequirementCheckResult[];
  evidence: VerificationEvidence;
  blocking_findings?: string[];
}

export interface RequirementMatrixEntry {
  implemented: boolean;
  tested: boolean;
  verified: boolean;
  tasks: string[];
  files?: string[];
  tests?: string[];
  commits?: string[];
  verification?: string;
  /** Evidence record id that justified closure. */
  evidence?: string;
  verified_by?: string;
  verified_at?: string;
  closed_by_run?: string;
  commit?: string;
}

export type RequirementClosureMatrix = Record<string, RequirementMatrixEntry>;

export interface RemediationPackage {
  run_id: string;
  verification_id: string;
  requirement: string;
  expected: string;
  observed: string;
  evidence: string[];
  affected_tasks: string[];
  suspected_areas: string[];
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  attempt: number;
}
