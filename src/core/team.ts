import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { Lease, LeaseCheck, TeamIdentity } from '../types/team.js';
import { AuditLogger } from './audit-logger.js';

const DEFAULT_TTL_MINUTES = 240;

/**
 * Team coordination layer.
 *
 * A framework that manages team development needs three things the single-user
 * design lacked: a stable identity per actor, an explicit claim on a unit of
 * work so two people do not drive the same phase, and a declared split between
 * artifacts that belong to the repository (specs, decisions, plans, gates) and
 * artifacts that are machine-local noise (observed state, runs, evidence).
 */
export class TeamCoordinator {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public identity(): TeamIdentity {
    const read = (key: string, fallback: string) => {
      try {
        return (
          execSync(`git config ${key}`, { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
            .toString()
            .trim() || fallback
        );
      } catch {
        return fallback;
      }
    };

    return {
      email: process.env.AGENTIC_ACTOR || read('user.email', 'unknown@localhost'),
      name: read('user.name', os.userInfo().username || 'unknown'),
      host: os.hostname(),
    };
  }

  public check(scope: string): LeaseCheck {
    const lease = this.get(scope);
    const me = this.identity();

    if (!lease) {
      return { available: true, reason: `No active lease on '${scope}'.`, mine: false, expired: false };
    }

    const expired = new Date(lease.expires_at).getTime() < Date.now();
    const mine = lease.owner_email === me.email && lease.host === me.host;

    if (expired) {
      return {
        available: true,
        lease,
        reason: `Lease on '${scope}' held by ${lease.owner_email} expired at ${lease.expires_at}.`,
        mine,
        expired: true,
      };
    }

    if (mine) {
      return { available: true, lease, reason: `You already hold '${scope}'.`, mine: true, expired: false };
    }

    return {
      available: false,
      lease,
      reason: `'${scope}' is claimed by ${lease.owner_name} <${lease.owner_email}> on ${lease.host} (branch ${lease.branch}) until ${lease.expires_at}.`,
      mine: false,
      expired: false,
    };
  }

  public claim(
    scope: string,
    options: { scopeType?: 'phase' | 'task'; runId?: string; ttlMinutes?: number; force?: boolean; note?: string } = {}
  ): Lease {
    const state = this.check(scope);

    if (!state.available && !options.force) {
      this.auditLogger.emit(options.runId || 'SYSTEM', 'LEASE_DENIED', {
        metadata: { scope, reason: state.reason },
      });
      throw new Error(`${state.reason}\nUse --force to take over the lease deliberately.`);
    }

    const me = this.identity();
    const now = new Date();
    const ttl = options.ttlMinutes ?? DEFAULT_TTL_MINUTES;

    const lease: Lease = {
      scope,
      scope_type: options.scopeType || (scope.startsWith('TASK-') ? 'task' : 'phase'),
      run_id: options.runId,
      owner_email: me.email,
      owner_name: me.name,
      host: me.host,
      branch: this.currentBranch(),
      acquired_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
      expires_at: new Date(now.getTime() + ttl * 60_000).toISOString(),
      note: options.note,
    };

    this.write(lease);
    this.auditLogger.emit(options.runId || 'SYSTEM', 'LEASE_ACQUIRED', {
      metadata: {
        scope,
        owner: me.email,
        expires_at: lease.expires_at,
        takeover: !state.available,
        previous_owner: state.lease?.owner_email,
      },
    });

    return lease;
  }

  public heartbeat(scope: string, ttlMinutes = DEFAULT_TTL_MINUTES): Lease | undefined {
    const lease = this.get(scope);
    if (!lease) return undefined;
    const me = this.identity();
    if (lease.owner_email !== me.email) return lease;

    const now = new Date();
    lease.heartbeat_at = now.toISOString();
    lease.expires_at = new Date(now.getTime() + ttlMinutes * 60_000).toISOString();
    this.write(lease);
    return lease;
  }

  public release(scope: string, options: { force?: boolean; runId?: string } = {}): boolean {
    const lease = this.get(scope);
    if (!lease) return false;

    const me = this.identity();
    if (lease.owner_email !== me.email && !options.force) {
      throw new Error(
        `Lease on '${scope}' belongs to ${lease.owner_email}. Use --force to release someone else's lease.`
      );
    }

    fs.unlinkSync(this.leaseFile(scope));
    this.auditLogger.emit(options.runId || lease.run_id || 'SYSTEM', 'LEASE_RELEASED', {
      metadata: { scope, owner: lease.owner_email, released_by: me.email },
    });
    return true;
  }

  public list(): Lease[] {
    const dir = this.leasesDir();
    if (!fs.existsSync(dir)) return [];
    const out: Lease[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.json')) continue;
      try {
        out.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as Lease);
      } catch {
        // ignore malformed lease
      }
    }
    return out.sort((a, b) => a.acquired_at.localeCompare(b.acquired_at));
  }

