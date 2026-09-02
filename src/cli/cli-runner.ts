import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';
import { Orchestrator } from '../core/orchestrator.js';
import { Doctor } from '../core/doctor.js';
import { StatusDashboard } from '../core/status.js';
import { Observer } from '../core/observer.js';
import { Reconciler } from '../core/reconciler.js';
import { RecoveryEngine } from '../core/recovery.js';
import { Scaffolder } from '../core/scaffolder.js';
import { SetupOrchestrator, SetupOptions } from '../core/setup-orchestrator.js';
import { promptInteractiveSetup } from './interactive-setup.js';
import { PromptOrchestrator } from '../core/prompt-orchestrator.js';
import { AgentBridge } from '../core/agent-bridge.js';
import { EvidenceCollector } from '../core/evidence-collector.js';
import { GateKeeper } from '../core/gate-keeper.js';
import { TeamCoordinator } from '../core/team.js';
import { AuditLogger } from '../core/audit-logger.js';
import { IdRegistry } from '../core/id-registry.js';
import { SkillRegistry } from '../core/skill-registry.js';
import { AgentIntegrations, ALL_PRODUCT_IDS } from '../core/agent-integrations.js';
import { SkillStage } from '../types/skills.js';
import { AgentProductId } from '../types/integrations.js';
import { Migrator } from '../core/migrator.js';
import { ModuleDetector } from '../core/module-detector.js';
import { ArtifactValidator } from '../core/artifact-validator.js';
import { ARTIFACT_SCHEMA_VERSION } from '../core/artifact-schema.js';
import { CliError, reportError, requireInitialized } from './errors.js';
import { PolicyEngine } from '../core/policy-engine.js';
import { WorktreeManager } from '../core/worktree-manager.js';
import { ChangeKind } from '../types/policy.js';
import { ExecutionMode } from '../types/execution.js';

function resolveTarget(options: { target?: string }, projectRoot: string): string {
  return path.resolve(options.target || projectRoot);
}

/**
 * Target directory for a command that cannot run on an uninitialized project.
 * Keeping the guard next to the resolution means no command can forget it.
 */
function resolveInitialized(options: { target?: string }, projectRoot: string, command: string): string {
  const targetDir = resolveTarget(options, projectRoot);
  requireInitialized(targetDir, command);
  return targetDir;
}

/**
 * Wraps a gate decision so an unknown or already-decided gate reads as an
 * operator mistake, not as a crash in the framework.
 */
function decideGate(keeper: GateKeeper, gateId: string, decision: 'APPROVED' | 'REJECTED', note?: string) {
  try {
    return keeper.decide(gateId, decision, note);
  } catch (error) {
    const pending = keeper.listPending();
    throw new CliError(
      error instanceof Error ? error.message : String(error),
      pending.length > 0
        ? `Pending gates: ${pending.map((g) => g.id).join(', ')}`
        : 'There are no pending gates. List them with: agentic gate list'
    );
  }
}

/** The CLI version is read from package.json so the two can never drift. */
function readVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const candidate of [
      path.resolve(here, '..', '..', 'package.json'),
      path.resolve(here, '..', '..', '..', 'package.json'),
    ]) {
      if (fs.existsSync(candidate)) {
        const pkg = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (pkg.version && pkg.name?.includes('agentic')) return pkg.version;
      }
    }
  } catch {
    // fall through to the default below
  }
  return '0.0.0-dev';
}

function loadAnswers(file?: string): Record<string, string> | undefined {
  if (!file) return undefined;
  const full = path.resolve(file);
  if (!fs.existsSync(full)) {
    throw new Error(`Answers file not found: ${full}`);
  }
  return JSON.parse(fs.readFileSync(full, 'utf8')) as Record<string, string>;
}

