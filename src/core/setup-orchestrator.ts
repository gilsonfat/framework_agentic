import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import { Scaffolder } from './scaffolder.js';
import { ProviderInstaller } from './provider-installer.js';
import { Observer } from './observer.js';
import { Reconciler } from './reconciler.js';
import { Doctor, DoctorReport } from './doctor.js';
import { TeamCoordinator } from './team.js';
import { AgentIntegrations, ALL_PRODUCT_IDS } from './agent-integrations.js';
import { AgentProductId, IntegrationResult } from '../types/integrations.js';

export interface SetupOptions {
  targetDir?: string;
  installEngines?: boolean;
  force?: boolean;
  processEngine?: 'superpowers' | 'ecc' | 'native';
  enableGsd?: boolean;
  enableTlc?: boolean;
  enableRuflo?: boolean;
  /** Write the instruction files at all. */
  enableRules?: boolean;
  /** Which AI products to wire. Defaults to all of them. */
  products?: AgentProductId[];
  /** Pre-approve `agentic` commands in .claude/settings.json. */
  enablePermissions?: boolean;
  /** Add the Claude Code SessionStart hook that surfaces the cycle state. */
  enableHooks?: boolean;
  /** Skip the closing "what to do next" block. */
  quiet?: boolean;
}

export interface SetupResult {
  targetDir: string;
  gitInitialized: boolean;
  scaffoldSuccess: boolean;
  processEngine: string;
  /** Flat list of every instruction file written, for backwards compatibility. */
  rulesConfigured: string[];
  /** Per-product integration detail. */
  integrations: IntegrationResult[];
  providersInstalled: string[];
  doctorReport: DoctorReport;
}

export class SetupOrchestrator {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public runFullSetup(options: SetupOptions = {}): SetupResult {
    const target = path.resolve(options.targetDir || this.projectRoot);
    const processEngine = options.processEngine || 'superpowers';
    const enableGsd = options.enableGsd !== false;
    const enableTlc = options.enableTlc !== false;
    const enableRuflo = options.enableRuflo !== false;
    const enableRules = options.enableRules !== false;
    const products = options.products && options.products.length > 0 ? options.products : ALL_PRODUCT_IDS;

    console.log(`\n=============================================================`);
    console.log(`   Agentic SDLC Setup Orchestrator: ${target}`);
    console.log(`   Selected Process Engine: ${processEngine.toUpperCase()}`);
    console.log(`   Modules: GSD [${enableGsd ? 'ON' : 'OFF'}], TLC [${enableTlc ? 'ON' : 'OFF'}], Ruflo [${enableRuflo ? 'ON' : 'OFF'}]`);
    console.log(`   AI products: ${enableRules ? products.join(', ') : 'none (--without-rules)'}`);
    console.log(`=============================================================\n`);

    // 1. Initialize Git repository if not present
    let gitInitialized = false;
    const gitDir = path.join(target, '.git');
    if (!fs.existsSync(gitDir)) {
      console.log('>>> Initializing Git repository...');
      try {
        execSync('git init', { cwd: target, stdio: 'pipe' });
        gitInitialized = true;
        console.log('+ Git repository initialized.');
      } catch (err) {
        console.warn('! Note: git init failed or git not in PATH:', (err as Error).message);
      }
    } else {
      gitInitialized = true;
    }

    // 2. Scaffold Full .agentic Structure
    console.log('>>> Scaffolding Agentic SDLC architecture...');
    const scaffolder = new Scaffolder();
    scaffolder.scaffold(target, {
      force: options.force,
      autoObserve: false,
    });
    console.log('+ Complete .agentic architecture scaffolded.');

    // 3. Customize providers.yaml in target project based on user choice
    this.customizeProvidersConfig(target, {
      enableGsd,
      enableTlc,
      enableRuflo,
      processEngine,
    });

    // 4. Wire every AI product to the same workflow.
    console.log('>>> Wiring AI products to the Agentic workflow...');
    const integrations = enableRules
      ? this.configureAgentProducts(target, {
          processEngine,
          products,
          force: options.force,
          permissions: options.enablePermissions,
          hooks: options.enableHooks,
        })
      : [];
    const rulesConfigured = integrations.flatMap((i) =>
      i.files.filter((f) => f.action !== 'preserved').map((f) => f.path)
    );

    // 5. Install / Check Provider Engines (GSD, TLC, Ruflo, Superpowers, ECC)
    const providersInstalled: string[] = [];
    const installer = new ProviderInstaller(target);
    const providerStatuses = installer.checkProviders();

    if (options.installEngines) {
      console.log('>>> Automatically setting up integrated engine providers...');
      for (const p of providerStatuses) {
        // Skip disabled providers
        if (p.category === 'planner' && !enableGsd) continue;
        if (p.category === 'specification' && !enableTlc) continue;
        if (p.category === 'execution' && !enableRuflo) continue;
        if (p.category === 'process' && !p.engine.includes(processEngine)) continue;

        if (!p.installed) {
          console.log(`+ Running setup for: ${p.name}`);
          const res = installer.installProvider(p.name);
          if (res.success) {
            providersInstalled.push(p.name);
          }
        } else {
          providersInstalled.push(`${p.name} (already present)`);
        }
      }
    }

    // 5b. Declare the shared/local artifact split so teammates do not conflict.
    const collaboration = new TeamCoordinator(target).ensureCollaborationPolicy({ force: options.force });
    if (collaboration.written.length > 0) {
      console.log(`+ Collaboration policy: ${collaboration.written.join(', ')}`);
    }

