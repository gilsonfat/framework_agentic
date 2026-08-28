import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import YAML from 'yaml';
import { Scaffolder } from './scaffolder.js';
import { ProviderInstaller } from './provider-installer.js';
import { Observer } from './observer.js';
import { Reconciler } from './reconciler.js';
import { Doctor, DoctorReport } from './doctor.js';

export interface SetupOptions {
  targetDir?: string;
  installEngines?: boolean;
  force?: boolean;
  processEngine?: 'superpowers' | 'ecc' | 'native';
  enableGsd?: boolean;
  enableTlc?: boolean;
  enableRuflo?: boolean;
  enableRules?: boolean;
  enableClaudeCommands?: boolean;
  enableAntigravitySkill?: boolean;
}

export interface SetupResult {
  targetDir: string;
  gitInitialized: boolean;
  scaffoldSuccess: boolean;
  processEngine: string;
  rulesConfigured: string[];
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
    const enableClaudeCommands = options.enableClaudeCommands !== false;
    const enableAntigravitySkill = options.enableAntigravitySkill !== false;

    console.log(`\n=============================================================`);
    console.log(`   Agentic SDLC Setup Orchestrator: ${target}`);
    console.log(`   Selected Process Engine: ${processEngine.toUpperCase()}`);
    console.log(`   Modules: GSD [${enableGsd ? 'ON' : 'OFF'}], TLC [${enableTlc ? 'ON' : 'OFF'}], Ruflo [${enableRuflo ? 'ON' : 'OFF'}]`);
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

    // 4. Configure Workspace AI Instruction Rules & Slash Commands
    console.log('>>> Configuring Auto-Orchestration Workspace Rules & Slash Commands...');
    const rulesConfigured = this.configureWorkspaceAgentRules(target, {
      processEngine,
      enableRules,
      enableClaudeCommands,
      enableAntigravitySkill,
    });

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

    return {
      targetDir: target,
      gitInitialized,
      scaffoldSuccess: true,
      processEngine,
      rulesConfigured,
      providersInstalled,
      doctorReport,
    };
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

      parsed.providers.specification = {
        engine: cfg.enableTlc ? 'tlc-spec-driven' : 'native-spec',
        required: true,
      };

      parsed.providers.execution = {
        engine: cfg.enableRuflo ? 'ruflo' : 'native-swarm',
        required: false,
        fallback: 'native-agent',
      };

      parsed.providers.process = {
        engine: cfg.processEngine,
        required: true,
      };

      parsed.providers.verification = {
        engine: cfg.enableTlc ? 'tlc-spec-driven' : 'native-verifier',
        fresh_context: true,
        required: true,
      };