  public get(scope: string): Lease | undefined {
    const file = this.leaseFile(scope);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Lease;
    } catch {
      return undefined;
    }
  }

  /**
   * Declares which `.agentic/` artifacts are shared team truth and which are
   * machine-local, and makes the append-only audit stream mergeable.
   * Without this, every teammate conflicts on `observed-state.json` and
   * `events.jsonl` on every pull.
   */
  public ensureCollaborationPolicy(options: { force?: boolean } = {}): { written: string[]; skipped: string[] } {
    const written: string[] = [];
    const skipped: string[] = [];

    const gitattributesPath = path.join(this.projectRoot, '.gitattributes');
    const attributeLines = [
      '# Agentic SDLC: append-only streams must merge by union, never by conflict.',
      '.agentic/audit/events.jsonl merge=union -diff',
      '.agentic/registry/ids.json merge=union',
    ];
    const existingAttributes = fs.existsSync(gitattributesPath)
      ? fs.readFileSync(gitattributesPath, 'utf8')
      : '';
    if (!existingAttributes.includes('.agentic/audit/events.jsonl')) {
      fs.writeFileSync(
        gitattributesPath,
        `${existingAttributes}${existingAttributes && !existingAttributes.endsWith('\n') ? '\n' : ''}${attributeLines.join('\n')}\n`,
        'utf8'
      );
      written.push('.gitattributes');
    } else {
      skipped.push('.gitattributes');
    }

    const agenticIgnorePath = path.join(this.projectRoot, '.agentic', '.gitignore');
    const ignoreContent = [
      '# Machine-local artifacts: never share these across the team.',
      '# Observed state is per-checkout truth; runs and evidence are per-machine executions.',
      'state/observed-state.json',
      'state/reconciled-state.json',
      'state/diff.json',
      'state/history/',
      'execution/current-run.json',
      'execution/runs/',
      'execution/inbox/',
      'execution/results/',
      'verification/evidence/',
      'verification/reports/',
      'reconciliation/reports/',
      'team/leases/',
      'tasks/current/',
      'worktrees/',
      'execution/worktrees/',
      '',
      '# Shared team truth is committed: orchestrator/, specs/, planning/, gates/,',
      '# registry/, prompts/, templates/, audit/, verification/requirement-matrix.json',
      '',
    ].join('\n');

    if (!fs.existsSync(agenticIgnorePath) || options.force) {
      const dir = path.dirname(agenticIgnorePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(agenticIgnorePath, ignoreContent, 'utf8');
      written.push('.agentic/.gitignore');
    } else {
      skipped.push('.agentic/.gitignore');
    }

    return { written, skipped };
  }

  private leaseFile(scope: string): string {
    const safe = scope.replace(/[^A-Za-z0-9._-]/g, '_');
    return path.join(this.leasesDir(), `${safe}.json`);
  }

  private leasesDir(): string {
    return path.join(this.projectRoot, '.agentic', 'team', 'leases');
  }

  private write(lease: Lease) {
    const dir = this.leasesDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.leaseFile(lease.scope), JSON.stringify(lease, null, 2), 'utf8');
  }

  private currentBranch(): string {
    try {
      return (
        execSync('git branch --show-current', { cwd: this.projectRoot, stdio: ['pipe', 'pipe', 'ignore'] })
          .toString()
          .trim() || 'HEAD'
      );
    } catch {
      return 'unknown';
    }
  }
}
