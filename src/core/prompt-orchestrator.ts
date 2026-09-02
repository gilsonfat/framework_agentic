import path from 'path';
import { Orchestrator } from './orchestrator.js';
import { Planner } from './planner.js';
import { BmadEngine } from './bmad-engine.js';
import { GrillMeEngine } from './grill-me-engine.js';
import { DecisionRecorder } from './decision-recorder.js';
import { SpecEngine } from './spec-engine.js';
import { IdRegistry } from './id-registry.js';
import { TeamCoordinator } from './team.js';
import { SkillRegistry } from './skill-registry.js';
import { ComplexityLevel } from '../types/config.js';
import { WorkPackage } from '../types/task.js';
import { RunDescriptor } from '../types/run.js';
import { ExecutionMode } from '../types/execution.js';

export interface PromptDispatchOptions {
  phaseId?: string;
  domain?: string;
  complexity?: ComplexityLevel;
  interactiveGrill?: boolean;
  skipGrill?: boolean;
  userAnswers?: Record<string, string>;
  /** Refuse to proceed while Grill-Me probes remain unanswered. */
  strict?: boolean;
  /** Prepare all artifacts without executing tests or closing requirements. */
  dryRun?: boolean;
  executionMode?: ExecutionMode;
  force?: boolean;
  observeTests?: boolean;
}

/**
 * Turns a free-form instruction into the framework's artifacts (BMAD briefing,
 * probes, ADRs, Spec Kit contract, work package) and then hands the compiled
 * work to the orchestrator.
 *
 * Note on responsibility: this layer *structures* the request. It does not claim
 * that the request was implemented — the run status returned by the orchestrator
 * is the truth, and it is normally `AWAITING_AGENT` until an agent implements the
 * prompt packs and evidence is collected.
 */
