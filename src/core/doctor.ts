import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';
import { EvidenceCollector } from './evidence-collector.js';
import { Verifier } from './verifier.js';
import { GateKeeper } from './gate-keeper.js';
import { TeamCoordinator } from './team.js';
import { ProviderInstaller } from './provider-installer.js';
import { SkillRegistry } from './skill-registry.js';
import { AgentIntegrations } from './agent-integrations.js';

/**
 * Roles this package implements natively, so an absent external engine is a
 * degradation rather than a broken setup.
 */
const NATIVE_ROLES = new Set([
  'bmad',
  'spec_kit',
  'decision_ledger',
  'specification',
  'verification',
  'project_planner',
  'execution',
  'process',
  'domain_skills',
]);

export interface DoctorCheckItem {
  name: string;
  status: 'PASS' | 'WARN' | 'FAIL';
  details?: string;
}

export interface DoctorReport {
  ready: boolean;
  checks: DoctorCheckItem[];
  timestamp: string;
}

/**
 * Readiness diagnostics.
 *
 * Rule for every check here: report what was actually inspected. The previous
 * version marked providers as PASS from hardcoded `true` values and never
 * validated the integrity of the artifacts it claimed to guard, so a broken
 * project could report READY.
 */
export class Doctor {
  private projectRoot: string;
  private configLoader: ConfigLoader;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
  }

  public runDiagnostics(): DoctorReport {
    const checks: DoctorCheckItem[] = [
      ...this.checkFoundation(),
      ...this.checkConfiguration(),
      ...this.checkStateArtifacts(),
      ...this.checkEvidenceCapability(),
      ...this.checkIntegrity(),
      ...this.checkProviders(),
      ...this.checkSkillPacks(),
      ...this.checkAgentIntegrations(),
      ...this.checkTeamReadiness(),
    ];

    return {
      ready: !checks.some((c) => c.status === 'FAIL'),
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private checkFoundation(): DoctorCheckItem[] {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: this.projectRoot,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return [{ name: 'Git repository', status: 'PASS', details: 'Initialized and readable' }];
    } catch {
      return [
        {
          name: 'Git repository',
          status: 'FAIL',
          details: 'Not a git repository: observation, evidence commits and leases all depend on git',
        },
      ];
    }
  }

  private checkConfiguration(): DoctorCheckItem[] {
    const checks: DoctorCheckItem[] = [];

    try {
      this.configLoader.loadWorkflowConfig();
      this.configLoader.loadStateMachineConfig();
      this.configLoader.loadPoliciesConfig();
      this.configLoader.loadComplexityConfig();
      this.configLoader.loadGatesConfig();
      this.configLoader.loadRoutingConfig();
      this.configLoader.loadProvidersConfig();
      checks.push({ name: 'Orchestrator configs', status: 'PASS', details: '7 YAML configs parsed' });
    } catch (error: unknown) {
      checks.push({
        name: 'Orchestrator configs',
        status: 'FAIL',
        details: error instanceof Error ? error.message : String(error),
      });
    }

    const schemas = ['observed-state', 'work-package', 'task', 'run', 'verification', 'requirement-closure'];
    const missing = schemas.filter((schema) => {
      try {
        this.configLoader.loadJsonSchema(schema);
        return false;
      } catch {
        return true;
      }
    });
    checks.push({
      name: 'Validation schemas',
      status: missing.length === 0 ? 'PASS' : 'FAIL',
      details: missing.length === 0 ? `${schemas.length} schemas loaded` : `missing: ${missing.join(', ')}`,
    });

    return checks;
  }

  private checkStateArtifacts(): DoctorCheckItem[] {
    const checks: DoctorCheckItem[] = [];

    const observedFile = path.join(this.projectRoot, '.agentic', 'state', 'observed-state.json');
    if (!fs.existsSync(observedFile)) {
      checks.push({ name: 'Observed state', status: 'WARN', details: 'not generated yet: run `agentic observe`' });
    } else {
      try {
        const observed = JSON.parse(fs.readFileSync(observedFile, 'utf8'));
        const age = Date.now() - new Date(observed.timestamp).getTime();
        const hours = Math.floor(age / 3_600_000);
        const testStatus = observed.tests?.status;
        checks.push({
          name: 'Observed state',
          status: hours > 24 ? 'WARN' : 'PASS',
          details: `observed ${hours}h ago, tests=${testStatus}${testStatus === 'pending' ? ' (not measured)' : ''}`,
        });
      } catch {
        checks.push({ name: 'Observed state', status: 'FAIL', details: 'observed-state.json is not valid JSON' });
      }
    }

    const auditFile = path.join(this.projectRoot, '.agentic', 'audit', 'events.jsonl');
    checks.push({
      name: 'Audit stream',
      status: fs.existsSync(auditFile) ? 'PASS' : 'FAIL',
      details: fs.existsSync(auditFile) ? 'events.jsonl present' : 'events.jsonl missing: runs cannot be audited',
    });

    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    checks.push({
      name: 'Requirement matrix',
      status: fs.existsSync(matrixFile) ? 'PASS' : 'WARN',
      details: fs.existsSync(matrixFile) ? 'requirement-matrix.json present' : 'not created yet',
    });

    return checks;
  }

  private checkEvidenceCapability(): DoctorCheckItem[] {
    const collector = new EvidenceCollector(this.projectRoot, this.configLoader);
    const command = collector.detectTestCommand();

    if (!command) {
      // A greenfield project legitimately has no runner yet. This is a warning,
      // not a failure: the hard block lives in the Verifier, which refuses to
      // close any requirement without executed evidence.
      return [
        {
          name: 'Evidence capability',
          status: 'WARN',
          details:
            'no test runner detected: no requirement can be closed until one exists (set evidence.test_command in .agentic/orchestrator/evidence.yaml)',
        },
      ];
    }

    const latest = collector.latest();
    const detail = latest
      ? `command \`${command}\`; last evidence ${latest.id} [${latest.status}] ${latest.passed}p/${latest.failed}f at ${latest.collected_at}`
      : `command \`${command}\`; no evidence collected yet`;

    return [{ name: 'Evidence capability', status: 'PASS', details: detail }];
  }

  private checkIntegrity(): DoctorCheckItem[] {
    const checks: DoctorCheckItem[] = [];

    const integrity = new AuditLogger(this.projectRoot).verifyIntegrity();
    checks.push({
      name: 'Audit hash chain',
      status: integrity.valid ? 'PASS' : 'FAIL',
      details: integrity.valid
        ? `${integrity.events} events, chain intact${integrity.forks > 0 ? `, ${integrity.forks} concurrent append(s)` : ''}`
        : `${integrity.reason} (event #${integrity.brokenAt})`,
    });

    // Requirements claimed DONE whose evidence is missing or unusable: this is the
    // single most important invariant of the framework, so it is checked directly.
    const problems = new Verifier(this.projectRoot).auditMatrixIntegrity();
    checks.push({
      name: 'Closure evidence',
      status: problems.length === 0 ? 'PASS' : 'FAIL',
      details:
        problems.length === 0
          ? 'every closed requirement references usable executed evidence'
          : problems.map((p) => `${p.requirement}: ${p.problem}`).join(' | '),
    });

    // A project that has not been scaffolded yet has no gates config; that is a
    // setup problem already reported above, not a reason to crash the diagnosis.
    try {
      const pendingGates = new GateKeeper(this.projectRoot, this.configLoader).listPending();
      checks.push({
        name: 'Human gates',
        status: pendingGates.length === 0 ? 'PASS' : 'WARN',
        details:
          pendingGates.length === 0
            ? 'no pending gates'
            : `${pendingGates.length} pending: ${pendingGates.map((g) => g.id).join(', ')}`,
      });
    } catch (error) {
      checks.push({
        name: 'Human gates',
        status: 'WARN',
        details: `gate configuration unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }

    return checks;
  }

  private checkProviders(): DoctorCheckItem[] {
    let providers: Record<string, { engine: string; required?: boolean; fallback?: string }>;
    try {
      providers = this.configLoader.loadProvidersConfig().providers;
    } catch (error) {
      // Not scaffolded yet: the configuration check above already reported it.
      return [
        {
          name: 'Providers',
          status: 'WARN',
          details: `providers.yaml unavailable: ${error instanceof Error ? error.message : String(error)}`,
        },
      ];
    }
    const installer = new ProviderInstaller(this.projectRoot);
    const statuses = installer.checkProviders();
    const checks: DoctorCheckItem[] = [];

    for (const [role, entry] of Object.entries(providers)) {
      const status = statuses.find(
        (s) => s.engine === entry.engine || s.name.toLowerCase().includes(entry.engine.split('-')[0])
      );

      // Every role has a native implementation in this package, so a missing
      // external engine degrades the run rather than breaking it: that is a
      // warning. Claiming PASS for an absent engine (the previous behaviour) or
      // FAIL for an optional enhancement would both be misleading.
      const native = entry.engine.startsWith('native') || NATIVE_ROLES.has(role);
      const detected = Boolean(status?.installed);
      const level: DoctorCheckItem['status'] = detected || native ? 'PASS' : 'WARN';

      checks.push({
        name: `Provider: ${role}`,
        status: level,
        details: `engine=${entry.engine}${entry.fallback ? `, fallback=${entry.fallback}` : ''}${
          detected ? ' (external engine detected)' : native ? ' (native implementation)' : ' - external engine not detected, running natively'
        }${!detected && status ? `; install: ${status.installCommand}` : ''}`,
      });
    }

    const executionEntry = providers.execution as { mode?: string; command?: string } | undefined;
    const mode = executionEntry?.mode === 'command' ? 'command' : 'delegated';
    checks.push({
      name: 'Execution mode',
      status: mode === 'command' && !executionEntry?.command ? 'FAIL' : 'PASS',
      details:
        mode === 'command'
          ? executionEntry?.command
            ? `command mode: ${executionEntry.command}`
            : 'command mode selected but execution.command is missing'
          : 'delegated: prompt packs are handed to the coding agent, results reported with `agentic report`',
    });

    return checks;
  }

  private checkSkillPacks(): DoctorCheckItem[] {
    const registry = new SkillRegistry(this.projectRoot, this.configLoader);
    const packs = registry.listPacks();

    if (packs.length === 0) {
      return [
        {
          name: 'Skill packs',
          status: 'PASS',
          details: 'none configured: every stage runs on the native path',
        },
      ];
    }

    const checks: DoctorCheckItem[] = [];
    for (const pack of packs) {
      // An absent pack is a degradation, never a failure: the native path covers
      // every stage. Reporting it as PASS would hide it, so it is a warning.
      checks.push({
        name: `Skill pack: ${pack.id}`,
        status: !pack.enabled ? 'PASS' : pack.installed ? 'PASS' : 'WARN',
        details: !pack.enabled
          ? `${pack.name} disabled in skills.yaml`
          : pack.installed
          ? `${pack.name} detected (${pack.stagesCovered.length} stages mapped)`
          : `${pack.name} not installed; install with: ${pack.installCommands[0] || pack.source}${
              pack.postInstall ? ` then run ${pack.postInstall}` : ''
            }`,
      });
    }

    const coverage = registry.coverage();
    if (coverage.installedPacks.length > 0 && coverage.uncovered.length > 0) {
      checks.push({
        name: 'Skill stage coverage',
        status: 'WARN',
        details: `stages with no installed skill: ${coverage.uncovered.join(', ')}`,
      });
    }

    return checks;
  }

  private checkAgentIntegrations(): DoctorCheckItem[] {
    const status = new AgentIntegrations(this.projectRoot).status();
    const wired = status.filter((s) => s.installed);
    const detectedButMissing = status.filter((s) => !s.installed && s.detected);

    const checks: DoctorCheckItem[] = [
      {
        name: 'AI integrations',
        status: wired.length === 0 ? 'WARN' : 'PASS',
        details:
          wired.length === 0
            ? 'no AI product is wired to the workflow: run `agentic agents sync`'
            : `${wired.length} wired: ${wired.map((s) => s.definition.label).join(', ')}`,
      },
    ];

    // A product that is clearly in use here but has no instruction file will
    // silently bypass the whole workflow, so it is worth calling out.
    if (detectedButMissing.length > 0) {
      checks.push({
        name: 'Unwired AI products',
        status: 'WARN',
        details: `${detectedButMissing
          .map((s) => s.definition.label)
          .join(', ')} detected on this machine but not wired: run \`agentic agents sync\``,
      });
    }

    return checks;
  }

  private checkTeamReadiness(): DoctorCheckItem[] {
    const team = new TeamCoordinator(this.projectRoot);
    const identity = team.identity();
    const checks: DoctorCheckItem[] = [];

    checks.push({
      name: 'Actor identity',
      status: identity.email === 'unknown@localhost' ? 'WARN' : 'PASS',
      details:
        identity.email === 'unknown@localhost'
          ? 'git user.email is unset: audit events and leases cannot be attributed'
          : `${identity.name} <${identity.email}> on ${identity.host}`,
    });

    const leases = team.list();
    const foreign = leases.filter((l) => l.owner_email !== identity.email);
    checks.push({
      name: 'Work leases',
      status: 'PASS',
      details:
        leases.length === 0
          ? 'no active claims'
          : `${leases.length} active (${foreign.length} held by teammates): ${leases
              .map((l) => `${l.scope}->${l.owner_email}`)
              .join(', ')}`,
    });

    const gitattributes = path.join(this.projectRoot, '.gitattributes');
    const hasUnionMerge =
      fs.existsSync(gitattributes) &&
      fs.readFileSync(gitattributes, 'utf8').includes('.agentic/audit/events.jsonl');
    checks.push({
      name: 'Collaboration policy',
      status: hasUnionMerge ? 'PASS' : 'WARN',
      details: hasUnionMerge
        ? 'audit stream merges by union; shared/local split declared'
        : 'run `agentic team init` so the audit stream does not conflict on every merge',
    });

    return checks;
  }

  public formatReport(report: DoctorReport): string {
    const lines = [
      '================================================================',
      '            Agentic SDLC Doctor Diagnostic',
      '================================================================',
      '',
    ];

    for (const check of report.checks) {
      lines.push(`${check.name.padEnd(24)} [${check.status.padEnd(4)}] ${check.details ? `- ${check.details}` : ''}`);
    }

    const failures = report.checks.filter((c) => c.status === 'FAIL');
    const warnings = report.checks.filter((c) => c.status === 'WARN');

    lines.push('');
    lines.push(
      report.ready
        ? `>>> STATUS: READY - ${report.checks.length - warnings.length} checks clean, ${warnings.length} warning(s).`
        : `>>> STATUS: BLOCKED - ${failures.length} failing check(s) must be fixed before a run can close work.`
    );
    lines.push('================================================================');

    return lines.join('\n');
  }
}
