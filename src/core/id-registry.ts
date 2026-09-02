import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { IdAllocation, IdKind, IdRegistryFile } from '../types/registry.js';
import { AuditLogger } from './audit-logger.js';

const ID_WIDTH: Record<IdKind, number> = {
  REQ: 3,
  SPEC: 3,
  ADR: 3,
  TASK: 3,
  PHASE: 2,
  MILESTONE: 2,
  RUN: 4,
};

/**
 * Allocates stable, sequential, collision-free identifiers.
 *
 * Random identifiers break the framework's own "stable identifiers" invariant:
 * two developers (or two runs) can mint the same REQ/SPEC/ADR number, and the
 * traceability matrix silently merges unrelated work. This registry keeps a
 * counter per kind and, before allocating, reconciles it against the identifiers
 * already present on disk — so a registry lost to a bad merge is self-healing
 * and never re-issues an id that already exists in the repository.
 */
export class IdRegistry {
  private projectRoot: string;
  private registryFile: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.registryFile = path.join(this.projectRoot, '.agentic', 'registry', 'ids.json');
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public allocate(kind: IdKind, options: { title?: string; runId?: string } = {}): string {
    const registry = this.load();
    const floor = Math.max(registry.counters[kind] || 0, this.scanHighest(kind));
    const next = floor + 1;

    const id = IdRegistry.format(kind, next);
    registry.counters[kind] = next;

    const allocation: IdAllocation = {
      id,
      kind,
      title: options.title,
      run_id: options.runId,
      actor: this.actor(),
      allocated_at: new Date().toISOString(),
    };
    registry.allocations.push(allocation);
    this.save(registry);

    this.auditLogger.emit(options.runId || 'SYSTEM', 'ID_ALLOCATED', {
      metadata: { id, kind, title: options.title },
    });

    return id;
  }

  /** Allocates a matched REQ/SPEC/PHASE triple for one unit of work. */
  public allocateWorkUnit(options: { title?: string; runId?: string } = {}): {
    reqId: string;
    specId: string;
    phaseId: string;
  } {
    const reqId = this.allocate('REQ', options);
    const number = reqId.split('-')[1];
    // SPEC and PHASE mirror the REQ number so traceability stays readable by humans.
    const registry = this.load();
    registry.counters.SPEC = Math.max(registry.counters.SPEC || 0, Number(number));
    registry.counters.PHASE = Math.max(registry.counters.PHASE || 0, Number(number));
    this.save(registry);
    return { reqId, specId: `SPEC-${number}`, phaseId: `P-${number}` };
  }

  public generateRunId(): string {
    const date = new Date().toISOString().slice(0, 10);
    const seq = this.allocate('RUN');
    return `RUN-${date}-${seq.replace('RUN-', '')}`;
  }

  public list(kind?: IdKind): IdAllocation[] {
    const registry = this.load();
    return kind ? registry.allocations.filter((a) => a.kind === kind) : registry.allocations;
  }

  public isKnown(id: string): boolean {
    return this.load().allocations.some((a) => a.id === id);
  }

  public static format(kind: IdKind, value: number): string {
    const prefix = kind === 'PHASE' ? 'P' : kind === 'MILESTONE' ? 'M' : kind;
    return `${prefix}-${String(value).padStart(ID_WIDTH[kind], '0')}`;
  }

  /**
   * Highest identifier of `kind` already materialized on disk. This makes the
   * registry recoverable: delete ids.json and allocation still moves forward.
   */
  public scanHighest(kind: IdKind): number {
    const roots: string[] = [
      path.join(this.projectRoot, '.agentic', 'specs', 'planned'),
      path.join(this.projectRoot, '.agentic', 'specs', 'decisions'),
      path.join(this.projectRoot, '.agentic', 'specs', 'as-built'),
      path.join(this.projectRoot, '.agentic', 'planning', 'history'),
      path.join(this.projectRoot, '.agentic', 'tasks', 'current'),
    ];

    const prefix = kind === 'PHASE' ? 'P' : kind === 'MILESTONE' ? 'M' : kind;
    const pattern = new RegExp(`\\b${prefix}-(\\d+)`, 'g');
    let highest = 0;

    const consider = (text: string) => {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const value = Number(match[1]);
        if (Number.isFinite(value) && value > highest) highest = value;
      }
    };

    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      for (const entry of this.walk(root)) {
        consider(path.basename(entry));

        // Identifiers frequently appear only inside an artifact (a REQ id inside
        // its SPEC file, for instance), so small text artifacts are scanned too.
        try {
          const stat = fs.statSync(entry);
          if (stat.isFile() && stat.size <= 512 * 1024 && /\.(md|ya?ml|json)$/i.test(entry)) {
            consider(fs.readFileSync(entry, 'utf8'));
          }
        } catch {
          continue;
        }
      }
    }

    const matrixFile = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (fs.existsSync(matrixFile)) {
      try {
        consider(Object.keys(JSON.parse(fs.readFileSync(matrixFile, 'utf8'))).join(' '));
      } catch {
        // ignore malformed matrix
      }
    }

    return highest;
  }

  private walk(dir: string, depth = 0): string[] {
    if (depth > 3) return [];
    const out: string[] = [];
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        out.push(full);
        out.push(...this.walk(full, depth + 1));
      } else {
        out.push(full);
      }
    }
    return out;
  }

  private load(): IdRegistryFile {
    if (fs.existsSync(this.registryFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.registryFile, 'utf8')) as IdRegistryFile;
        return {
          version: parsed.version || 1,
          counters: parsed.counters || {},
          allocations: Array.isArray(parsed.allocations) ? parsed.allocations : [],
        };
      } catch {
        // corrupted registry: rebuild from disk scan
      }
    }
    return { version: 1, counters: {}, allocations: [] };
  }

  private save(registry: IdRegistryFile) {
    const dir = path.dirname(this.registryFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.registryFile, JSON.stringify(registry, null, 2), 'utf8');
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
