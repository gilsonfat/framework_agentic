import path from 'path';
import { Command } from 'commander';
import { Orchestrator } from '../core/orchestrator.js';
import { Doctor } from '../core/doctor.js';
import { StatusDashboard } from '../core/status.js';
import { Observer } from '../core/observer.js';
import { Reconciler } from '../core/reconciler.js';
import { RecoveryEngine } from '../core/recovery.js';
import { Scaffolder } from '../core/scaffolder.js';
import { SetupOrchestrator } from '../core/setup-orchestrator.js';
import { PromptOrchestrator } from '../core/prompt-orchestrator.js';

export function createCli(projectRoot: string = process.cwd()): Command {
  const program = new Command();

  program
    .name('agentic')
    .description('Agentic SDLC Orchestrator CLI — Autonomous, state-driven software delivery')
    .version('1.0.0');

  program
    .command('setup')
    .description('Automated setup orchestrator: installs configs, schemas, templates, rules, and provider integrations')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('--all', 'Attempt automated setup for all provider engines', false)
    .option('-f, --force', 'Force overwrite existing configs', false)
    .option('--process <engine>', 'Implementation process engine (superpowers | ecc | native)', 'superpowers')
    .option('--with-ecc', 'Use ECC (Everything Claude Code) as the process engine instead of Superpowers', false)
    .option('--without-gsd', 'Disable GSD planner provider (use native planner)', false)
    .option('--without-tlc', 'Disable TLC spec/verifier provider (use native spec)', false)
    .option('--without-ruflo', 'Disable Ruflo execution/swarm provider (use native execution)', false)
    .option('--without-rules', 'Skip generating AI workspace rule files (AGENTS.md, GEMINI.md, etc.)', false)
    .option('--without-commands', 'Skip generating Claude Code slash commands', false)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const processEngine = options.withEcc ? 'ecc' : (options.process as 'superpowers' | 'ecc' | 'native') || 'superpowers';
      const setup = new SetupOrchestrator(targetDir);
      setup.runFullSetup({
        targetDir,
        installEngines: options.all,
        force: options.force,
        processEngine,
        enableGsd: !options.withoutGsd,
        enableTlc: !options.withoutTlc,
        enableRuflo: !options.withoutRuflo,
        enableRules: !options.withoutRules,
        enableClaudeCommands: !options.withoutCommands,
        enableAntigravitySkill: !options.withoutCommands,
      });
    });

  program
    .command('init')
    .description('Initialize Agentic SDLC in current or target project')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-f, --force', 'Overwrite existing template files', false)
    .option('-o, --observe', 'Run initial observation and reconciliation after setup', true)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      console.log(`>>> Initializing Agentic SDLC in: ${targetDir}`);
      const scaffolder = new Scaffolder();
      const result = scaffolder.scaffold(targetDir, {
        force: options.force,
        autoObserve: options.observe,
      });
      console.log(`+ Directories verified/created: ${result.createdDirectories.length}`);
      console.log(`+ Files scaffolded: ${result.createdFiles.length}`);
      if (result.skippedFiles.length > 0) {
        console.log(`ℹ Existing files preserved: ${result.skippedFiles.length} (use --force to overwrite)`);
      }
      console.log('>>> Agentic SDLC initialization complete. Run "agentic doctor" to verify.');
    });

  program
    .command('bootstrap')
    .description('Bootstrap a brownfield or greenfield repository (init + doctor + initial observe)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      console.log(`>>> Bootstrapping Agentic SDLC in: ${targetDir}`);
      const scaffolder = new Scaffolder();
      scaffolder.scaffold(targetDir, { autoObserve: true });

      const doctor = new Doctor(targetDir);
      const doctorReport = doctor.runDiagnostics();
      console.log(doctor.formatReport(doctorReport));

      const dashboard = new StatusDashboard(targetDir);
      console.log(dashboard.render());
    });

  program
    .command('prompt <instructions...>')
    .alias('do')
    .description('Auto-orchestrate any prompt instruction through the complete 12-step SDLC cycle')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-d, --domain <domain>', 'Explicit domain (backend, frontend, database, security, testing)')
    .option('-c, --complexity <level>', 'Explicit complexity level (XS, S, M, L, XL)')
    .action(async (instructionsArray: string[], options) => {
      const instruction = instructionsArray.join(' ');
      const targetDir = path.resolve(options.target || projectRoot);
      const promptOrch = new PromptOrchestrator(targetDir);
      await promptOrch.dispatchPrompt(instruction, {
        domain: options.domain,
        complexity: options.complexity,
      });
    });

  program
    .command('run')
    .description('Execute the Agentic SDLC cycle')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .option('-p, --phase <id>', 'Target a specific phase ID (e.g. P01)')
    .action(async (options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      console.log(`>>> Starting Agentic SDLC Orchestration Cycle in: ${targetDir}...`);
      const orchestrator = new Orchestrator(targetDir);
      const result = await orchestrator.runCycle({ phaseId: options.phase });
      console.log(`>>> Cycle finished: Run ${result.run_id} status is ${result.status}`);
    });

  program
    .command('status')
    .description('Display the current SDLC status dashboard')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const dashboard = new StatusDashboard(targetDir);
      console.log(dashboard.render());
    });

  program
    .command('doctor')
    .description('Run diagnostics on frameworks, state, and configs')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const doctor = new Doctor(targetDir);
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
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const observer = new Observer(targetDir);
      const runId = `RUN-OBSERVE-${Date.now()}`;
      const state = observer.observe(runId);
      console.log(`>>> Observed state recorded: ${state.project.name} (${state.git.branch}@${state.git.commit.slice(0, 7)})`);
      console.log(`>>> Tests status: ${state.tests.status} | Dirty files: ${state.git.dirty_files.length}`);
    });

  program
    .command('reconcile')
    .description('Reconcile declared state against observed truth')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const observer = new Observer(targetDir);
      const reconciler = new Reconciler(targetDir);
      const runId = `RUN-RECONCILE-${Date.now()}`;
      const obs = observer.observe(runId);
      const rec = reconciler.reconcile(runId, obs);
      console.log(`>>> Reconciliation status: ${rec.status}`);
      console.log(`>>> Matches: ${rec.matches.length}, Partials: ${rec.partials.length}, Mismatches: ${rec.mismatches.length}`);
    });

  program
    .command('resume')
    .description('Plan and resume interrupted runs safely')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action((options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const recovery = new RecoveryEngine(targetDir);
      const plan = recovery.planRecovery();
      console.log('>>> Recovery Plan:');
      console.log(`- Can Resume: ${plan.canResume}`);
      console.log(`- Run ID: ${plan.runId}`);
      console.log(`- Resumable State: ${plan.resumableState}`);
      console.log(`- Reason: ${plan.reason}`);
    });

  program
    .command('providers')
    .description('List and check status of integrated engines (GSD, TLC, Ruflo, Superpowers)')
    .option('-t, --target <path>', 'Target project directory', projectRoot)
    .action(async (options) => {
      const targetDir = path.resolve(options.target || projectRoot);
      const { ProviderInstaller } = await import('../core/provider-installer.js');
      const installer = new ProviderInstaller(targetDir);
      const providers = installer.checkProviders();

      console.log('\nIntegrated Engine Providers Status:');
      console.log('================================================================');
      for (const p of providers) {
        console.log(`\n• ${p.name} [Engine: ${p.engine}]`);
        console.log(`  Status: ${p.installed ? 'AVAILABLE' : 'OPTIONAL / MANUAL SETUP'}`);
        console.log(`  Install command: ${p.installCommand}`);
        console.log(`  Runtime notes:   ${p.runtimeNotes}`);
      }
      console.log('================================================================\n');
    });

  return program;
}
