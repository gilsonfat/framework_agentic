import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { GateRequest, GateStatus } from '../types/gate.js';
import { WorkPackage } from '../types/task.js';
import { ObservedState } from '../types/state.js';
import { GatesConfig, PoliciesConfig } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';

export interface GateEvaluationInput {
  runId: string;
  workPackage: WorkPackage;
  observed?: ObservedState;
  /** Files the run intends to write, used to detect destructive/sensitive areas. */
  plannedWrites?: string[];
  /** Set when the remediation loop has exhausted its automatic attempts. */
  repeatedRemediationFailure?: boolean;
  /** Set when the run introduces a new milestone. */
  newMilestone?: boolean;
}

export interface GateEvaluation {
  blocked: boolean;
  triggered: GateRequest[];
  /** Gates already approved for this run (informational). */
  approved: GateRequest[];
}

/**
 * Enforces the human gates declared in `gates.yaml` and the security policies in
 * `policies.yaml`.
 *
 * Previously these files were parsed but never consulted during a run: the
 * orchestrator computed `human_gate_required` and then proceeded regardless.
 * A gate is now a persisted, auditable artifact that blocks the state machine
 * until a human decides, and decisions are recorded with an actor identity.
 */
export class GateKeeper {
  private projectRoot: string;
  private gates: GatesConfig;
  private policies: PoliciesConfig;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader, auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    const loader = configLoader || new ConfigLoader(this.projectRoot);
    this.gates = loader.loadGatesConfig();
    this.policies = loader.loadPoliciesConfig();
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public evaluate(input: GateEvaluationInput): GateEvaluation {
    const reasons: Array<{ gate: string; reason: string; details?: string[] }> = [];
    const wp = input.workPackage;
    const domains = (wp.expected_domains || []).map((d) => d.toLowerCase());
    const writes = input.plannedWrites || [];

    if (input.newMilestone) {
      reasons.push({ gate: 'new_milestone', reason: `Run opens a new milestone (${wp.milestone}).` });
    }

    if (domains.includes('security')) {
      const gate = this.policies.policies.security?.authentication_change === 'human_gate'
        ? 'authentication_change'
        : 'architecture_change';
      reasons.push({
        gate,
        reason: 'Work package touches the security/authentication domain.',
        details: [`domains: ${domains.join(', ')}`],
      });
    }

    if (wp.complexity === 'XL') {
      reasons.push({
        gate: 'architecture_change',
        reason: 'Complexity XL implies architectural impact across multiple domains.',
        details: [`complexity: ${wp.complexity}`],
      });
    }

    const destructive = this.detectDestructiveMigrations(writes, input.observed);
    if (destructive.length > 0) {
      reasons.push({
        gate: 'destructive_database_change',
        reason: 'Potentially destructive database change detected.',
        details: destructive,
      });
    }

    const secretWrites = writes.filter((w) => /\.env|secret|credential|id_rsa|private\.key/i.test(w));
    if (secretWrites.length > 0) {
      reasons.push({
        gate: 'authorization_change',
        reason: 'Run intends to write to secret/credential material.',
        details: secretWrites,
      });
    }

    if (input.repeatedRemediationFailure) {
      reasons.push({
        gate: 'repeated_remediation_failure',
        reason: 'Automatic remediation attempts were exhausted.',
      });
    }

    if (wp.human_gate_required) {
      reasons.push({
        gate: 'normal_feature',
        reason: 'Work package explicitly declares human_gate_required.',
      });
    }

    // Decisions are matched by fingerprint across every run: a human approval
    // must survive the next `agentic run`, otherwise an approved gate re-opens
    // forever and the gate mechanism is unusable.
    const existing = this.readAll();
    const triggered: GateRequest[] = [];
    const approved: GateRequest[] = [];

    for (const candidate of reasons) {
      if (!this.isGateRequired(candidate.gate)) {
        continue;
      }

      const scope = wp.phase;
      const fingerprint = GateKeeper.fingerprint(candidate.gate, scope, candidate.details);
      const already = existing.find((g) => g.fingerprint === fingerprint);

      if (already) {
        if (already.status === 'APPROVED') {
          approved.push(already);
        } else {
          // PENDING and REJECTED both keep the run blocked.
          triggered.push(already);
        }
        continue;
      }

      triggered.push(
        this.open({
          runId: input.runId,
          gate: candidate.gate,
          scope,
          fingerprint,
          reason: candidate.reason,
          context: {
            phase: wp.phase,
            milestone: wp.milestone,
            requirements: wp.requirements,
            domains: wp.expected_domains,
            complexity: wp.complexity,
            details: candidate.details,
          },
        })
      );
    }

    return {
      blocked: triggered.some((g) => g.status !== 'APPROVED'),
      triggered,
      approved,
    };
  }

