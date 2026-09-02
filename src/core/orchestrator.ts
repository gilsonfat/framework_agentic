import fs from 'fs';
import path from 'path';
import { StateMachine } from './state-machine.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';
import { Observer } from './observer.js';
import { Reconciler } from './reconciler.js';
import { Planner } from './planner.js';
import { TaskCompiler } from './task-compiler.js';
import { ComplexityEngine } from './complexity-engine.js';
import { RoutingEngine } from './routing-engine.js';
import { Executor } from './executor.js';
import { ReviewPipeline, ReviewFinding } from './review-pipeline.js';
import { Verifier } from './verifier.js';
import { RemediationEngine } from './remediation.js';
import { AsBuiltGenerator } from './as-built.js';
import { EvidenceCollector } from './evidence-collector.js';
import { GateKeeper } from './gate-keeper.js';
import { AgentBridge } from './agent-bridge.js';
import { TeamCoordinator } from './team.js';
import { IdRegistry } from './id-registry.js';
import { ARTIFACT_SCHEMA_VERSION, isCurrent, stampVersion } from './artifact-schema.js';
import { PolicyEngine } from './policy-engine.js';
import { WorktreeManager } from './worktree-manager.js';
import { MilestoneManager } from './milestone-manager.js';
import { RunDescriptor } from '../types/run.js';
import { WorkPackage, TaskContract, TaskDAGNode } from '../types/task.js';
import { BmadBriefing } from '../types/bmad.js';
import { GrillMeResult, DecisionRecord } from '../types/decision.js';
import { GitHubSpecKitDocument } from '../types/spec-kit.js';
import { ExecutionMode } from '../types/execution.js';
import { EvidenceRecord } from '../types/evidence.js';
import { ChangeClassification } from '../types/policy.js';

export interface OrchestrationOptions {
  phaseId?: string;
  runId?: string;
  autoApproveNonDestructiveGates?: boolean;
  bmadBriefing?: BmadBriefing;
  grillResult?: GrillMeResult;
  decisionRecords?: DecisionRecord[];
  specKitDoc?: GitHubSpecKitDocument;
  specFile?: string;
  /** Execute the test suite during OBSERVE as well as during VERIFY. */
  observeTests?: boolean;
  /** Prepare artifacts without executing tests or closing anything. */
  dryRun?: boolean;
  /** Override providers.yaml execution.mode. */
  executionMode?: ExecutionMode;
  /** Take over a phase lease held by someone else. */
  force?: boolean;
  /** Resume an existing run parked in AWAITING_AGENT instead of starting a new one. */
  resume?: boolean;
  /** Skip git worktree isolation even when the policy asks for it. */
  noWorktrees?: boolean;
}

/**
 * Keeps only the entries of a work package scope that are really path patterns.
 *
 * `scope.include` mixes machine-generated globs (from the module detector) with
 * prose from the BMAD briefing, so writing all of it into `ownership.write`
 * would produce nonsense boundaries.
 */
function toGlobs(entries: string[] | undefined): string[] {
  return (entries || [])
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && !/\s/.test(entry) && (entry.includes('/') || entry.includes('*')));
}

/** Paths no task may ever write, regardless of its declared ownership. */
const GLOBAL_FORBIDDEN_PATHS = [
  '.env',
  '.env.*',
  '**/secrets/**',
  '**/*.pem',
  '**/id_rsa*',
  '.agentic/audit/**',
  '.agentic/verification/requirement-matrix.json',
  '.agentic/gates/**',
];

/**
 * The 12-step delivery cycle.
 *
 * Design rule: this class coordinates and enforces, it never *performs* the work
 * and never invents an observation. Implementation is handed to an agent through
 * `AgentBridge`, test results come only from `EvidenceCollector`, closure only
 * from `Verifier`, and every gate decision is a persisted human decision.
 */
