import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { RemediationPackage, VerificationReport } from '../types/verification.js';
import { PoliciesConfig } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';

export class RemediationEngine {
  private projectRoot: string;
  private config: PoliciesConfig;
  private auditLogger: AuditLogger;
  private attemptCounts: Map<string, number> = new Map();
  private stateFile: string;

  constructor(
    projectRoot: string = process.cwd(),
    configLoader?: ConfigLoader,
    auditLogger?: AuditLogger
  ) {
    this.projectRoot = path.resolve(projectRoot);
    const loader = configLoader || new ConfigLoader(this.projectRoot);
    this.config = loader.loadPoliciesConfig();
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
    this.stateFile = path.join(this.projectRoot, '.agentic', 'execution', 'remediation-state.json');
    this.loadAttempts();
  }

  public createRemediationPackages(
    report: VerificationReport,
    affectedTasksMap: Record<string, string[]> = {}
  ): { packages: RemediationPackage[]; escalateToHumanGate: boolean } {
    const packages: RemediationPackage[] = [];
    let escalateToHumanGate = false;
    const maxAttempts = this.config.policies.loop.maximum_automatic_remediation_attempts || 3;

    for (const req of report.requirements_checked) {
      if (req.status === 'failed') {
        // Attempts are keyed by requirement, not by run: a fresh run id must not
        // reset the loop budget, otherwise the "3 attempts then human gate" policy
        // is trivially bypassed by starting a new run.
        const attemptKey = req.requirement_id;
        const currentAttempt = (this.attemptCounts.get(attemptKey) || 0) + 1;
        this.attemptCounts.set(attemptKey, currentAttempt);
        this.saveAttempts();

        if (currentAttempt > maxAttempts) {
          escalateToHumanGate = true;
        }

        const pkg: RemediationPackage = {
          run_id: report.run_id,
          verification_id: report.verification_id,
          requirement: req.requirement_id,
          expected: `All criteria pass: [${req.acceptance_criteria_passed.concat(req.acceptance_criteria_failed).join(', ')}]`,
          observed: `Criteria failed: [${req.acceptance_criteria_failed.join(', ')}]`,
          evidence: report.blocking_findings || [],
          affected_tasks: affectedTasksMap[req.requirement_id] || [],
          suspected_areas: req.findings || [],
          severity: currentAttempt >= maxAttempts ? 'CRITICAL' : 'MAJOR',
          attempt: currentAttempt,
        };

        packages.push(pkg);
        this.saveRemediationPackage(pkg);

        this.auditLogger.emit(report.run_id, 'REMEDIATION_STARTED', {
          requirement: req.requirement_id,
          metadata: {
            attempt: currentAttempt,
            maxAttempts,
            escalateToHumanGate,
          },
        });
      }
    }

    return { packages, escalateToHumanGate };
  }

  public getAttemptCount(_runId: string, requirementId: string): number {
    return this.attemptCounts.get(requirementId) || 0;
  }

  /** Clears the attempt budget for a requirement once it verifies green. */
  public resetAttempts(requirementIds: string[]): void {
    let changed = false;
    for (const id of requirementIds) {
      if (this.attemptCounts.delete(id)) changed = true;
    }
    if (changed) this.saveAttempts();
  }

  public isExhausted(requirementId: string): boolean {
    const max = this.config.policies.loop.maximum_automatic_remediation_attempts || 3;
    return (this.attemptCounts.get(requirementId) || 0) >= max;
  }

  private loadAttempts() {
    if (!fs.existsSync(this.stateFile)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) as Record<string, number>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number') this.attemptCounts.set(key, value);
      }
    } catch {
      // corrupted state: start from zero rather than crashing the loop
    }
  }

  private saveAttempts() {
    const dir = path.dirname(this.stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      this.stateFile,
      JSON.stringify(Object.fromEntries(this.attemptCounts.entries()), null, 2),
      'utf8'
    );
  }

  private saveRemediationPackage(pkg: RemediationPackage) {
    const executionDir = path.join(this.projectRoot, '.agentic', 'execution', 'work-packages');
    if (!fs.existsSync(executionDir)) {
      fs.mkdirSync(executionDir, { recursive: true });
    }
    const filename = `remediation-${pkg.requirement}-${pkg.attempt}.yaml`;
    fs.writeFileSync(path.join(executionDir, filename), YAML.stringify(pkg), 'utf8');
  }
}