/** Parses `--agents claude,gemini` into validated product ids. */
function parseProducts(value?: string): AgentProductId[] | undefined {
  if (!value || value.trim().toLowerCase() === 'all') return undefined;

  const requested = value
    .split(/[,;\s]+/)
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);

  const unknown = requested.filter((v) => !ALL_PRODUCT_IDS.includes(v as AgentProductId));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown AI product(s): ${unknown.join(', ')}. Supported: ${ALL_PRODUCT_IDS.join(', ')} (or "all").`
    );
  }

  return requested as AgentProductId[];
}

function splitList(value?: string): string[] {
  if (!value) return [];
  return value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

export function createCli(projectRoot: string = process.cwd()): Command {
  const program = new Command();

  program
    .name('agentic')
    .description('Agentic SDLC Orchestrator CLI - state-driven, evidence-gated software delivery')
    .version(readVersion());

  // ---------------------------------------------------------------- setup ---
  const runSetup = async (options: Record<string, unknown>) => {
    let targetDir = resolveTarget(options as { target?: string }, projectRoot);
    const processEngine = options.withEcc
      ? 'ecc'
      : ((options.process as 'superpowers' | 'ecc' | 'native') || 'superpowers');

    let setupOptions: SetupOptions = {
      targetDir,
      installEngines: Boolean(options.all),
      force: Boolean(options.force),
      processEngine,
      enableGsd: !options.withoutGsd,
      enableTlc: !options.withoutTlc,
      enableRuflo: !options.withoutRuflo,
      enableRules: !options.withoutRules,
      products: parseProducts(options.agents as string | undefined),
      enablePermissions: !options.withoutPermissions,
      enableHooks: !options.withoutHooks,
      testCommand: options.testCommand as string | undefined,
      executionMode: options.executionMode as 'delegated' | 'command' | undefined,
      grillMode: options.grillMode as 'adaptive' | 'strict' | undefined,
      skills: options.skills ? (options.skills as string).split(',').map((s) => s.trim()) : undefined,
    };

    if (options.interactive) {
      setupOptions = await promptInteractiveSetup(setupOptions);
      targetDir = setupOptions.targetDir || targetDir;
    }

    new SetupOrchestrator(targetDir).runFullSetup(setupOptions);
  };

  const withSetupOptions = (command: Command) =>
    command
      .option('-t, --target <path>', 'Target project directory', projectRoot)
      .option('-i, --interactive', 'Run interactive setup wizard to configure preferences and skills', false)
      .option(
        '-a, --agents <list>',
        `AI products to wire: all | ${ALL_PRODUCT_IDS.join(' | ')} (comma separated)`,
        'all'
      )
      .option('--all', 'Also attempt to install the external provider engines', false)
      .option('-f, --force', 'Overwrite instruction files even if they were edited', false)
      .option('--process <engine>', 'Process engine (superpowers | ecc | native)', 'superpowers')
      .option('--with-ecc', 'Use ECC as the process engine instead of Superpowers', false)
      .option('--without-gsd', 'Disable the GSD planner provider', false)
      .option('--without-tlc', 'Disable the TLC spec/verifier provider', false)
      .option('--without-ruflo', 'Disable the Ruflo execution provider', false)
      .option('--without-rules', 'Do not write any AI instruction file', false)
      .option('--without-permissions', 'Do not pre-approve agentic commands in .claude/settings.json', false)
      .option('--without-hooks', 'Do not add the Claude Code SessionStart hook', false)
      .option('--test-command <cmd>', 'Custom test command (e.g. npm test, pnpm test, vitest)')
      .option('--execution-mode <mode>', 'Task execution mode: delegated | command')
      .option('--grill-mode <mode>', 'Grill-Me interrogation mode: adaptive | strict')
      .option('--skills <list>', 'Enabled skill packs (comma separated, e.g. mattpocock,ecc)');

  withSetupOptions(
    program
      .command('init')
      .description('Set up everything: .agentic architecture + every AI product wired to the workflow')
  )
    .option('--scaffold-only', 'Only create the .agentic directory (no AI instruction files)', false)
    .action((options) => {
      const targetDir = resolveTarget(options, projectRoot);
      if (options.scaffoldOnly) {
        console.log(`>>> Scaffolding .agentic in: ${targetDir}`);
        const result = new Scaffolder().scaffold(targetDir, { force: options.force, autoObserve: true });
        console.log(`+ Directories: ${result.createdDirectories.length} | Files: ${result.createdFiles.length}`);
        if (result.skippedFiles.length > 0) {
          console.log(`i Preserved: ${result.skippedFiles.length} existing file(s) (use --force to overwrite)`);
        }
        console.log('>>> Done. Run "agentic doctor" to verify readiness.');
        return;
      }
      runSetup(options);
    });

  withSetupOptions(
    program.command('setup').description('Alias of `init`: full setup of the framework and the AI integrations')
  ).action(runSetup);

  withSetupOptions(
    program.command('bootstrap').description('Alias of `init`, kept for existing scripts')
  ).action(runSetup);

  // -------------------------------------------------------------- delivery ---
  program
    .command('prompt <instructions...>')
    .alias('do')
    .description('Structure an instruction (BMAD -> Grill-Me -> ADR -> Spec Kit) and start the delivery cycle')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-d, --domain <domain>', 'Explicit domain (backend, frontend, database, security, billing, testing)')
    .option('-c, --complexity <level>', 'Explicit complexity level (XS, S, M, L, XL)')
    .option('-g, --interactive-grill', 'Mark the probing session as interactive', false)
    .option('-a, --answers <file>', 'JSON file with answers to Grill-Me probes, keyed by probe id')
    .option('-s, --strict', 'Refuse to proceed while any probe is unanswered', false)
    .option('--dry-run', 'Produce artifacts and prompt packs without executing tests or closing work', false)
    .option('-m, --mode <mode>', 'Execution mode: delegated | command')
    .option('--observe-tests', 'Run the test suite during OBSERVE to record a baseline', false)
    .option(
      '--split <slice>',
      'Decompose the request into slices (repeat the flag); each becomes its own REQ and task',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[]
    )
    .option('--parallel', 'Let independent slices share a wave instead of chaining them', false)
    .option('--no-worktrees', 'Do not create git worktrees for parallel tasks')
    .option('-f, --force', 'Take over a phase lease held by a teammate', false)
    .action(async (instructionsArray: string[], options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'prompt');
      await new PromptOrchestrator(targetDir).dispatchPrompt(instructionsArray.join(' '), {
        slices: options.split,
        parallelSlices: options.parallel,
        noWorktrees: options.worktrees === false,
        domain: options.domain,
        complexity: options.complexity,
        interactiveGrill: options.interactiveGrill,
        userAnswers: loadAnswers(options.answers),
        strict: options.strict,
        dryRun: options.dryRun,
        executionMode: options.mode as ExecutionMode | undefined,
        observeTests: options.observeTests,
        force: options.force,
      });
    });

  program
    .command('grill <instructions...>')
    .description('Run adversarial probing and record ADRs (assumptions stay marked as assumptions)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-a, --answers <file>', 'JSON file with answers to probes, keyed by probe id')
    .action(async (instructionsArray: string[], options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'grill');
      const instruction = instructionsArray.join(' ');
      const { BmadEngine } = await import('../core/bmad-engine.js');
      const { GrillMeEngine } = await import('../core/grill-me-engine.js');
      const { DecisionRecorder } = await import('../core/decision-recorder.js');

      const briefing = new BmadEngine(targetDir).enhancePrompt(instruction);
      const grill = new GrillMeEngine(targetDir);
      const result = grill.grill(instruction, briefing, {
        interactive: true,
        userAnswers: loadAnswers(options.answers),
        answeredBy: new TeamCoordinator(targetDir).identity().email,
      });
      console.log(grill.formatGrillReport(result));

      const runId = `RUN-GRILL-${Date.now()}`;
      const records = new DecisionRecorder(targetDir).recordDecisions(runId, result, briefing);
      console.log(`+ Recorded ${records.length} ADR(s) in .agentic/specs/decisions/`);
      for (const record of records) {
        console.log(`  - ${record.id}: ${record.title} [${record.status}]`);
      }
      if (!result.fully_resolved) {
        console.log(
          `\n! ADRs remain PROPOSED until every probe is answered. Re-run with --answers to ratify them.`
        );
      }
    });

  program
    .command('spec <instructions...>')
    .description('Generate a Spec Kit formal contract for an instruction')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action(async (instructionsArray: string[], options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'spec');
      const instruction = instructionsArray.join(' ');
      const { BmadEngine } = await import('../core/bmad-engine.js');
      const { SpecEngine } = await import('../core/spec-engine.js');

      const briefing = new BmadEngine(targetDir).enhancePrompt(instruction);
      const registry = new IdRegistry(targetDir);
      const { reqId, phaseId } = registry.allocateWorkUnit({ title: instruction.slice(0, 80) });

      const spec = new SpecEngine(targetDir);
      const doc = spec.generateGitHubSpecKit({ reqId, phaseId, bmad: briefing, promptText: instruction });
      const savedPath = spec.saveGitHubSpecKit(doc);
      console.log(`\n>>> Spec Kit contract generated:`);
      console.log(`- Spec ID:     ${doc.spec_id}`);
      console.log(`- Requirement: ${reqId}`);
      console.log(`- Title:       ${doc.title}`);
      console.log(`- File:        ${path.relative(targetDir, savedPath)}`);
    });

  program
    .command('run')
    .description('Run the delivery cycle (resumes a run parked in AWAITING_AGENT by default)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-p, --phase <id>', 'Target a specific phase ID (e.g. P-012)')
    .option('-m, --mode <mode>', 'Execution mode: delegated | command')
    .option('--dry-run', 'Prepare artifacts without executing tests or closing work', false)
    .option('--no-resume', 'Start a new run even if one is parked awaiting an agent')
    .option('--observe-tests', 'Run the test suite during OBSERVE', false)
    .option('--no-worktrees', 'Do not create git worktrees for parallel tasks')
    .option('-f, --force', 'Take over a phase lease held by a teammate', false)
    .action(async (options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'run');
      console.log(`>>> Agentic SDLC cycle in: ${targetDir}`);
      const result = await new Orchestrator(targetDir).runCycle({
        phaseId: options.phase,
        executionMode: options.mode as ExecutionMode | undefined,
        dryRun: options.dryRun,
        resume: options.resume,
        observeTests: options.observeTests,
        noWorktrees: options.worktrees === false,
        force: options.force,
      });

      console.log(`\n>>> Run ${result.run_id} -> ${result.status}`);
      if (result.verification) {
        console.log(`>>> Verification: ${result.verification.status}`);
      }
      for (const blocker of result.blockers || []) {
        console.log(`  - ${blocker}`);
      }
      if (result.status !== 'COMPLETE') {
        process.exitCode = 1;
      }
    });

  program
    .command('report <taskId>')
    .description('Report the outcome of a dispatched task back to the orchestrator')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-s, --status <status>', 'completed | failed | blocked', 'completed')
    .option('--files <list>', 'Comma-separated list of changed files')
    .option('--tests <list>', 'Comma-separated list of test files added or updated')
    .option('--commit <sha>', 'Commit hash produced by this task')
    .option('--note <text>', 'Free-form note (reason for blocked/failed)')
    .option('-r, --run <runId>', 'Run id (defaults to the current run)')
    .option('--force', 'Record the report even if it violates a policy (recorded as an override)', false)
    .action((taskId: string, options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'report');
      const orchestrator = new Orchestrator(targetDir);
      const currentRun = orchestrator.loadCurrentRun();
      const runId = options.run || currentRun?.run_id;
      if (!runId) {
        throw new CliError(
          'No current run to report against.',
          'Start one with: agentic prompt "<instruction>"  (or pass --run <runId>)'
        );
      }

      const filesChanged = splitList(options.files);
      const testsAdded = splitList(options.tests);

      // The policies in policies.yaml only become real at the moment a task
      // claims to be done: this is where TDD and atomic commits are provable.
      const policy = new PolicyEngine(targetDir);
      const classification = policy.classificationFor(
        (currentRun?.work_package?.change_kind as ChangeKind | undefined) || 'feature'
      );
      const violations = policy.checkTaskReport(
        { taskId, status: options.status, filesChanged, testsAdded, commit: options.commit },
        classification
      );

      if (violations.length > 0 && !options.force) {
        const auditor = new AuditLogger(targetDir);
        for (const violation of violations) {
          auditor.emit(runId, 'POLICY_VIOLATION', {
            task: taskId,
            metadata: { code: violation.code, policy: violation.policy, message: violation.message },
          });
        }
        throw new CliError(
          `Report rejected by ${violations.length} policy rule(s):\n` +
            violations.map((v) => `    - [${v.policy}] ${v.message}\n      ${v.remedy}`).join('\n'),
          'Fix the report, or record it as a deliberate exception with --force.'
        );
      }

      const overrideNotes = violations.map((v) => `POLICY OVERRIDE [${v.policy}]: ${v.message}`);
      const result = new AgentBridge(targetDir).recordResult({
        runId,
        taskId,
        status: options.status,
        filesChanged,
        testsAdded,
        commit: options.commit,
        notes: [...(options.note ? [options.note] : []), ...overrideNotes],
        error: options.status !== 'completed' ? options.note : undefined,
      });

      if (violations.length > 0) {
        const auditor = new AuditLogger(targetDir);
        for (const violation of violations) {
          auditor.emit(runId, 'POLICY_OVERRIDDEN', {
            task: taskId,
            metadata: { code: violation.code, policy: violation.policy, actor: result.reported_by },
          });
        }
        console.log(`! Recorded with ${violations.length} policy override(s); the audit stream keeps the reason.`);
      }

      console.log(`+ ${result.task_id} reported as ${result.status} by ${result.reported_by} (run ${runId})`);
      console.log(`  Close the cycle with: agentic verify`);
    });

  program
    .command('record [message]')
    .alias('changelog')
    .description('Record code modifications (uncommitted diff or recent commits) into the respective module CHANGELOG.md')
    .option('-m, --message <text>', 'Description of the modification')
    .option('--files <list>', 'Comma-separated list of changed files (defaults to git diff)')
    .option('--commit <sha>', 'Commit hash or reference')
    .option('--module <name>', 'Specific module to record to')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((messageArg: string | undefined, options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'record');
      const message = options.message || messageArg;
      const files = options.files ? splitList(options.files as string) : undefined;
      const result = new ModuleDetector(targetDir).recordModuleChanges({
        message,
        files,
        commit: options.commit,
        module: options.module,
      });

      if (result.updatedModules.length === 0) {
        console.log('No modified files detected across modules.');
        return;
      }

      console.log(`\n=============================================================`);
      console.log(`   Agentic SDLC — Registro de Alterações em Módulos          `);
      console.log(`=============================================================\n`);
      console.log(`Autor: ${result.actor} | Ref: ${result.commit} | Total Arquivos: ${result.totalFiles}`);
      for (const u of result.updatedModules) {
        console.log(`+ [Módulo ${u.module}] ${u.filesCount} arquivo(s) registrado(s) -> ${u.changelogPath}`);
      }
      console.log(`\n>>> Registros concluídos com sucesso.`);
    });

  program
    .command('verify')
    .description('Collect real test evidence and close the current run (review -> verify -> as-built -> state)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--dry-run', 'Do not execute the suite (closure will be refused)', false)
    .action(async (options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'verify');
      const orchestrator = new Orchestrator(targetDir);
      const current = orchestrator.loadCurrentRun();
      if (!current) {
        console.error('No current run to verify. Start one with `agentic run` or `agentic prompt "..."`.');
        process.exitCode = 1;
        return;
      }

      const result = await orchestrator.closeCycle(current, { dryRun: options.dryRun });
      console.log(`\n>>> Run ${result.run_id} -> ${result.status}`);
      console.log(`>>> Verification: ${result.verification?.status || 'NOT RUN'}`);
      if (result.evidence) {
        console.log(
          `>>> Evidence ${result.evidence.id}: ${result.evidence.command} [${result.evidence.status}] ${result.evidence.passed} passed / ${result.evidence.failed} failed (exit ${String(result.evidence.exit_code)})`
        );
      }
      for (const blocker of result.blockers || []) {
        console.log(`  - ${blocker}`);
      }
      if (result.status !== 'COMPLETE') {
        process.exitCode = 1;
      }
    });

  program
    .command('evidence')
    .description('Execute the test suite and record an auditable evidence record')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-c, --command <cmd>', 'Override the detected test command')
    .option('--show', 'Show the last recorded evidence instead of collecting new evidence', false)
    .action((options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'evidence');
      const collector = new EvidenceCollector(targetDir);

      if (options.show) {
        const latest = collector.latest();
        if (!latest) {
          console.log('No evidence recorded yet.');
          return;
        }
        console.log(JSON.stringify(latest, null, 2));
        return;
      }

      const record = collector.collect({ runId: `RUN-EVIDENCE-${Date.now()}`, command: options.command });
      console.log(`>>> Evidence ${record.id}`);
      console.log(`- command:  ${record.command}`);
      console.log(`- source:   ${record.source}`);
      console.log(`- status:   ${record.status} (exit ${String(record.exit_code)})`);
      console.log(`- counters: ${record.passed} passed / ${record.failed} failed / ${record.skipped} skipped [${record.parser}]`);
      console.log(`- sha256:   ${record.output_sha256}`);
      for (const note of record.notes || []) {
        console.log(`  ! ${note}`);
      }
      if (record.status !== 'pass') {
        process.exitCode = 1;
      }
    });

  // ----------------------------------------------------------------- gates ---
  const gate = program.command('gate').description('Inspect and decide pending human gates');

  gate
    .command('list')
    .description('List pending human gates')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const pending = new GateKeeper(resolveInitialized(options, projectRoot, 'gate list')).listPending();
      if (pending.length === 0) {
        console.log('No pending human gates.');
        return;
      }
      for (const request of pending) {
        console.log(`\n[${request.id}] gate=${request.gate} run=${request.run_id}`);
        console.log(`  reason:  ${request.reason}`);
        console.log(`  phase:   ${request.context.phase || 'n/a'} | complexity: ${request.context.complexity || 'n/a'}`);
        for (const detail of request.context.details || []) {
          console.log(`  detail:  ${detail}`);
        }
        console.log(`  decide:  agentic gate approve ${request.id} --note "<why>"`);
      }
    });

  gate
    .command('approve <gateId>')
    .description('Approve a pending human gate')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--note <text>', 'Rationale recorded with the decision')
    .action((gateId: string, options) => {
      const keeper = new GateKeeper(resolveInitialized(options, projectRoot, 'gate approve'));
      const request = decideGate(keeper, gateId, 'APPROVED', options.note);
      console.log(`+ ${request.id} APPROVED by ${request.decided_by}. Continue with: agentic run`);
    });

  gate
    .command('reject <gateId>')
    .description('Reject a pending human gate')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--note <text>', 'Rationale recorded with the decision')
    .action((gateId: string, options) => {
      const keeper = new GateKeeper(resolveInitialized(options, projectRoot, 'gate reject'));
      const request = decideGate(keeper, gateId, 'REJECTED', options.note);
      console.log(`+ ${request.id} REJECTED by ${request.decided_by}.`);
    });

  // ------------------------------------------------------------------ team ---
  const team = program.command('team').description('Team coordination: identity, claims and collaboration policy');

  team
    .command('init')
    .description('Declare the shared/local artifact split and make the audit stream mergeable')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-f, --force', 'Rewrite existing policy files', false)
    .action((options) => {
      const result = new TeamCoordinator(resolveTarget(options, projectRoot)).ensureCollaborationPolicy({
        force: options.force,
      });
      console.log(`+ Written: ${result.written.join(', ') || 'nothing (already configured)'}`);
      if (result.skipped.length > 0) {
        console.log(`i Preserved: ${result.skipped.join(', ')} (use --force to rewrite)`);
      }
    });

  team
    .command('who')
    .description('Show the current actor identity and all active claims')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const coordinator = new TeamCoordinator(resolveTarget(options, projectRoot));
      const identity = coordinator.identity();
      console.log(`You: ${identity.name} <${identity.email}> on ${identity.host}`);
      const leases = coordinator.list();
      if (leases.length === 0) {
        console.log('No active claims.');
        return;
      }
      for (const lease of leases) {
        const expired = new Date(lease.expires_at).getTime() < Date.now();
        console.log(
          `- ${lease.scope} -> ${lease.owner_name} <${lease.owner_email}> [branch ${lease.branch}] ${expired ? 'EXPIRED' : `until ${lease.expires_at}`}`
        );
      }
    });

  team
    .command('claim <scope>')
    .description('Claim a phase or task so teammates do not drive it concurrently')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--ttl <minutes>', 'Lease duration in minutes', '240')
    .option('--note <text>', 'What you are doing with it')
    .option('-f, --force', 'Take over a lease held by someone else', false)
    .action((scope: string, options) => {
      const lease = new TeamCoordinator(resolveTarget(options, projectRoot)).claim(scope, {
        ttlMinutes: Number(options.ttl),
        note: options.note,
        force: options.force,
      });
      console.log(`+ Claimed ${lease.scope} until ${lease.expires_at} (${lease.owner_email})`);
    });

  team
    .command('release <scope>')
    .description('Release a claim')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-f, --force', "Release someone else's claim", false)
    .action((scope: string, options) => {
      const released = new TeamCoordinator(resolveTarget(options, projectRoot)).release(scope, {
        force: options.force,
      });
      console.log(released ? `+ Released ${scope}` : `i No active claim on ${scope}`);
    });

  // ----------------------------------------------------------------- audit ---
  const audit = program.command('audit').description('Inspect the append-only audit stream');

  audit
    .command('verify')
    .description('Verify the SHA-256 hash chain of the audit stream')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const result = new AuditLogger(resolveTarget(options, projectRoot)).verifyIntegrity();
      if (result.valid) {
        console.log(
          `+ Audit chain intact across ${result.events} event(s)${result.forks > 0 ? `, including ${result.forks} concurrent append(s)` : ''}.`
        );
        return;
      }
      console.error(`x Audit chain broken at event #${result.brokenAt}: ${result.reason}`);
      process.exitCode = 1;
    });

  audit
    .command('tail')
    .description('Show recent audit events')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-n, --lines <count>', 'How many events to show', '20')
    .option('-r, --run <runId>', 'Filter by run id')
    .action((options) => {
      const events = new AuditLogger(resolveTarget(options, projectRoot)).getEvents(options.run);
      for (const event of events.slice(-Number(options.lines))) {
        console.log(
          `${event.time} #${event.seq ?? '-'} ${event.run} ${event.type}${event.from ? ` ${event.from}->${event.to}` : ''}${event.actor ? ` (${event.actor})` : ''}`
        );
      }
    });

  // --------------------------------------------------------------- migrate ---
  program
    .command('migrate')
    .description('Bring .agentic artifacts up to the current schema version')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--apply', 'Actually rewrite the artifacts (default is a dry run)', false)
    .action((options) => {
      const targetDir = resolveInitialized(options, projectRoot, 'migrate');
      const migrator = new Migrator(targetDir);
      const report = options.apply ? migrator.apply() : migrator.inspect();

      console.log(`\nArtifact schema: v${report.currentVersion} (this build)`);

      if (report.fromFuture.length > 0) {
        console.error(
          `\nx These artifacts were written by a NEWER build and were left untouched:\n  ${report.fromFuture.join(
            '\n  '
          )}\n  Update the agentic CLI instead of migrating backwards.`
        );
        process.exitCode = 1;
      }

      if (report.findings.length === 0) {
        console.log(report.fromFuture.length > 0 ? '' : 'Everything is already on the current schema.\n');
        return;
      }

      for (const finding of report.findings) {
        const mark = finding.severity === 'critical' ? 'x' : finding.severity === 'warning' ? '!' : '-';
        console.log(`\n${mark} [${finding.id}] ${finding.artifact} (v${finding.from} -> v${finding.to})`);
        console.log(`  ${finding.description}`);
        console.log(`  ${options.apply ? 'applied:' : 'will do:'} ${finding.action}`);
      }

      console.log(
        options.apply
          ? `\n+ Migrated ${report.findings.length} artifact issue(s). Re-check with: agentic status\n`
          : `\ni Dry run. Apply with: agentic migrate --apply\n`
      );
    });

  // ---------------------------------------------------------------- agents ---
  const agents = program
    .command('agents')
    .description('Inspect and (re)wire the AI products that follow this workflow');

  agents
    .command('list', { isDefault: true })
    .description('Show which AI products are wired here and which are present on this machine')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const integrations = new AgentIntegrations(resolveTarget(options, projectRoot));
      console.log('');
      for (const entry of integrations.status()) {
        const wired = entry.installed ? 'wired  ' : 'missing';
        const present = entry.detected ? 'detected on this machine' : 'not detected here';
        console.log(`[${wired}] ${entry.definition.label.padEnd(24)} ${present}`);
        console.log(`           entry point: ${entry.definition.entryPoint}`);
        console.log(`           files:       ${entry.definition.files.join(', ')}`);
      }
      console.log('\nWire or refresh them with: agentic agents sync [--agents claude,gemini]\n');
    });

  agents
    .command('sync')
    .description('Write (or refresh) the instruction files for the selected AI products')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-a, --agents <list>', `all | ${ALL_PRODUCT_IDS.join(' | ')}`, 'all')
    .option('--process <engine>', 'Process engine (superpowers | ecc | native)', 'superpowers')
    .option('-f, --force', 'Overwrite files even if they were edited by hand', false)
    .option('--without-permissions', 'Skip the .claude/settings.json permission allowlist', false)
    .option('--without-hooks', 'Skip the Claude Code SessionStart hook', false)
    .action((options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const results = new AgentIntegrations(targetDir).install({
        processEngine: options.process,
        products: parseProducts(options.agents),
        force: options.force,
        permissions: !options.withoutPermissions,
        hooks: !options.withoutHooks,
      });

      for (const result of results) {
        const changed = result.files.filter((f) => f.action !== 'preserved');
        console.log(`\n${result.label} - ${result.entryPoint}`);
        for (const file of result.files) {
          console.log(`  ${file.action.padEnd(9)} ${file.path}`);
        }
        if (changed.length === 0) {
          console.log('  (nothing changed; use --force to overwrite hand-edited files)');
        }
      }
      console.log('');
    });

  // -------------------------------------------------------------- worktree ---
  const worktree = program
    .command('worktree')
    .description('Isolated checkouts created for tasks that share a wave');

  worktree
    .command('list', { isDefault: true })
    .description('List the worktrees this project created')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const manager = new WorktreeManager(resolveInitialized(options, projectRoot, 'worktree list'));
      const worktrees = manager.list();

      if (worktrees.length === 0) {
        const support = manager.isSupported();
        console.log(
          support.ok
            ? 'No worktrees. They are created only when a wave has more than one task.'
            : `Worktrees unavailable here: ${support.reason}.`
        );
        return;
      }

      for (const entry of worktrees) {
        console.log(`${entry.task_id.padEnd(12)} ${entry.branch.padEnd(40)} ${entry.directory}`);
      }
      console.log('\nRemove them with: agentic worktree clean');
    });

  worktree
    .command('clean')
    .description('Remove the worktrees (branches are kept: they may hold unmerged work)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-r, --run <runId>', 'Only the worktrees of this run')
    .option('-f, --force', 'Remove even with uncommitted changes inside', false)
    .action((options) => {
      const result = new WorktreeManager(resolveInitialized(options, projectRoot, 'worktree clean')).cleanup({
        runId: options.run,
        force: options.force,
      });

      console.log(`+ Removed: ${result.removed.join(', ') || 'nothing'}`);
      if (result.kept.length > 0) {
        console.log(`i Kept: ${result.kept.join(', ')} (use --force if they have uncommitted changes)`);
      }
    });

  // ---------------------------------------------------------------- skills ---
  const skills = program
    .command('skills')
    .description('Inspect the skill packs mapped to each stage of the cycle');

  skills
    .command('list', { isDefault: true })
    .description('List configured skill packs and whether they are installed here')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const registry = new SkillRegistry(resolveTarget(options, projectRoot));
      const packs = registry.listPacks();

      if (packs.length === 0) {
        console.log('No skill packs configured. Declare one in .agentic/orchestrator/skills.yaml.');
        return;
      }

      for (const pack of packs) {
        console.log(`\n${pack.installed ? '[installed]' : '[missing]  '} ${pack.id} - ${pack.name}`);
        console.log(`  source:  ${pack.source}${pack.enabled ? '' : ' (disabled in skills.yaml)'}`);
        if (pack.installed) {
          console.log(`  found:   ${pack.detectedAt}`);
          console.log(`  stages:  ${pack.stagesCovered.join(', ')}`);
        } else {
          for (const command of pack.installCommands) {
            console.log(`  install: ${command}`);
          }
          if (pack.postInstall) {
            console.log(`  then:    ${pack.postInstall} (once per repository)`);
          }
        }
      }

      const coverage = registry.coverage();
      console.log('');
      if (coverage.installedPacks.length === 0) {
        console.log('No pack installed: every stage runs on the native path.');
      } else if (coverage.uncovered.length > 0) {
        console.log(`Stages with no installed skill: ${coverage.uncovered.join(', ')}`);
      } else {
        console.log('Every mapped stage is covered by an installed pack.');
      }
      console.log('');
    });

  skills
    .command('stage <stage>')
    .description('Show the skills mapped to one stage (implement, review, probe, specify, ...)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-d, --domain <domain>', 'Domain, to include domain-specific skills')
    .option('--installed', 'Only show skills that are actually installed', false)
    .action((stage: string, options) => {
      const registry = new SkillRegistry(resolveTarget(options, projectRoot));
      const recommendations = registry.forStage(stage as SkillStage, {
        domain: options.domain,
        onlyInstalled: options.installed,
      });

      if (recommendations.length === 0) {
        console.log(`No skill mapped to stage '${stage}'.`);
        return;
      }

      for (const rec of recommendations) {
        console.log(`${rec.installed ? '[installed]' : '[missing]  '} ${rec.invocation.padEnd(32)} ${rec.packName}`);
        if (rec.note) {
          console.log(`             note: ${rec.note.trim()}`);
        }
      }
    });

  skills
    .command('install <packId>')
    .description('Print (or run) the install command for a skill pack')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--run', 'Actually execute the install command', false)
    .option('--agent <agent>', 'claude | generic', 'claude')
    .action(async (packId: string, options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const registry = new SkillRegistry(targetDir);
      const pack = registry.getPack(packId);
      if (!pack) {
        console.error(`Skill pack '${packId}' is not declared in .agentic/orchestrator/skills.yaml.`);
        process.exitCode = 1;
        return;
      }

      const command = options.agent === 'generic' ? pack.install?.generic : pack.install?.claude || pack.install?.generic;
      if (!command) {
        console.error(`Skill pack '${packId}' declares no install command.`);
        process.exitCode = 1;
        return;
      }

      if (!options.run) {
        console.log(command);
        if (pack.install?.post_install) {
          console.log(`# then, once per repository: ${pack.install.post_install}`);
        }
        console.log('# add --run to execute it here');
        return;
      }

      const { execSync } = await import('child_process');
      try {
        execSync(command, { cwd: targetDir, stdio: 'inherit' });
        console.log(`+ Installed ${pack.name}.`);
        if (pack.install?.post_install) {
          console.log(`i Run ${pack.install.post_install} in your agent once per repository.`);
        }
      } catch (error) {
        console.error(`x Install failed: ${(error as Error).message}`);
        console.error(`  Run it manually: ${command}`);
        process.exitCode = 1;
      }
    });

  // ------------------------------------------------------------ inspection ---
  program
    .command('status')
    .description('Display the current SDLC status dashboard')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = resolveTarget(options, projectRoot);
      if (!fs.existsSync(path.join(targetDir, '.agentic', 'orchestrator', 'workflow.yaml'))) {
        console.log(`\nAgentic SDLC is not initialized in ${targetDir}.`);
        console.log('Set it up with:  agentic init\n');
        return;
      }
      console.log(new StatusDashboard(targetDir).render());
    });

  program
    .command('doctor')
    .description('Run readiness diagnostics on configs, evidence capability, integrity and providers')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const doctor = new Doctor(resolveTarget(options, projectRoot));
      const report = doctor.runDiagnostics();
      console.log(doctor.formatReport(report));
      if (!report.ready) {
        process.exitCode = 1;
      }
    });

  program
    .command('observe')
    .description('Inspect and record observed repository state')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--tests', 'Execute the test suite to record real evidence', false)
    .action((options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const observer = new Observer(targetDir);
      const state = observer.observe(`RUN-OBSERVE-${Date.now()}`, { runTests: options.tests });
      console.log(`>>> ${state.project.name} @ ${state.git.branch}/${state.git.commit.slice(0, 7)}`);
      console.log(`>>> tests=${state.tests.status}${state.tests.evidence_id ? ` (${state.tests.evidence_id}: ${state.tests.passed}p/${state.tests.failed}f)` : ' (not measured - pass --tests)'}`);
      console.log(`>>> dirty files=${state.git.dirty_files.length} | migrations=${state.project.migrations.length}`);
      for (const risk of state.risks) {
        console.log(`  ! ${risk}`);
      }
      for (const blocker of state.blockers) {
        console.log(`  x ${blocker}`);
      }
    });

  program
    .command('reconcile')
    .description('Reconcile declared state against observed truth')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--sync', 'Rewrite the declared state from observed truth', false)
    .option('--tests', 'Execute the test suite as part of the observation', false)
    .action((options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const runId = `RUN-RECONCILE-${Date.now()}`;
      const observed = new Observer(targetDir).observe(runId, { runTests: options.tests });
      const reconciler = new Reconciler(targetDir);
      const reconciled = reconciler.reconcile(runId, observed);

      console.log(`>>> Reconciliation: ${reconciled.status}`);
      console.log(
        `>>> matches=${reconciled.matches.length} partials=${reconciled.partials.length} mismatches=${reconciled.mismatches.length} unknowns=${reconciled.unknowns.length}`
      );
      for (const mismatch of reconciled.mismatches) {
        console.log(`  x ${mismatch.id} (${mismatch.type}): declared=${mismatch.declared} observed=${mismatch.observed}`);
      }

      if (options.sync) {
        const next = reconciler.syncDeclaredState(runId, observed);
        console.log(`+ Declared state rewritten from observed truth (status=${next.status}).`);
      } else if (reconciled.mismatches.length > 0) {
        console.log(`i Run with --sync to apply observed truth over the declared state.`);
      }
    });

  program
    .command('resume')
    .description('Inspect and resume interrupted runs safely')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--apply', 'Actually resume the run instead of only reporting the plan', false)
    .action(async (options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const plan = new RecoveryEngine(targetDir).planRecovery();
      console.log('>>> Recovery plan:');
      console.log(`- can resume:      ${plan.canResume}`);
      console.log(`- run id:          ${plan.runId}`);
      console.log(`- resumable state: ${plan.resumableState}`);
      console.log(`- reason:          ${plan.reason}`);

      if (!options.apply) {
        console.log('i Re-run with --apply to resume.');
        return;
      }
      if (!plan.canResume) {
        console.error('x Run is not resumable.');
        process.exitCode = 1;
        return;
      }

      const orchestrator = new Orchestrator(targetDir);
      const current = orchestrator.loadCurrentRun();
      if (!current) {
        console.error('x No current run descriptor found.');
        process.exitCode = 1;
        return;
      }
      const result = await orchestrator.closeCycle(current, {});
      console.log(`>>> Resumed run ${result.run_id} -> ${result.status}`);
    });

  program
    .command('providers')
    .description('List integrated engine providers and their real detection status')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action(async (options) => {
      const targetDir = resolveTarget(options, projectRoot);
      const { ProviderInstaller } = await import('../core/provider-installer.js');
      const providers = new ProviderInstaller(targetDir).checkProviders();

      console.log('\nIntegrated engine providers:');
      console.log('================================================================');
      for (const provider of providers) {
        console.log(`\n- ${provider.name} [engine: ${provider.engine}]`);
        console.log(`  detected:  ${provider.installed ? 'YES' : 'NO (optional / manual setup)'}`);
        console.log(`  install:   ${provider.installCommand}`);
        console.log(`  notes:     ${provider.runtimeNotes}`);
      }
      console.log('================================================================\n');
    });

  program
    .command('ids')
    .description('Inspect allocated identifiers (REQ, SPEC, ADR, TASK, RUN)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-k, --kind <kind>', 'Filter by kind (REQ | SPEC | ADR | TASK | PHASE | MILESTONE | RUN)')
    .action((options) => {
      const registry = new IdRegistry(resolveTarget(options, projectRoot));
      const allocations = registry.list(options.kind);
      if (allocations.length === 0) {
        console.log('No identifiers allocated yet.');
        return;
      }
      for (const allocation of allocations) {
        console.log(
          `${allocation.id.padEnd(12)} ${allocation.allocated_at} ${allocation.actor}${allocation.title ? ` - ${allocation.title}` : ''}`
        );
      }
    });

  return program;
}

/**
 * Entry point used by the `agentic` binary.
 *
 * Every failure funnels through here so the operator sees an actionable message
 * instead of a Node stack trace, and so the process exit code is meaningful.
 */
export async function runCli(
  argv: string[] = process.argv,
  projectRoot: string = process.cwd()
): Promise<number> {
  const program = createCli(projectRoot);
  program.exitOverride();

  try {
    await program.parseAsync(argv);
    return typeof process.exitCode === 'number' ? process.exitCode : 0;
  } catch (error) {
    // Commander throws for --help and --version too; those are not failures.
    const code = (error as { code?: string }).code;
    if (code === 'commander.helpDisplayed' || code === 'commander.version' || code === 'commander.help') {
      return 0;
    }
    if (code === 'commander.unknownCommand' || code === 'commander.unknownOption') {
      // Commander already printed the message; only the way forward is missing.
      console.error('  See the available commands with: agentic --help\n');
      return 1;
    }
    if (code === 'commander.missingArgument' || code === 'commander.missingMandatoryOptionValue') {
      console.error(`\nx ${(error as Error).message}\n`);
      return 1;
    }

    return reportError(error);
  }
}

export { CliError };