      fs.writeFileSync(providersPath, YAML.stringify(parsed), 'utf8');
      console.log(`+ Configured providers.yaml (Process: ${cfg.processEngine}, Planner: ${cfg.enableGsd ? 'gsd' : 'native'})`);
    } catch (e) {
      console.warn('! Note: Could not update providers.yaml:', (e as Error).message);
    }
  }

  private configureWorkspaceAgentRules(
    targetDir: string,
    opts: { processEngine: string; enableRules: boolean; enableClaudeCommands: boolean; enableAntigravitySkill: boolean }
  ): string[] {
    const processLabel = opts.processEngine === 'ecc'
      ? 'ECC (tdd-workflow, verification-loop, security-review)'
      : opts.processEngine === 'superpowers'
      ? 'SUPERPOWERS (strict TDD and systematic debugging)'
      : 'NATIVE TDD (Red-Green-Refactor)';

    const rulesContent = `# AGENTIC SDLC ORCHESTRATOR — WORKSPACE INSTRUCTIONS

> **MANDATORY INSTRUCTION FOR ALL AI ASSISTANTS & CODING AGENTS (Antigravity, Gemini, Claude Code, Codex, etc.)**:
> This repository is governed by the **Agentic SDLC Orchestrator**. 
> Whenever the user requests any task, feature, bugfix, or refactoring in this repository, you **MUST ALWAYS** execute it through the orchestrated Agentic SDLC cycle.

---

## The Non-Negotiable 12-Step Cycle

Every prompt or modification must follow this pipeline:

1. **OBSERVE**: Inspect real repository state (Git branch, status, tests, migrations, schemas).
2. **RECONCILE**: Compare declared state vs observed state (**Observed State > Declared State**).
3. **PLAN (GSD)**: Frame the work into a bounded milestone, phase, and work package.
4. **SPECIFY (TLC)**: Write formal specification contracts with stable IDs (\`REQ-###\`, \`AC-###.#\`).
5. **COMPILE DAG**: Build dependency graph, check for cycles (Kahn's algorithm) and write conflicts.
6. **ORCHESTRATE (RUFLO)**: Select execution strategy based on complexity (XS/S: Single agent; M: Parallel; L/XL: Swarm).
7. **IMPLEMENT (${processLabel})**: Apply strict **TDD** (RED -> GREEN -> REFACTOR) and **Systematic Debugging**. Never edit forbidden files.
8. **REVIEW**: Execute 4-layer review (L1 Worker, L2 Integration build/test, L3 Independent correctness, L4 Security Read-Only).
9. **VERIFY (TLC FRESH VERIFIER)**: Independent verification. **No requirement is DONE without executable evidence** (\`implemented && tested && verified\`).
10. **REMEDIATE**: If verification fails, generate a \`RemediationPackage\` and repeat (up to 3 attempts before escalating to Human Gate).
11. **AS-BUILT SPEC**: Extract verified as-built documentation from real Git diff and test evidence.
12. **UPDATE STATE**: Update requirement matrix and declared roadmap, then re-observe.

---

## Command Quick Reference

- \`agentic status\` : View the current milestone, phase, requirements, and test status.
- \`agentic doctor\` : Verify framework health and readiness.
- \`agentic prompt "<instruction>"\` (alias \`agentic do "<instruction>"\`) : Auto-orchestrate any prompt instruction through the 12-step cycle.
- \`agentic run [--phase <id>]\` : Run the cyclic delivery loop.
- \`agentic resume\` : Resume interrupted executions from checkpoint safely.
`;

    const writtenFiles: string[] = [];

    if (opts.enableRules) {
      for (const fileName of ['AGENTS.md', 'GEMINI.md', 'CLAUDE.md', 'CODEX.md']) {
        const filePath = path.join(targetDir, fileName);
        fs.writeFileSync(filePath, rulesContent, 'utf8');
        writtenFiles.push(fileName);
      }
    }

    if (opts.enableAntigravitySkill) {
      const antigravitySkillDir = path.join(targetDir, '.agents', 'skills', 'agentic');
      fs.mkdirSync(antigravitySkillDir, { recursive: true });
      const skillContent = `---
name: agentic
description: Agentic SDLC Orchestrator. Execute any task, feature, bugfix, or refactoring through the orchestrated 12-step SDLC cycle.
---

# Agentic SDLC Orchestrator Skill

When invoked (via /agentic or on any engineering prompt), follow the 12-step cycle:
1. Observe repository state
2. Reconcile observed state vs declared state
3. Plan milestone/phase work package (GSD)
4. Specify contracts with stable IDs REQ-### and AC-###.# (TLC)
5. Compile DAG (Kahn's algorithm, cycle and conflict check)
6. Orchestrate execution strategy (Ruflo)
7. Implement with ${processLabel}
8. 4-Layer Review (L1-L4)
9. Fresh Context Verification (TLC)
10. Remediation loop on failure
11. As-Built specification extraction
12. Update declared state & matrix
`;
      fs.writeFileSync(path.join(antigravitySkillDir, 'SKILL.md'), skillContent, 'utf8');
      writtenFiles.push('.agents/skills/agentic/SKILL.md');
    }

    if (opts.enableClaudeCommands) {
      const claudeCommandsDir = path.join(targetDir, '.claude', 'commands');
      fs.mkdirSync(claudeCommandsDir, { recursive: true });

      fs.writeFileSync(
        path.join(claudeCommandsDir, 'agentic.md'),
        '# /agentic Slash Command\n\nExecute complete Agentic SDLC cycle:\n\n```bash\nagentic prompt "$*"\n```\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(claudeCommandsDir, 'agentic-run.md'),
        '# /agentic-run Slash Command\n\nRun cyclic delivery loop:\n\n```bash\nagentic run "$@"\n```\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(claudeCommandsDir, 'agentic-doctor.md'),
        '# /agentic-doctor Slash Command\n\nRun diagnostics:\n\n```bash\nagentic doctor\n```\n',
        'utf8'
      );
      fs.writeFileSync(
        path.join(claudeCommandsDir, 'agentic-status.md'),
        '# /agentic-status Slash Command\n\nDisplay status dashboard:\n\n```bash\nagentic status\n```\n',
        'utf8'
      );
      writtenFiles.push('.claude/commands/agentic.md');
    }

    return writtenFiles;
  }
}
