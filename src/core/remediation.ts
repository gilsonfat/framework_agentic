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

  constructor(
    projectRoot: string = process.cwd(),
    configLoader?: ConfigLoader,
    auditLogger?: AuditLogger
  ) {
    this.projectRoot = path.resolve(projectRoot);
    const loader = configLoader || new ConfigLoader(this.projectRoot);
    this.config = loader.loadPoliciesConfig();
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
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
        const attemptKey = `${report.run_id}:${req.requirement_id}`;
        const currentAttempt = (this.attemptCounts.get(attemptKey) || 0) + 1;
        this.attemptCounts.set(attemptKey, currentAttempt);

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

  public getAttemptCount(runId: string, requirementId: string): number {
    const attemptKey = `${runId}:${requirementId}`;
    return this.attemptCounts.get(attemptKey) || 0;
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
