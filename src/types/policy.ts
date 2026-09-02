/**
 * Change classification and policy verdicts.
 *
 * `policies.yaml` has always declared rules per *kind of change* (a bugfix needs
 * no spec, a feature does; config-only work does not need TDD, a refactor does).
 * Without a classification these rules had nothing to key on, which is why they
 * were parsed and never applied.
 */
export type ChangeKind =
  | 'feature'
  | 'bugfix'
  | 'bugfix_small'
  | 'refactor'
  | 'architecture_change'
  | 'database_change'
  | 'documentation_only'
  | 'config_only'
  | 'generated_code';

export type TddRequirement = 'required' | 'optional';

export interface ChangeClassification {
  kind: ChangeKind;
  /** Why this classification was chosen, for the audit trail and the prompt pack. */
  rationale: string;
  specRequired: boolean;
  tdd: TddRequirement;
}

export type PolicyViolationCode =
  | 'spec_required'
  | 'tdd_required'
  | 'atomic_commit_required'
  | 'commit_not_found';

export interface PolicyViolation {
  code: PolicyViolationCode;
  /** Which policy key in policies.yaml was violated. */
  policy: string;
  message: string;
  /** What the operator or agent has to do about it. */
  remedy: string;
}