    // 6. Initial Repository Observation and Reconciliation
    console.log('>>> Running baseline repository observation and reconciliation...');
    const observer = new Observer(target);
    const reconciler = new Reconciler(target);
    const runId = `RUN-SETUP-${Date.now()}`;
    const observed = observer.observe(runId);
    reconciler.reconcile(runId, observed);
    console.log('+ Baseline state recorded and reconciled.');

    // 7. Run Doctor Diagnostic
    console.log('>>> Running Doctor Diagnostic Check...');
    const doctor = new Doctor(target);
    const doctorReport = doctor.runDiagnostics();
    console.log(doctor.formatReport(doctorReport));

    if (!options.quiet) {
      this.printNextSteps(integrations, doctorReport);
    }

    return {
      targetDir: target,
      gitInitialized,
      scaffoldSuccess: true,
      processEngine,
      rulesConfigured,
      integrations,
      providersInstalled,
      doctorReport,
    };
  }

  /**
   * Closing summary. Setup is where most people give up, so the last thing they
   * read is how to actually start working in their own tool.
   */
  private printNextSteps(integrations: IntegrationResult[], doctorReport: DoctorReport): void {
    console.log('\n=============================================================');
    console.log('   READY TO USE');
    console.log('=============================================================\n');

    if (integrations.length > 0) {
      const detected = integrations.filter((i) => i.detected);
      const rest = integrations.filter((i) => !i.detected);

      if (detected.length > 0) {
        console.log('Detected on this machine:');
        for (const integration of detected) {
          console.log(`  ${integration.label.padEnd(24)} ${integration.entryPoint}`);
        }
      }
      if (rest.length > 0) {
        console.log(`${detected.length > 0 ? '\n' : ''}Also wired (ready if a teammate uses it):`);
        for (const integration of rest) {
          console.log(`  ${integration.label.padEnd(24)} ${integration.entryPoint}`);
        }
      }
      console.log('');
    }

    console.log('First delivery, in three commands:');
    console.log('  1. agentic prompt "<what you want built>"');
    console.log('  2. implement the packs in .agentic/execution/inbox/, then:');
    console.log('     agentic report <TASK-ID> --status completed --commit <sha>');
    console.log('  3. agentic verify\n');
    console.log('Orientation:  agentic status | agentic doctor | agentic skills | agentic team who');

    if (!doctorReport.ready) {
      console.log('\n! Doctor reported blocking issues above: fix them before closing work.');
    }
    console.log('');
  }

  private customizeProvidersConfig(
    targetDir: string,
    cfg: { enableGsd: boolean; enableTlc: boolean; enableRuflo: boolean; processEngine: string }
  ): void {
    const providersPath = path.join(targetDir, '.agentic', 'orchestrator', 'providers.yaml');
    if (!fs.existsSync(providersPath)) return;

    try {
      const parsed = YAML.parse(fs.readFileSync(providersPath, 'utf8')) || { version: 1, providers: {} };
      if (!parsed.providers) parsed.providers = {};

      parsed.providers.project_planner = {
        engine: cfg.enableGsd ? 'gsd' : 'native-planner',
        required: true,
      };

      parsed.providers.bmad = {
        engine: 'bmad-method',
        required: true,
      };

      parsed.providers.spec_kit = {
        engine: 'github-spec-kit',
        required: true,
      };

      parsed.providers.specification = {
        engine: cfg.enableTlc ? 'tlc-spec-driven' : 'native-spec',
        required: true,
      };

      parsed.providers.execution = {
        engine: cfg.enableRuflo ? 'ruflo' : 'native-swarm',
        required: false,
        fallback: 'native-agent',
        // Delegated: the orchestrator hands prompt packs to the coding agent and
        // waits for reported results. Switch to `command` with a `command:`
        // template to drive an agent CLI directly.
        mode: 'delegated',
      };

      parsed.providers.process = {
        engine: cfg.processEngine,
        required: true,
      };

      parsed.providers.domain_skills = {
        engine: 'mattpocock-skills',
        auto_select: true,
        required: false,
      };

      parsed.providers.verification = {
        engine: cfg.enableTlc ? 'tlc-spec-driven' : 'native-verifier',
        fresh_context: true,
        required: true,
      };

      fs.writeFileSync(providersPath, YAML.stringify(parsed), 'utf8');
      console.log(`+ Configured providers.yaml (Process: ${cfg.processEngine}, Planner: ${cfg.enableGsd ? 'gsd' : 'native'}, BMAD: bmad-method, SpecKit: github-spec-kit)`);
    } catch (e) {
      console.warn('! Note: Could not update providers.yaml:', (e as Error).message);
    }
  }

  private configureAgentProducts(
    targetDir: string,
    opts: {
      processEngine: string;
      products: AgentProductId[];
      force?: boolean;
      permissions?: boolean;
      hooks?: boolean;
    }
  ): IntegrationResult[] {
    const integrations = new AgentIntegrations(targetDir).install({
      processEngine: opts.processEngine,
      products: opts.products,
      force: opts.force,
      permissions: opts.permissions,
      hooks: opts.hooks,
    });

    for (const integration of integrations) {
      const changed = integration.files.filter((f) => f.action !== 'preserved');
      const preserved = integration.files.filter((f) => f.action === 'preserved');
      console.log(
        `+ ${integration.label.padEnd(22)} ${changed.length} file(s) written${
          preserved.length > 0 ? `, ${preserved.length} preserved` : ''
        }`
      );
    }

    return integrations;
  }
}