export class Orchestrator {
  private projectRoot: string;
  private configLoader: ConfigLoader;
  private auditLogger: AuditLogger;
  private observer: Observer;
  private reconciler: Reconciler;
  private planner: Planner;
  private taskCompiler: TaskCompiler;
  private complexityEngine: ComplexityEngine;
  private routingEngine: RoutingEngine;
  private executor: Executor;
  private reviewPipeline: ReviewPipeline;
  private verifier: Verifier;
  private remediationEngine: RemediationEngine;
  private asBuiltGenerator: AsBuiltGenerator;
  private evidenceCollector: EvidenceCollector;
  private gateKeeper: GateKeeper;
  private agentBridge: AgentBridge;
  private team: TeamCoordinator;
  private idRegistry: IdRegistry;
  private policyEngine: PolicyEngine;
  private worktrees: WorktreeManager;
  private milestones: MilestoneManager;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = new ConfigLoader(this.projectRoot);
    this.auditLogger = new AuditLogger(this.projectRoot);
    this.observer = new Observer(this.projectRoot, this.configLoader);
    this.reconciler = new Reconciler(this.projectRoot, this.auditLogger);
    this.planner = new Planner(this.projectRoot, this.configLoader);
    this.taskCompiler = new TaskCompiler(this.projectRoot);
    this.complexityEngine = new ComplexityEngine(this.configLoader);
    this.routingEngine = new RoutingEngine(this.configLoader);
    this.executor = new Executor(this.projectRoot, this.auditLogger);
    this.reviewPipeline = new ReviewPipeline();
    this.verifier = new Verifier(this.projectRoot, this.auditLogger, this.configLoader);
    this.remediationEngine = new RemediationEngine(this.projectRoot, this.configLoader, this.auditLogger);
    this.asBuiltGenerator = new AsBuiltGenerator(this.projectRoot, this.auditLogger);
    this.evidenceCollector = new EvidenceCollector(this.projectRoot, this.configLoader, this.auditLogger);
    this.gateKeeper = new GateKeeper(this.projectRoot, this.configLoader, this.auditLogger);
    this.agentBridge = new AgentBridge(this.projectRoot, this.configLoader, this.auditLogger);
    this.team = new TeamCoordinator(this.projectRoot, this.auditLogger);
    this.idRegistry = new IdRegistry(this.projectRoot, this.auditLogger);
    this.policyEngine = new PolicyEngine(this.projectRoot, this.configLoader);
    this.worktrees = new WorktreeManager(this.projectRoot, this.auditLogger);
    this.milestones = new MilestoneManager(this.projectRoot, this.auditLogger, this.idRegistry);
  }

  public generateRunId(): string {
    return this.idRegistry.generateRunId();
  }

  public loadCurrentRun(): RunDescriptor | undefined {
    const file = path.join(this.projectRoot, '.agentic', 'execution', 'current-run.json');
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as RunDescriptor;
    } catch {
      return undefined;
    }
  }

  /**
   * A run written by an older (or newer) build cannot be resumed or closed with
   * the current rules: its fields mean something else. Refusing beats guessing.
   */
  public isRunCompatible(run: RunDescriptor | undefined): boolean {
    return Boolean(run) && isCurrent(run);
  }

  public async runCycle(options: OrchestrationOptions = {}): Promise<RunDescriptor> {
    const parked = this.loadCurrentRun();
    if (parked && !this.isRunCompatible(parked) && (options.resume ?? true) && !options.runId) {
      // Do not resume across a schema change; start clean instead of misreading it.
      this.auditLogger.emit('SYSTEM', 'RUN_BLOCKED', {
        metadata: {
          reason: 'incompatible run artifact',
          run: parked.run_id,
          schema_version: parked.schema_version ?? 1,
          expected: ARTIFACT_SCHEMA_VERSION,
        },
      });
    } else if ((options.resume ?? true) && parked?.status === 'AWAITING_AGENT' && !options.runId) {
      return this.closeCycle(parked, options);
    }

    const runId = options.runId || this.generateRunId();
    this.auditLogger.emit(runId, 'RUN_STARTED', {
      metadata: { actor: this.team.identity().email, phase: options.phaseId, dry_run: Boolean(options.dryRun) },
    });

    const sm = new StateMachine(runId, 'IDLE', this.configLoader, this.auditLogger);

    // ---- 1. OBSERVE -------------------------------------------------------
    sm.transition('next');
    const observedBefore = this.observer.observe(runId, { runTests: options.observeTests });
    const observeEvidence = this.observer.getLastEvidence();

    // ---- 2. RECONCILE -----------------------------------------------------
    sm.transition('success');
    const reconciled = this.reconciler.reconcile(runId, observedBefore);
    if (reconciled.status === 'MISMATCH') {
      sm.transition('needs_state_repair');
      this.reconciler.syncDeclaredState(runId, observedBefore);
      sm.transition('success');
    } else {
      sm.transition('success');
    }

    // ---- 3. PLAN ----------------------------------------------------------
    const workPackage = this.planner.getCurrentWorkPackage();
    workPackage.run_id = runId;
    if (options.phaseId) workPackage.phase = options.phaseId;

    const leaseCheck = this.team.check(workPackage.phase);
    if (!leaseCheck.available && !options.force) {
      this.auditLogger.emit(runId, 'RUN_BLOCKED', { metadata: { reason: leaseCheck.reason } });
      const blocked = this.buildDescriptor({
        runId,
        status: 'BLOCKED',
        observedBefore,
        workPackage,
        options,
        blockers: [leaseCheck.reason],
      });
      this.saveCurrentRun(blocked);
      return blocked;
    }
    this.team.claim(workPackage.phase, { runId, force: options.force });

    workPackage.milestone = this.milestones.currentMilestoneId();
    this.milestones.registerPhase({
      phase: workPackage.phase,
      title: workPackage.goal,
      requirements: workPackage.requirements,
    });

    this.planner.saveWorkPackage(workPackage);
    this.auditLogger.emit(runId, 'WORK_PACKAGE_CREATED', {
      metadata: { milestone: workPackage.milestone, phase: workPackage.phase, complexity: workPackage.complexity },
    });

    // ---- 4. SPECIFY + HUMAN GATES ----------------------------------------
    sm.transition('success');
    const taskNodes = this.deriveTaskNodes(workPackage, options.specKitDoc);
    const plannedWrites = taskNodes.flatMap((n) => n.ownership.write);

    // The per-kind policies need a classification to key on.
    const classification: ChangeClassification = this.policyEngine.classify(
      `${workPackage.goal} ${workPackage.expected_domains.join(' ')}`,
      { domain: workPackage.expected_domains[0], complexity: workPackage.complexity }
    );
    if (!workPackage.change_kind) {
      workPackage.change_kind = classification.kind;
    }

    const specViolations = this.policyEngine.checkSpecRequirement(classification, {
      hasSpec: Boolean(options.specKitDoc || options.specFile) || this.hasPlannedSpec(workPackage),
    });

    if (specViolations.length > 0) {
      for (const violation of specViolations) {
        this.auditLogger.emit(runId, 'POLICY_VIOLATION', {
          metadata: { code: violation.code, policy: violation.policy, message: violation.message },
        });
      }
      sm.transition('failure');
      const blocked = this.buildDescriptor({
        runId,
        status: sm.getState(),
        observedBefore,
        workPackage,
        options,
        blockers: specViolations.map((v) => `${v.policy}: ${v.message} -> ${v.remedy}`),
      });
      this.saveCurrentRun(blocked);
      return blocked;
    }

    const gateEvaluation = this.gateKeeper.evaluate({
      runId,
      workPackage,
      observed: observedBefore,
      plannedWrites,
      repeatedRemediationFailure: workPackage.requirements.some((r) => this.remediationEngine.isExhausted(r)),
    });

    if (gateEvaluation.blocked) {
      sm.transition('blocked_by_gate');
      this.auditLogger.emit(runId, 'RUN_BLOCKED', {
        metadata: {
          reason: 'human gate pending',
          gates: gateEvaluation.triggered.map((g) => `${g.id} (${g.status})`),
        },
      });
      const blocked = this.buildDescriptor({
        runId,
        status: sm.getState(),
        observedBefore,
        workPackage,
        options,
        blockers: gateEvaluation.triggered.map((g) => `${g.gate}: ${g.reason} [${g.id}] -> agentic gate approve ${g.id}`),
      });
      this.saveCurrentRun(blocked);
      return blocked;
    }

    this.auditLogger.emit(runId, 'SPEC_READY');
    sm.transition('success');
    sm.transition('next');

    // ---- 5. COMPILE DAG ---------------------------------------------------
    // Tasks are compiled as declared, then any pair that would write the same
    // paths in the same wave is serialized. This is what turns the DAG from a
    // formality into real waves: independent slices run together, colliding
    // ones are ordered instead of racing.
    let dag = this.taskCompiler.compile(taskNodes);
    if (dag.conflicts.length > 0) {
      this.auditLogger.emit(runId, 'REVIEW_FINDING', {
        metadata: { layer: 'L0', category: 'write-conflict', conflicts: dag.conflicts },
      });
      const serialized = this.serializeConflicts(taskNodes, dag.conflicts);
      if (serialized) {
        dag = this.taskCompiler.compile(serialized);
      }
    }
    sm.transition('success');

    // ---- 6. COMPLEXITY + ROUTING -----------------------------------------
    const complexity = this.complexityEngine.assess({
      estimatedFiles: taskNodes.length * 2,
      domainsCount: workPackage.expected_domains.length,
      hasDatabaseMigration: observedBefore.project.migrations.length > 0,
      hasSecurityImpact: workPackage.expected_domains.includes('security'),
    });
    const executionProvider = this.routingEngine.resolveExecutionProvider();
    const verificationProvider = this.routingEngine.resolveVerificationProvider();

    // ---- 7. EXECUTE (delegated to the coding agent) -----------------------
    sm.transition('next');
    const contracts: TaskContract[] = dag.nodes.map((node) => this.executor.createTaskContract(node));
    this.agentBridge.resetInbox();

    // policies.worktree.parallel_agents: isolate tasks that share a wave.
    const worktreePlan = this.worktrees.plan(dag);
    let worktreeMap: Record<string, { directory: string; branch: string }> | undefined;
    if (
      !options.noWorktrees &&
      worktreePlan.parallelTasks.length > 0 &&
      this.policyEngine.requiresWorktreeForParallelAgents()
    ) {
      const { worktrees, skipped } = this.worktrees.ensure(runId, worktreePlan.parallelTasks);
      worktreeMap = Object.fromEntries(
        worktrees.map((w) => [w.task_id, { directory: w.directory, branch: w.branch }])
      );
      for (const skip of skipped) {
        this.auditLogger.emit(runId, 'REVIEW_FINDING', {
          task: skip.task,
          metadata: { layer: 'L0', category: 'worktree', description: `isolation unavailable: ${skip.reason}` },
        });
      }
    }

    const dispatch = this.agentBridge.dispatch({
      runId,
      dag,
      contracts,
      goal: workPackage.goal,
      specFile: options.specFile,
      decisionRefs: (options.decisionRecords || []).map((d) => d.id),
      openQuestions: options.grillResult?.unresolved_items,
      assumptions: options.grillResult?.probes
        .filter((p) => p.assumed)
        .map((p) => `${p.question} -> ${p.resolved_answer}`),
      mode: options.executionMode,
      worktrees: worktreeMap,
      policy: {
        changeKind: classification.kind,
        tdd: classification.tdd,
        atomicCommit: this.policyEngine.requiresAtomicCommitPerTask(),
      },
    });

    if (dispatch.awaiting.length > 0) {
      sm.transition('awaiting_agent');
      const awaiting = this.buildDescriptor({
        runId,
        status: sm.getState(),
        observedBefore,
        workPackage,
        options,
        dag,
        contracts,
        complexity,
        executionProvider,
        verificationProvider,
        dispatch,
        blockers: [
          `${dispatch.awaiting.length} task(s) awaiting implementation. Prompt packs: ${dispatch.index_file}`,
          `Report each with: agentic report <TASK-ID> --status completed`,
          `Then close the cycle with: agentic verify`,
        ],
        evidence: observeEvidence,
      });
      this.saveCurrentRun(awaiting);
      return awaiting;
    }

    const partial = this.buildDescriptor({
      runId,
      status: sm.getState(),
      observedBefore,
      workPackage,
      options,
      dag,
      contracts,
      complexity,
      executionProvider,
      verificationProvider,
      dispatch,
      evidence: observeEvidence,
    });
    this.saveCurrentRun(partial);

    return this.closeCycle(partial, options, sm);
  }

  /**
   * Steps 8-12: review, verify against executed evidence, as-built, state update.
   * Callable on its own (`agentic verify`) once an agent has reported its tasks.
   */
  public async closeCycle(
    run: RunDescriptor,
    options: OrchestrationOptions = {},
    existingStateMachine?: StateMachine
  ): Promise<RunDescriptor> {
    const runId = run.run_id;
    const sm =
      existingStateMachine ||
      new StateMachine(runId, 'AWAITING_AGENT', this.configLoader, this.auditLogger);

    const taskIds = (run.dag?.nodes || []).map((n) => n.id);
    const results = this.agentBridge.collectResults(runId, taskIds);
    const missing = taskIds.filter((id) => !results.some((r) => r.task_id === id && r.status !== 'pending'));
    const failedTasks = results.filter((r) => r.status === 'failed' || r.status === 'blocked');

    if (missing.length > 0) {
      this.auditLogger.emit(runId, 'RUN_BLOCKED', {
        metadata: { reason: 'tasks not reported', missing },
      });
      const stillAwaiting: RunDescriptor = {
        ...run,
        status: 'AWAITING_AGENT',
        blockers: [
          `Cannot verify: ${missing.length} task(s) have no reported result (${missing.join(', ')}).`,
          `Report them with: agentic report <TASK-ID> --status completed|blocked`,
        ],
      };
      this.saveCurrentRun(stillAwaiting);
      return stillAwaiting;
    }

    // ---- 8. REVIEW --------------------------------------------------------
    if (sm.getState() === 'AWAITING_AGENT' || sm.getState() === 'EXECUTING') {
      sm.transition('success');
    }
    const filesChanged = Array.from(new Set(results.flatMap((r) => r.files_changed)));
    const findings: ReviewFinding[] = this.reviewPipeline.runSecurityChecks(filesChanged);
    for (const failed of failedTasks) {
      findings.push({
        layer: 'L1',
        category: 'task-report',
        severity: 'MAJOR',
        description: `Task ${failed.task_id} reported ${failed.status}: ${failed.error || failed.notes?.join('; ') || 'no detail'}`,
      });
    }
    const reviewReport = this.reviewPipeline.evaluateReview(runId, findings);
    for (const finding of findings) {
      this.auditLogger.emit(runId, 'REVIEW_FINDING', {
        metadata: { layer: finding.layer, category: finding.category, severity: finding.severity, description: finding.description },
      });
    }

    if (reviewReport.status === 'CRITICAL') {
      sm.transition('critical');
      const blocked: RunDescriptor = {
        ...run,
        status: sm.getState(),
        review: reviewReport as unknown as Record<string, unknown>,
        blockers: findings.filter((f) => f.severity === 'CRITICAL').map((f) => f.description),
      };
      this.saveCurrentRun(blocked);
      return blocked;
    }

    // ---- 9. VERIFY (executed evidence only) -------------------------------
    sm.transition('success');
    const evidence: EvidenceRecord = this.evidenceCollector.collect({
      runId,
      dryRun: options.dryRun,
    });

    const requirementInputs = (run.dag?.nodes || []).map((node) => {
      const result = results.find((r) => r.task_id === node.id);
      return {
        id: node.requirements[0] || node.id,
        tasks: [node.id],
        acceptanceCriteria: node.acceptance_criteria,
        files: result?.files_changed,
        commit: result?.commit,
        authoredBy: result?.reported_by,
      };
    });

    const verification = this.verifier.verify({
      runId,
      requirements: requirementInputs,
      evidence,
      verifierType: 'fresh_context',
    });

    if (verification.status === 'FAIL') {
      sm.transition('failure');
      const { packages, escalateToHumanGate } = this.remediationEngine.createRemediationPackages(
        verification,
        Object.fromEntries(requirementInputs.map((r) => [r.id, r.tasks]))
      );

      if (escalateToHumanGate) {
        this.gateKeeper.open({
          runId,
          gate: 'repeated_remediation_failure',
          reason: 'Automatic remediation attempts exhausted; human decision required.',
          context: { phase: run.work_package.phase, requirements: requirementInputs.map((r) => r.id) },
        });
        sm.transition('repeated_failure');
      }

      const failedRun: RunDescriptor = {
        ...run,
        status: sm.getState(),
        review: reviewReport as unknown as Record<string, unknown>,
        verification,
        remediations: packages,
        evidence,
        blockers: verification.blocking_findings,
      };
      this.saveCurrentRun(failedRun);
      this.auditLogger.emit(runId, 'RUN_BLOCKED', { metadata: { reason: 'verification failed' } });
      return failedRun;
    }

    if (verification.status !== 'PASS') {
      // BLOCKED or PARTIAL: closure refused. Not a failure to remediate — a human must look.
      sm.transition('needs_human');
      const blockedRun: RunDescriptor = {
        ...run,
        status: sm.getState(),
        review: reviewReport as unknown as Record<string, unknown>,
        verification,
        evidence,
        blockers: verification.blocking_findings || ['Verification produced no closable evidence.'],
      };
      this.saveCurrentRun(blockedRun);
      this.auditLogger.emit(runId, 'RUN_BLOCKED', {
        metadata: { reason: `verification ${verification.status}`, findings: verification.blocking_findings },
      });
      return blockedRun;
    }

    this.remediationEngine.resetAttempts(requirementInputs.map((r) => r.id));

    // ---- 10. RECONCILE IMPLEMENTATION + AS-BUILT --------------------------
    sm.transition('success');
    sm.transition('success');
    const asBuiltPath = this.policyEngine.shouldGenerateAsBuilt()
      ? this.asBuiltGenerator.generate({
      runId,
      milestone: run.work_package.milestone,
      phase: run.work_package.phase,
      baselineCommit: run.baseline_commit,
      resultCommit: evidence.commit,
      verificationReport: verification,
      workPackage: run.work_package,
      filesChanged,
          testsSummary: `${evidence.passed} passed / ${evidence.failed} failed via \`${evidence.command}\` (evidence ${evidence.id}).`,
        })
      : '';

    // ---- 11-12. UPDATE STATE ---------------------------------------------
    sm.transition('success');
    // policies.loop.reobserve_after_success
    const observedAfter = this.policyEngine.shouldReobserveAfterSuccess()
      ? this.observer.observe(runId, { runTests: false })
      : run.initial_observed_state!;
    this.reconciler.syncDeclaredState(runId, observedAfter, {
      milestone: run.work_package.milestone,
      phase: run.work_package.phase,
    });
    // A phase is done when every requirement it carries is closed against
    // evidence; nothing else advances the roadmap.
    const closedPhases = this.milestones.syncFromMatrix(runId);

    this.auditLogger.emit(runId, 'STATE_UPDATED', {
      metadata: closedPhases.length > 0 ? { closed_phases: closedPhases } : undefined,
    });
    sm.transition('no_more_work');

    try {
      this.team.release(run.work_package.phase, { runId });
    } catch {
      // releasing someone else's lease is not fatal for closing the run
    }

    const completed: RunDescriptor = {
      ...run,
      status: sm.getState(),
      finished_at: new Date().toISOString(),
      result_commit: evidence.commit,
      review: reviewReport as unknown as Record<string, unknown>,
      verification,
      evidence,
      as_built: asBuiltPath ? { file: path.relative(this.projectRoot, asBuiltPath) } : undefined,
      commits: Array.from(new Set(results.map((r) => r.commit).filter(Boolean) as string[])),
      resulting_state: observedAfter,
      blockers: undefined,
    };

    this.saveCurrentRun(completed);
    this.auditLogger.emit(runId, 'RUN_COMPLETED', {
      metadata: { verification: verification.verification_id, evidence: evidence.id },
    });
    return completed;
  }

  /** True when a planned spec already exists for this package's requirements. */
  private hasPlannedSpec(workPackage: WorkPackage): boolean {
    const plannedDir = path.join(this.projectRoot, '.agentic', 'specs', 'planned');
    if (!fs.existsSync(plannedDir)) return false;

    const numbers = workPackage.requirements.map((req) => req.replace(/^REQ-/, ''));
    if (numbers.length === 0) return false;

    try {
      const files = fs.readdirSync(plannedDir);
      return numbers.some((number) => files.some((file) => file.includes(number)));
    } catch {
      return false;
    }
  }

  /**
   * Adds dependencies so that tasks with overlapping write paths cannot land in
   * the same wave. Returns undefined when nothing needed changing.
   */
  private serializeConflicts(
    nodes: TaskDAGNode[],
    conflicts: Array<{ task_a: string; task_b: string }>
  ): TaskDAGNode[] | undefined {
    if (conflicts.length === 0) return undefined;

    const byId = new Map(nodes.map((node) => [node.id, { ...node, dependencies: [...node.dependencies] }]));
    let changed = false;

    for (const conflict of conflicts) {
      // Keep the declared order: the later task waits for the earlier one.
      const [first, second] =
        nodes.findIndex((n) => n.id === conflict.task_a) <= nodes.findIndex((n) => n.id === conflict.task_b)
          ? [conflict.task_a, conflict.task_b]
          : [conflict.task_b, conflict.task_a];

      const target = byId.get(second);
      if (target && !target.dependencies.includes(first)) {
        target.dependencies.push(first);
        changed = true;
      }
    }

    return changed ? nodes.map((node) => byId.get(node.id) || node) : undefined;
  }

  private deriveTaskNodes(workPackage: WorkPackage, spec?: GitHubSpecKitDocument): TaskDAGNode[] {
    const domain = workPackage.expected_domains[0] || 'backend';
    const nodes: TaskDAGNode[] = [];

    // Ownership follows the work package scope. Without this, a monorepo task
    // was handed `src/**` and could legitimately write anywhere in the tree,
    // which makes the isolated-ownership invariant decorative.
    const scopedWrites = toGlobs(workPackage.scope?.include);
    const writePaths = scopedWrites.length > 0 ? scopedWrites : ['src/**', 'tests/**'];
    const excluded = toGlobs(workPackage.scope?.exclude);

    const specRequirements = spec?.requirements || [];

    // A decomposed package compiles one task per slice, each with its own
    // ownership and declared dependencies, so independent slices can share a wave.
    if (workPackage.slices && workPackage.slices.length > 0) {
      const taskIdOf = new Map<string, string>();
      workPackage.slices.forEach((slice, index) => {
        taskIdOf.set(slice.requirement, `TASK-${String(index + 1).padStart(3, '0')}`);
      });

      return workPackage.slices.map((slice, index) => {
        const sliceWrites = toGlobs(slice.scope);
        const number = slice.requirement.replace(/^REQ-/, '');
        const specReq = specRequirements.find((r) => r.id === slice.requirement);

        return {
          id: taskIdOf.get(slice.requirement) || `TASK-${String(index + 1).padStart(3, '0')}`,
          title: slice.title,
          domain: slice.domain || domain,
          requirements: [slice.requirement],
          acceptance_criteria: specReq
            ? specReq.acceptance_criteria.map((ac) => ac.id)
            : [`AC-${number}.1`],
          dependencies: (slice.depends_on || [])
            .map((req) => taskIdOf.get(req))
            .filter((id): id is string => Boolean(id)),
          ownership: {
            write: sliceWrites.length > 0 ? sliceWrites : writePaths,
            readonly: ['.agentic/specs/**', 'package.json'],
            forbidden: [...GLOBAL_FORBIDDEN_PATHS, ...excluded],
          },
        };
      });
    }

    const requirementIds =
      workPackage.requirements.length > 0
        ? workPackage.requirements
        : specRequirements.map((r) => r.id);

    requirementIds.forEach((reqId, index) => {
      const specReq = specRequirements.find((r) => r.id === reqId);
      const acceptance = specReq
        ? specReq.acceptance_criteria.map((ac) => ac.id)
        : [`AC-${reqId.replace(/^REQ-/, '')}.1`];

      nodes.push({
        id: `TASK-${String(index + 1).padStart(3, '0')}`,
        title: specReq ? specReq.title : `Implement specification for ${reqId}`,
        domain,
        requirements: [reqId],
        acceptance_criteria: acceptance,
        // Tasks are serialized by default: parallelism is only safe once ownership
        // boundaries are explicit, and the compiler flags overlapping writes.
        dependencies: index > 0 ? [`TASK-${String(index).padStart(3, '0')}`] : [],
        ownership: {
          write: writePaths,
          readonly: ['.agentic/specs/**', 'package.json'],
          forbidden: [...GLOBAL_FORBIDDEN_PATHS, ...excluded],
        },
      });
    });

    if (nodes.length === 0) {
      nodes.push({
        id: 'TASK-001',
        title: `Execute work package for ${workPackage.phase}`,
        domain,
        requirements: [],
        acceptance_criteria: [],
        dependencies: [],
        ownership: {
          write: writePaths,
          readonly: ['.agentic/specs/**'],
          forbidden: [...GLOBAL_FORBIDDEN_PATHS, ...excluded],
        },
      });
    }

    return nodes;
  }

  private buildDescriptor(input: {
    runId: string;
    status: RunDescriptor['status'];
    observedBefore: RunDescriptor['initial_observed_state'];
    workPackage: WorkPackage;
    options: OrchestrationOptions;
    dag?: RunDescriptor['dag'];
    contracts?: TaskContract[];
    complexity?: unknown;
    executionProvider?: unknown;
    verificationProvider?: unknown;
    dispatch?: unknown;
    blockers?: string[];
    evidence?: EvidenceRecord;
  }): RunDescriptor {
    return {
      run_id: input.runId,
      status: input.status,
      started_at: input.observedBefore?.timestamp || new Date().toISOString(),
      baseline_commit: input.observedBefore?.git.commit || 'unknown',
      initial_observed_state: input.observedBefore,
      work_package: input.workPackage,
      bmad_briefing: input.options.bmadBriefing,
      grill_me: input.options.grillResult,
      decisions: input.options.decisionRecords,
      spec_kit: input.options.specKitDoc,
      dag: input.dag,
      tasks: input.contracts,
      routing: {
        complexity: input.complexity,
        execution_provider: input.executionProvider,
        verification_provider: input.verificationProvider,
      } as Record<string, unknown>,
      dispatch: input.dispatch as Record<string, unknown>,
      evidence: input.evidence,
      blockers: input.blockers,
    };
  }

  private saveCurrentRun(run: RunDescriptor) {
    const execDir = path.join(this.projectRoot, '.agentic', 'execution');
    const runsDir = path.join(execDir, 'runs', run.run_id);
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    const serialized = JSON.stringify(stampVersion(run), null, 2);
    fs.writeFileSync(path.join(execDir, 'current-run.json'), serialized, 'utf8');
    fs.writeFileSync(path.join(runsDir, 'run.json'), serialized, 'utf8');
  }
}
