import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ConfigLoader } from './config-loader.js';

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

export class Doctor {
  private projectRoot: string;
  private configLoader: ConfigLoader;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
  }

  public runDiagnostics(): DoctorReport {
    const checks: DoctorCheckItem[] = [];

    // 1. Check Git
    try {
      execSync('git rev-parse --is-inside-work-tree', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] });
      checks.push({ name: 'Git repository', status: 'PASS', details: 'Initialized and working' });
    } catch {
      checks.push({ name: 'Git repository', status: 'FAIL', details: 'Not a git repository or git unavailable' });
    }

    // 2. Check Configurations & Schemas
    try {
      this.configLoader.loadWorkflowConfig();
      this.configLoader.loadStateMachineConfig();
      this.configLoader.loadPoliciesConfig();
      this.configLoader.loadComplexityConfig();
      this.configLoader.loadGatesConfig();
      this.configLoader.loadRoutingConfig();
      this.configLoader.loadProvidersConfig();
      checks.push({ name: 'Orchestrator Configs', status: 'PASS', details: 'All YAML configurations valid' });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({ name: 'Orchestrator Configs', status: 'FAIL', details: msg });
    }

    // 3. Check JSON Schemas
    const schemas = [
      'observed-state',
      'work-package',
      'task',
      'run',
      'verification',
      'requirement-closure',
    ];
    let schemasValid = true;
    for (const schema of schemas) {
      try {
        this.configLoader.loadJsonSchema(schema);
      } catch {
        schemasValid = false;
      }
    }
    checks.push({
      name: 'Config Schemas',
      status: schemasValid ? 'PASS' : 'FAIL',
      details: schemasValid ? 'All 6 schemas loaded' : 'Missing schemas in schemas/ directory',
    });

    // 4. Check State directory
    const stateFile = path.join(this.projectRoot, '.agentic', 'state', 'observed-state.json');
    if (fs.existsSync(stateFile)) {
      checks.push({ name: 'Observed State', status: 'PASS', details: 'observed-state.json exists' });
    } else {
      checks.push({ name: 'Observed State', status: 'WARN', details: 'observed-state.json not yet generated' });
    }

    // 5. Check Requirement Matrix
    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (fs.existsSync(matrixFile)) {
      checks.push({ name: 'Requirement Matrix', status: 'PASS', details: 'requirement-matrix.json present' });
    } else {
      checks.push({ name: 'Requirement Matrix', status: 'WARN', details: 'requirement-matrix.json missing' });
    }

    // 6. Check Audit Log
    const auditFile = path.join(this.projectRoot, '.agentic', 'audit', 'events.jsonl');
    if (fs.existsSync(auditFile)) {
      checks.push({ name: 'Audit Log', status: 'PASS', details: 'events.jsonl active' });
    } else {
      checks.push({ name: 'Audit Log', status: 'FAIL', details: 'events.jsonl missing' });
    }

    // 7. Check Providers (GSD, TLC, Ruflo, Superpowers)
    const providers = this.configLoader.loadProvidersConfig();
    checks.push({
      name: 'GSD Planner Provider',
      status: providers.providers.project_planner ? 'PASS' : 'WARN',
      details: `Engine: ${providers.providers.project_planner?.engine || 'default'}`,
    });
    checks.push({
      name: 'TLC Spec & Verifier',
      status: providers.providers.specification ? 'PASS' : 'WARN',
      details: `Engine: ${providers.providers.specification?.engine || 'default'} (Fresh Context: ${providers.providers.verification?.fresh_context})`,
    });
    checks.push({
      name: 'Ruflo Execution Provider',
      status: 'PASS',
      details: `Engine: ${providers.providers.execution?.engine || 'optional'} (Fallback: ${providers.providers.execution?.fallback})`,
    });
    const processEngine = providers.providers.process?.engine || 'superpowers';
    checks.push({
      name: 'Process Provider',
      status: providers.providers.process ? 'PASS' : 'WARN',
      details: `Engine: ${processEngine}${processEngine === 'ecc' ? ' (ECC Enterprise Suite)' : processEngine === 'superpowers' ? ' (Superpowers TDD)' : ''}`,
    });

    const ready = !checks.some((c) => c.status === 'FAIL');

    return {
      ready,
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  public formatReport(report: DoctorReport): string {
    const lines = [
      '========================================',
      '      Agentic SDLC Doctor Diagnostic     ',
      '========================================',
      '',
    ];

    for (const check of report.checks) {
      const statusPad = check.status.padEnd(6);
      const namePad = check.name.padEnd(26);
      lines.push(`${namePad} [${statusPad}] ${check.details ? `— ${check.details}` : ''}`);
    }

    lines.push('');
    lines.push(
      report.ready
        ? '>>> STATUS: READY — All critical components verified.'
        : '>>> STATUS: BLOCKED — Address failing checks above.'
    );
    lines.push('========================================');

    return lines.join('\n');
  }
}
