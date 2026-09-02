import path from 'path';
import { spawnSync } from 'child_process';
import { ChangeClassification, ChangeKind, PolicyViolation, TddRequirement } from '../types/policy.js';
import { PoliciesConfig } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';

export interface TaskReportInput {
  taskId: string;
  status: 'completed' | 'failed' | 'blocked' | 'pending';
  filesChanged: string[];
  testsAdded: string[];
  commit?: string;
}

/**
 * Applies the rules declared in `policies.yaml`.
 *
 * The policies were the framework's stated governance and the code never
 * consulted them, so "TDD required for features" and "one atomic commit per
 * task" were aspirations. This engine turns each of them into a verdict that
 * something in the flow actually acts on.
 */
export class PolicyEngine {
  private projectRoot: string;
  private policies: PoliciesConfig['policies'] | undefined;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    try {
      this.policies = (configLoader || new ConfigLoader(this.projectRoot)).loadPoliciesConfig().policies;
    } catch {
      this.policies = undefined;
    }
  }

  /**
   * Classifies a request so the per-kind policies have something to key on.
   * Order matters: the most consequential kind wins, because misclassifying a
   * database or architecture change downward would skip the rules that protect it.
   */
  public classify(text: string, hints: { domain?: string; complexity?: string } = {}): ChangeClassification {
    const lower = `${text} ${hints.domain || ''}`.toLowerCase();

    const kind = ((): { kind: ChangeKind; rationale: string } => {
      if (/\bmigration\b|\bmigra(c|ç)(a|ã)o\b|\bschema\b|\btabela\b|\bdatabase\b|\bbanco de dados\b/.test(lower)) {
        return { kind: 'database_change', rationale: 'mentions a database schema or migration' };
      }
      if (
        hints.complexity === 'XL' ||
        /\brefatorar arquitetura\b|\barchitecture\b|\bmicroservi|\bredesenh|\bmigrar todo\b/.test(lower)
      ) {
        return { kind: 'architecture_change', rationale: 'reshapes architecture or is XL complexity' };
      }
      if (/\bdocument(a|e|ação|ation)\b|\breadme\b|\bchangelog\b|\bcoment(a|á)rio/.test(lower)) {
        return { kind: 'documentation_only', rationale: 'touches documentation only' };
      }
      if (/\bconfig(ura(c|ç)(a|ã)o)?\b|\benv\b|\byaml\b|\bdotfile|\bci\b|\bpipeline\b/.test(lower)) {
        return { kind: 'config_only', rationale: 'changes configuration rather than behaviour' };
      }
      if (/\bgerad[oa]\b|\bgenerated\b|\bcodegen\b|\bscaffold\b/.test(lower)) {
        return { kind: 'generated_code', rationale: 'produces generated code' };
      }
      if (/\brefator|\brefactor|\blimpar\b|\bcleanup\b|\bextrair\b/.test(lower)) {
        return { kind: 'refactor', rationale: 'restructures existing code without new behaviour' };
      }
      if (/\bbug\b|\bcorrigir\b|\bfix\b|\bdefeito\b|\berro\b|\bregress/.test(lower)) {
        const small = hints.complexity === 'XS' || hints.complexity === 'S';
        return {
          kind: small ? 'bugfix_small' : 'bugfix',
          rationale: small ? 'small defect fix' : 'defect fix',
        };
      }
      return { kind: 'feature', rationale: 'adds new behaviour' };
    })();

    return {
      kind: kind.kind,
      rationale: kind.rationale,
      specRequired: this.isSpecRequired(kind.kind),
      tdd: this.tddRequirement(kind.kind),
    };
  }

  /** Classification for a kind already decided earlier in the cycle. */
  public classificationFor(kind: ChangeKind, rationale = 'recorded on the work package'): ChangeClassification {
    return {
      kind,
      rationale,
      specRequired: this.isSpecRequired(kind),
      tdd: this.tddRequirement(kind),
    };
  }

  public isSpecRequired(kind: ChangeKind): boolean {
    const rules = this.policies?.spec_required || {};
    if (kind in rules) return Boolean(rules[kind]);

    // A kind with no explicit rule inherits the closest declared one; anything
    // that changes behaviour defaults to requiring a spec.
    if (kind === 'bugfix') return Boolean(rules.bugfix_small ?? false);
    if (kind === 'refactor' || kind === 'generated_code') return Boolean(rules.feature ?? true);
    if (kind === 'config_only') return Boolean(rules.documentation_only ?? false);
    return true;
  }

  public tddRequirement(kind: ChangeKind): TddRequirement {
    const rules = (this.policies?.tdd || {}) as Record<string, string>;
    if (kind in rules) return rules[kind] === 'required' ? 'required' : 'optional';
    if (kind === 'bugfix_small') return rules.bugfix === 'required' ? 'required' : 'optional';
    if (kind === 'database_change' || kind === 'architecture_change') {
      return rules.feature === 'required' ? 'required' : 'optional';
    }
    if (kind === 'documentation_only') return 'optional';
    return 'optional';
  }

  public requiresAtomicCommitPerTask(): boolean {
    return this.policies?.git?.atomic_commit_per_task !== false;
  }

  /** Worktree isolation for tasks that run in the same wave. */
  public requiresWorktreeForParallelAgents(): boolean {
    return (this.policies?.worktree as Record<string, string> | undefined)?.parallel_agents === 'required';
  }

  public shouldReobserveAfterSuccess(): boolean {
    return this.policies?.loop?.reobserve_after_success !== false;
  }

  public shouldGenerateAsBuilt(): boolean {
    return this.policies?.documentation?.generate_as_built !== false;
  }

  /**
   * Checks a task report against the policies that only a report can prove:
   * that tests were written, and that the work landed as one atomic commit.
   */
  public checkTaskReport(input: TaskReportInput, classification: ChangeClassification): PolicyViolation[] {
    const violations: PolicyViolation[] = [];
    if (input.status !== 'completed') return violations;

    if (classification.tdd === 'required' && input.testsAdded.length === 0) {
      violations.push({
        code: 'tdd_required',
        policy: `policies.tdd.${classification.kind}`,
        message: `This work is classified '${classification.kind}' (${classification.rationale}), for which TDD is required, but the report lists no test file.`,
        remedy: `Report the tests you wrote: agentic report ${input.taskId} --status completed --tests "<test files>"`,
      });
    }

    if (this.requiresAtomicCommitPerTask()) {
      if (!input.commit) {
        violations.push({
          code: 'atomic_commit_required',
          policy: 'policies.git.atomic_commit_per_task',
          message: 'This policy requires one atomic commit per task, but the report carries no commit.',
          remedy: `Commit the task, then: agentic report ${input.taskId} --status completed --commit <sha>`,
        });
      } else if (!this.commitExists(input.commit)) {
        violations.push({
          code: 'commit_not_found',
          policy: 'policies.git.atomic_commit_per_task',
          message: `Commit '${input.commit}' does not resolve in this repository.`,
          remedy: 'Report the real commit sha produced by this task.',
        });
      }
    }

    return violations;
  }

  /** Blocks a run whose change kind requires a specification that does not exist. */
  public checkSpecRequirement(
    classification: ChangeClassification,
    context: { hasSpec: boolean }
  ): PolicyViolation[] {
    if (!classification.specRequired || context.hasSpec) return [];

    return [
      {
        code: 'spec_required',
        policy: `policies.spec_required.${classification.kind}`,
        message: `A '${classification.kind}' change requires a specification before implementation, and this run has none.`,
        remedy: 'Generate the contract first: agentic prompt "<instruction>" (or agentic spec "<instruction>").',
      },
    ];
  }

  private commitExists(ref: string): boolean {
    const result = spawnSync(`git rev-parse --verify --quiet "${ref}^{commit}"`, {
      cwd: this.projectRoot,
      shell: true,
      encoding: 'utf8',
    });
    return result.status === 0 && Boolean((result.stdout || '').trim());
  }
}