  public open(input: {
    runId: string;
    gate: string;
    reason: string;
    scope?: string;
    fingerprint?: string;
    context?: GateRequest['context'];
  }): GateRequest {
    const scope = input.scope || input.context?.phase || 'global';
    const request: GateRequest = {
      id: `GATE-${Date.now()}-${input.gate}`,
      run_id: input.runId,
      gate: input.gate,
      scope,
      fingerprint: input.fingerprint || GateKeeper.fingerprint(input.gate, scope, input.context?.details),
      reason: input.reason,
      context: input.context || {},
      requested_by: 'orchestrator',
      requested_at: new Date().toISOString(),
      status: 'PENDING',
    };

    this.write(request);
    this.auditLogger.emit(input.runId, 'HUMAN_GATE_TRIGGERED', {
      metadata: { gate: request.gate, gate_id: request.id, reason: request.reason },
    });
    return request;
  }

  public decide(gateId: string, decision: Exclude<GateStatus, 'PENDING'>, note?: string): GateRequest {
    const request = this.get(gateId);
    if (!request) {
      throw new Error(`Gate '${gateId}' not found in .agentic/gates/.`);
    }
    if (request.status !== 'PENDING') {
      throw new Error(`Gate '${gateId}' was already ${request.status.toLowerCase()} by ${request.decided_by}.`);
    }

    request.status = decision;
    request.decided_by = this.actor();
    request.decided_at = new Date().toISOString();
    request.note = note;

    this.write(request);
    this.auditLogger.emit(request.run_id, decision === 'APPROVED' ? 'HUMAN_GATE_APPROVED' : 'HUMAN_GATE_REJECTED', {
      metadata: { gate: request.gate, gate_id: request.id, decided_by: request.decided_by, note },
    });

    return request;
  }

  public listPending(): GateRequest[] {
    return this.readAll().filter((g) => g.status === 'PENDING');
  }

  public listForRun(runId: string): GateRequest[] {
    return this.readAll().filter((g) => g.run_id === runId);
  }

  public get(gateId: string): GateRequest | undefined {
    return this.readAll().find((g) => g.id === gateId || g.id.endsWith(gateId));
  }

  /** Gates already decided for a scope, for reporting and for status. */
  public listForScope(scope: string): GateRequest[] {
    return this.readAll().filter((g) => g.scope === scope);
  }

  public static fingerprint(gate: string, scope: string, details?: string[]): string {
    const canonical = JSON.stringify({ gate, scope, details: [...(details || [])].sort() });
    return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }

  private isGateRequired(gate: string): boolean {
    const entry = this.gates.human_gates?.[gate];
    if (!entry) return false;
    return Boolean(entry.required);
  }

  private detectDestructiveMigrations(writes: string[], observed?: ObservedState): string[] {
    const details: string[] = [];
    const migrationTargets = writes.filter((w) => /migration|migrate|schema/i.test(w));
    for (const target of migrationTargets) {
      details.push(`planned write to migration path: ${target}`);
    }

    // Inspect uncommitted migration files for destructive statements.
    const dirty = observed?.git.dirty_files || [];
    for (const entry of dirty) {
      const file = entry.replace(/^\S+\s+/, '');
      if (!/migration|migrate|\.sql$/i.test(file)) continue;
      const full = path.join(this.projectRoot, file);
      if (!fs.existsSync(full)) continue;
      try {
        const content = fs.readFileSync(full, 'utf8').toUpperCase();
        if (/DROP\s+(TABLE|COLUMN|DATABASE)|TRUNCATE\s+TABLE|ALTER\s+TABLE\s+\S+\s+DROP/.test(content)) {
          details.push(`destructive statement found in ${file}`);
        }
      } catch {
        // unreadable file: ignore
      }
    }

    return details;
  }

  private readAll(): GateRequest[] {
    const dir = this.gatesDir();
    if (!fs.existsSync(dir)) return [];
    const out: GateRequest[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as GateRequest);
      } catch {
        // ignore malformed gate file
      }
    }
    return out.sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  }

  private write(request: GateRequest) {
    const dir = this.gatesDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, `${request.id}.json`), JSON.stringify(request, null, 2), 'utf8');
  }

  private gatesDir(): string {
    return path.join(this.projectRoot, '.agentic', 'gates');
  }

  private actor(): string {
    if (process.env.AGENTIC_ACTOR) return process.env.AGENTIC_ACTOR;
    try {
      return (
        execSync('git config user.email', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
          .toString()
          .trim() || 'unknown'
      );
    } catch {
      return 'unknown';
    }
  }
}