export class PromptOrchestrator {
  private projectRoot: string;
  private orchestrator: Orchestrator;
  private planner: Planner;
  private bmadEngine: BmadEngine;
  private grillMeEngine: GrillMeEngine;
  private decisionRecorder: DecisionRecorder;
  private specEngine: SpecEngine;
  private idRegistry: IdRegistry;
  private team: TeamCoordinator;
  private skills: SkillRegistry;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.orchestrator = new Orchestrator(this.projectRoot);
    this.planner = new Planner(this.projectRoot);
    this.bmadEngine = new BmadEngine(this.projectRoot);
    this.grillMeEngine = new GrillMeEngine(this.projectRoot);
    this.idRegistry = new IdRegistry(this.projectRoot);
    this.decisionRecorder = new DecisionRecorder(this.projectRoot, this.idRegistry);
    this.specEngine = new SpecEngine(this.projectRoot);
    this.team = new TeamCoordinator(this.projectRoot);
    this.skills = new SkillRegistry(this.projectRoot);
  }

  public async dispatchPrompt(
    promptText: string,
    options: PromptDispatchOptions = {}
  ): Promise<RunDescriptor> {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt) {
      throw new Error('Prompt instruction cannot be empty.');
    }

    console.log(`\n=============================================================`);
    console.log(`>>> STRUCTURING PROMPT (BMAD -> GRILL-ME -> ADR -> SPEC KIT):`);
    console.log(`"${trimmedPrompt}"`);
    console.log(`=============================================================\n`);

    const domain = options.domain || this.inferDomain(trimmedPrompt);
    const complexity = options.complexity || this.inferComplexity(trimmedPrompt);

    // Sequential, collision-free identifiers shared by the whole team.
    const runId = this.orchestrator.generateRunId();
    const { reqId, specId, phaseId: allocatedPhase } = this.idRegistry.allocateWorkUnit({
      runId,
      title: trimmedPrompt.slice(0, 80),
    });
    const phaseId = options.phaseId || allocatedPhase;

    // ---- 1. BMAD briefing -------------------------------------------------
    console.log(`>>> [1/4] BMAD refinement (Business, Modeling, Architecture, Delivery)...`);
    const bmadBriefing = this.bmadEngine.enhancePrompt(trimmedPrompt, { domain });
    const bmadFile = this.bmadEngine.saveBriefing(bmadBriefing, runId);
    console.log(`+ Briefing: "${bmadBriefing.title}" -> ${path.relative(this.projectRoot, bmadFile)}`);
    this.printSkillHint('refine', domain, 'deepen this briefing');

    // ---- 2. Grill-Me probing ---------------------------------------------
    console.log(`\n>>> [2/4] Grill-Me adversarial probing...`);
    const grillResult = this.grillMeEngine.grill(trimmedPrompt, bmadBriefing, {
      interactive: options.interactiveGrill,
      userAnswers: options.userAnswers,
      answeredBy: this.team.identity().email,
    });
    console.log(
      `+ ${grillResult.probes.length} probes | ${grillResult.probes.length - grillResult.unresolved_items.length} answered | ${grillResult.unresolved_items.length} running on unconfirmed defaults`
    );

    if (grillResult.unresolved_items.length > 0) {
      for (const item of grillResult.unresolved_items) {
        console.log(`  ! ${item}`);
      }
      this.printSkillHint('probe', domain, 'interview the open questions with a human');

      if (options.strict) {
        console.log(
          `\n>>> BLOCKED by --strict: answer the probes above with --answers <file.json> before implementation.`
        );
        throw new Error(
          `${grillResult.unresolved_items.length} architectural probe(s) unanswered while --strict is on.`
        );
      }
      console.log(
        `  (assumptions are carried into every task prompt pack and keep the ADR in PROPOSED status)`
      );
    }

    // ---- 3. Decision records ---------------------------------------------
    console.log(`\n>>> [3/4] Recording architectural decisions...`);
    const decisionRecords = this.decisionRecorder.recordDecisions(runId, grillResult, bmadBriefing, reqId);
    for (const decision of decisionRecords) {
      console.log(`+ ${decision.id} — "${decision.title}" [${decision.status}]`);
    }

    // ---- 4. Spec Kit contract --------------------------------------------
    console.log(`\n>>> [4/4] Generating Spec Kit contract (${specId})...`);
    const specKitDoc = this.specEngine.generateGitHubSpecKit({
      reqId,
      phaseId,
      milestone: 'M01',
      promptText: trimmedPrompt,
      bmad: bmadBriefing,
      decisions: decisionRecords,
    });
    const specFile = this.specEngine.saveGitHubSpecKit(specKitDoc);
    console.log(`+ Contract: ${path.relative(this.projectRoot, specFile)}`);
    this.printSkillHint('specify', domain, 'enrich this contract (keep the registry ids)');

    // ---- Work package -----------------------------------------------------
    const workPackage: WorkPackage = {
      run_id: runId,
      milestone: 'M01',
      phase: phaseId,
      goal: bmadBriefing.title,
      scope: {
        include: bmadBriefing.business.scope_in,
        exclude: bmadBriefing.business.scope_out,
      },
      requirements: [reqId],
      dependencies: [],
      risks: [...bmadBriefing.delivery.key_risks, ...grillResult.unresolved_items],
      blockers: [],
      complexity,
      expected_domains: [domain],
      human_gate_required: complexity === 'XL' || domain === 'security',
    };
    this.planner.saveWorkPackage(workPackage);
    console.log(`\n+ Work package ${phaseId} [${complexity}] domain=${domain} requirement=${reqId}`);

    // ---- Delivery cycle ---------------------------------------------------
    const runResult = await this.orchestrator.runCycle({
      runId,
      phaseId,
      bmadBriefing,
      grillResult,
      decisionRecords,
      specKitDoc,
      specFile: path.relative(this.projectRoot, specFile),
      dryRun: options.dryRun,
      executionMode: options.executionMode,
      force: options.force,
      observeTests: options.observeTests,
      resume: false,
    });

    this.printOutcome(runResult);
    return runResult;
  }

  /**
   * Suggests the team's agreed skill for a stage, but only when the pack is
   * actually installed: printing a command the machine cannot run is noise.
   */
  private printSkillHint(stage: 'refine' | 'probe' | 'specify', domain: string, purpose: string): void {
    const available = this.skills.forStage(stage, { domain, onlyInstalled: true });
    if (available.length === 0) return;
    console.log(`  -> skill available to ${purpose}: ${available.map((r) => r.invocation).join(', ')}`);
  }

  /** Prints what actually happened and what the operator must do next. */
  private printOutcome(run: RunDescriptor): void {
    console.log(`\n=============================================================`);
    console.log(`>>> RUN ${run.run_id} — STATUS: ${run.status}`);
    console.log(`- Requirement(s): ${run.work_package.requirements.join(', ') || 'none'}`);
    console.log(`- Spec Kit: ${run.spec_kit?.spec_id || 'n/a'} | ADRs: ${run.decisions?.length || 0}`);
    console.log(`- Verification: ${run.verification?.status || 'NOT RUN'}`);
    if (run.evidence) {
      console.log(
        `- Evidence: ${run.evidence.id} [${run.evidence.source}/${run.evidence.status}] ${run.evidence.passed} passed / ${run.evidence.failed} failed`
      );
    }
    if (run.blockers && run.blockers.length > 0) {
      console.log(`\n>>> NEXT ACTIONS:`);
      for (const blocker of run.blockers) {
        console.log(`  - ${blocker}`);
      }
    }
    console.log(`=============================================================\n`);
  }

  private inferDomain(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (/banco|database|migration|tabela|schema|sql/.test(lower)) return 'database';
    if (/tela|layout|frontend|\bui\b|component|css|react/.test(lower)) return 'frontend';
    if (/seguran|security|auth|jwt|login|token|senha/.test(lower)) return 'security';
    if (/teste|test|e2e|coverage/.test(lower)) return 'testing';
    if (/pagamento|stripe|webhook|pix|checkout|billing/.test(lower)) return 'billing';
    return 'backend';
  }

  private inferComplexity(prompt: string): ComplexityLevel {
    const lower = prompt.toLowerCase();
    if (/refatorar arquitetura|migrar todo|microservi|multiplos modulos|múltiplos módulos/.test(lower)) return 'XL';
    if (/novo modulo|novo módulo|sistema de pagamento|fluxo completo/.test(lower)) return 'L';
    if (/criar rota|endpoint|adicionar campo|corrigir bug/.test(lower)) return 'S';
    if (/ajuste|typo|renomear/.test(lower)) return 'XS';
    return 'M';
  }
}
