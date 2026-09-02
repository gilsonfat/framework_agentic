import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execSync } from 'child_process';
import { AuditEvent, AuditEventType } from '../types/audit.js';

export interface AuditIntegrityResult {
  valid: boolean;
  events: number;
  /**
   * Events whose `prev_hash` points at an earlier hash that is not the
   * immediately preceding one. That is a concurrent append (two processes
   * writing at once), not tampering: the referenced event still exists.
   */
  forks: number;
  brokenAt?: number;
  reason?: string;
}

/**
 * Append-only audit stream with a tamper-evident SHA-256 hash chain.
 *
 * Each event stores `prev_hash` (the previous event's hash) and `hash`
 * (SHA-256 over its own canonical payload plus `prev_hash`), so any
 * retroactive edit or deletion is detectable by `verifyIntegrity()`.
 */
export class AuditLogger {
  private auditFile: string;
  private actor: string;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    const auditDir = path.join(this.projectRoot, '.agentic', 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    this.auditFile = path.join(auditDir, 'events.jsonl');
    this.actor = this.resolveActor();
  }

  public getActor(): string {
    return this.actor;
  }

  public emit(
    runId: string,
    type: AuditEventType,
    details: Partial<Omit<AuditEvent, 'time' | 'run' | 'type' | 'hash' | 'prev_hash' | 'seq'>> = {}
  ): AuditEvent {
    // Reading the tip and appending must be atomic, otherwise two concurrent
    // processes chain onto the same predecessor and fork the stream.
    const lock = this.acquireLock();
    try {
      const tip = this.readTip();

      const event: AuditEvent = {
        time: new Date().toISOString(),
        run: runId,
        type,
        seq: tip.seq + 1,
        actor: this.actor,
        ...details,
        prev_hash: tip.hash,
      };

      event.hash = AuditLogger.hashEvent(event);

      fs.appendFileSync(this.auditFile, JSON.stringify(event) + '\n', 'utf8');
      return event;
    } finally {
      this.releaseLock(lock);
    }
  }

  /**
   * Best-effort exclusive lock around the append. If the lock cannot be taken
   * (stale lock, read-only FS), the append still happens: losing an audit event
   * would be worse than a forked chain, which `verifyIntegrity` can distinguish
   * from tampering.
   */
  private acquireLock(): number | undefined {
    const lockFile = `${this.auditFile}.lock`;
    const deadline = Date.now() + 2000;

    while (Date.now() < deadline) {
      try {
        return fs.openSync(lockFile, 'wx');
      } catch {
        try {
          const age = Date.now() - fs.statSync(lockFile).mtimeMs;
          if (age > 5000) {
            fs.unlinkSync(lockFile);
            continue;
          }
        } catch {
          continue;
        }
      }
    }
    return undefined;
  }

  private releaseLock(handle: number | undefined) {
    if (handle === undefined) return;
    try {
      fs.closeSync(handle);
      fs.unlinkSync(`${this.auditFile}.lock`);
    } catch {
      // the lock will be reclaimed as stale
    }
  }

  public getEvents(runId?: string): AuditEvent[] {
    if (!fs.existsSync(this.auditFile)) {
      return [];
    }

    const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    const events: AuditEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AuditEvent;
        if (!runId || parsed.run === runId) {
          events.push(parsed);
        }
      } catch {
        // ignore malformed line
      }
    }

    return events;
  }

  /**
   * Walks the whole stream and recomputes the chain. Events written before the
   * chain existed (no `hash`) are tolerated and treated as the chain origin.
   */
  public verifyIntegrity(): AuditIntegrityResult {
    const events = this.getEvents();
    const seenHashes = new Set<string>();
    let prevHash: string | undefined;
    let forks = 0;

    for (let i = 0; i < events.length; i++) {
      const event = events[i];

      // Events written before the chain existed carry no hash and are treated
      // as the origin rather than as corruption.
      if (!event.hash) {
        continue;
      }

      // 1. Tampering: the payload no longer matches its own recorded hash.
      if (AuditLogger.hashEvent(event) !== event.hash) {
        return {
          valid: false,
          events: events.length,
          forks,
          brokenAt: i,
          reason: `Event #${i} (${event.type}) payload does not match its recorded hash: the stream was edited after the fact.`,
        };
      }

      // 2. Removal: it chains onto a predecessor that is not in the stream.
      if (event.prev_hash && !seenHashes.has(event.prev_hash)) {
        return {
          valid: false,
          events: events.length,
          forks,
          brokenAt: i,
          reason: `Event #${i} (${event.type}) chains onto a hash that is absent from the stream: an event was removed.`,
        };
      }

      // 3. Concurrency: valid predecessor, but not the immediately previous
      //    event. Two processes appended at the same time.
      if (prevHash !== undefined && event.prev_hash !== prevHash) {
        forks += 1;
      }

      seenHashes.add(event.hash);
      prevHash = event.hash;
    }

    return { valid: true, events: events.length, forks };
  }

  public static hashEvent(event: AuditEvent): string {
    const { hash: _ignored, ...payload } = event;
    const canonical = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  private readTip(): { seq: number; hash?: string } {
    if (!fs.existsSync(this.auditFile)) {
      return { seq: 0 };
    }
    const lines = fs.readFileSync(this.auditFile, 'utf8').split('\n').filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as AuditEvent;
        return { seq: parsed.seq ?? lines.length, hash: parsed.hash };
      } catch {
        continue;
      }
    }
    return { seq: 0 };
  }

  private resolveActor(): string {
    if (process.env.AGENTIC_ACTOR) {
      return process.env.AGENTIC_ACTOR;
    }
    try {
      return (
        execSync('git config user.email', {
          cwd: this.projectRoot,
          stdio: ['pipe', 'pipe', 'ignore'],
        })
          .toString()
          .trim() || 'unknown'
      );
    } catch {
      return 'unknown';
    }
  }
}
