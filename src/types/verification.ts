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
}

export interface VerificationReport {
  verification_id: string;
  run_id: string;
  status: 'PASS' | 'FAIL' | 'PARTIAL';
  timestamp: string;
  verifier_type: 'fresh_context' | 'local' | 'automated';
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
