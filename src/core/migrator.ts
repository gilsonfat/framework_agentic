import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { ARTIFACT_SCHEMA_VERSION, isFromFuture, versionOf } from './artifact-schema.js';
import { AuditLogger } from './audit-logger.js';

export type MigrationSeverity = 'info' | 'warning' | 'critical';

export interface MigrationFinding {
  /** Stable id, so a finding can be referenced in docs and audit events. */
  id: string;
  /** Artifact path relative to the project root. */
  artifact: string;
  from: number;
  to: number;
  severity: MigrationSeverity;
  /** What is wrong. */
  description: string;
  /** What `--apply` will do about it. */
  action: string;
  applied?: boolean;
}

export interface MigrationReport {
  currentVersion: number;
  findings: MigrationFinding[];
  applied: boolean;
  /** Artifacts written by a newer build; this one refuses to touch them. */
  fromFuture: string[];
}

/**
 * Brings `.agentic/` artifacts from an older build up to the current schema.
 *
 * The migrations are deliberately conservative in one direction and strict in
 * the other: nothing is deleted, but any *claim* that the old pipeline could
 * produce without evidence (a closed requirement, a green test status, a
 * COMPLETE run) is downgraded to what the current rules can actually justify.
 * Migrating must never launder an unverified claim into a verified one.
 */
export class Migrator {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public inspect(): MigrationReport {
    return this.run(false);
  }

  public apply(): MigrationReport {
    return this.run(true);
  }

  private run(apply: boolean): MigrationReport {
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    for (const migration of [
      () => this.migrateCurrentRun(apply),
      () => this.migrateObservedState(apply),
      () => this.migrateDeclaredState(apply),
      () => this.migrateWorkPackage(apply),
      () => this.migrateRequirementMatrix(apply),
    ]) {
      const result = migration();
      findings.push(...result.findings);
      fromFuture.push(...result.fromFuture);
    }

    if (apply && findings.length > 0) {
      this.auditLogger.emit('SYSTEM', 'STATE_UPDATED', {
        metadata: {
          migration: true,
          to_version: ARTIFACT_SCHEMA_VERSION,
          applied: findings.map((f) => f.id),
        },
      });
    }

    return { currentVersion: ARTIFACT_SCHEMA_VERSION, findings, applied: apply, fromFuture };
  }

  // ---------------------------------------------------------------- run ----
  private migrateCurrentRun(apply: boolean) {
    const relative = '.agentic/execution/current-run.json';
    const file = path.join(this.projectRoot, relative);
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    const run = this.readJson<Record<string, unknown>>(file);
    if (!run) return { findings, fromFuture };
    if (isFromFuture(run)) return { findings, fromFuture: [relative] };

    const version = versionOf(run);
    if (version >= ARTIFACT_SCHEMA_VERSION) return { findings, fromFuture };

    // A v1 run could reach COMPLETE with no evidence record at all, because the
    // old pipeline synthesized its own test results. That claim cannot be
    // honoured, so the run is retired instead of being carried forward.
    const closedWithoutEvidence = run.status === 'COMPLETE' && !run.evidence;

    findings.push({
      id: closedWithoutEvidence ? 'run-v1-unbacked-closure' : 'run-v1-stamp',
      artifact: relative,
      from: version,
      to: ARTIFACT_SCHEMA_VERSION,
      severity: closedWithoutEvidence ? 'critical' : 'info',
      description: closedWithoutEvidence
        ? `Run ${String(run.run_id)} is marked COMPLETE but carries no evidence record: it was closed by the pre-evidence pipeline.`
        : `Run ${String(run.run_id)} predates artifact versioning.`,
      action: closedWithoutEvidence
        ? 'Retire the run (status STOPPED) and record why, so the dashboard stops reporting a closure nobody can prove.'
        : 'Stamp it with the current schema version.',
      applied: apply,
    });

    if (apply) {
      const migrated: Record<string, unknown> = { ...run, schema_version: ARTIFACT_SCHEMA_VERSION };
      if (closedWithoutEvidence) {
        migrated.status = 'STOPPED';
        migrated.blockers = [
          'Retired by `agentic migrate`: this run was closed by the pre-evidence pipeline and has no evidence record.',
          'Start a fresh cycle with `agentic prompt "<instruction>"`.',
        ];
      }
      this.writeJson(file, migrated);
    }

    return { findings, fromFuture };
  }

  // ------------------------------------------------------ observed state ----
  private migrateObservedState(apply: boolean) {
    const relative = '.agentic/state/observed-state.json';
    const file = path.join(this.projectRoot, relative);
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    const observed = this.readJson<Record<string, unknown>>(file);
    if (!observed) return { findings, fromFuture };
    if (isFromFuture(observed)) return { findings, fromFuture: [relative] };

    const version = versionOf(observed);
    if (version >= ARTIFACT_SCHEMA_VERSION) return { findings, fromFuture };

    const tests = (observed.tests as Record<string, unknown> | undefined) || {};
    // v1 reported `pass` whenever a test script merely existed. That is not a
    // measurement, so it becomes `pending` (not measured).
    const fabricatedPass = tests.status === 'pass' && !tests.evidence_id;

    findings.push({
      id: fabricatedPass ? 'observed-v1-unmeasured-pass' : 'observed-v1-stamp',
      artifact: relative,
      from: version,
      to: ARTIFACT_SCHEMA_VERSION,
      severity: fabricatedPass ? 'warning' : 'info',
      description: fabricatedPass
        ? 'Observed state claims the suite passed but references no evidence record: the old observer assumed a pass without running anything.'
        : 'Observed state predates artifact versioning.',
      action: fabricatedPass
        ? 'Set the test status to `pending` (not measured). Re-measure with `agentic observe --tests`.'
        : 'Stamp it with the current schema version.',
      applied: apply,
    });

    if (apply) {
      const migrated: Record<string, unknown> = { ...observed, schema_version: ARTIFACT_SCHEMA_VERSION };
      if (fabricatedPass) {
        migrated.tests = { ...tests, status: 'pending' };
        const risks = Array.isArray(observed.risks) ? (observed.risks as string[]) : [];
        migrated.risks = [
          ...risks,
          'Test status downgraded to `pending` by `agentic migrate`: the previous value was never measured.',
        ];
      }
      this.writeJson(file, migrated);
    }

    return { findings, fromFuture };
  }

  // ------------------------------------------------------ declared state ----
  private migrateDeclaredState(apply: boolean) {
    return this.stampJson('.agentic/state/declared-state.json', 'declared-state-v1-stamp', 'Declared state', apply);
  }

  // -------------------------------------------------------- work package ----
  private migrateWorkPackage(apply: boolean) {
    const relative = '.agentic/planning/current-work-package.yaml';
    const file = path.join(this.projectRoot, relative);
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    if (!fs.existsSync(file)) return { findings, fromFuture };

    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = YAML.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
      return { findings, fromFuture };
    }
    if (!parsed) return { findings, fromFuture };
    if (isFromFuture(parsed)) return { findings, fromFuture: [relative] };

    const version = versionOf(parsed);
    if (version >= ARTIFACT_SCHEMA_VERSION) return { findings, fromFuture };

    findings.push({
      id: 'work-package-v1-stamp',
      artifact: relative,
      from: version,
      to: ARTIFACT_SCHEMA_VERSION,
      severity: 'info',
      description: 'Work package predates artifact versioning.',
      action: 'Stamp it with the current schema version.',
      applied: apply,
    });

    if (apply) {
      fs.writeFileSync(
        file,
        YAML.stringify({ schema_version: ARTIFACT_SCHEMA_VERSION, ...parsed }),
        'utf8'
      );
    }

    return { findings, fromFuture };
  }

  // -------------------------------------------------- requirement matrix ----
  private migrateRequirementMatrix(apply: boolean) {
    const relative = '.agentic/verification/requirement-matrix.json';
    const file = path.join(this.projectRoot, relative);
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    const matrix = this.readJson<Record<string, Record<string, unknown>>>(file);
    if (!matrix) return { findings, fromFuture };

    // Entries are keyed by requirement id, so the version lives per entry:
    // a v1 closure is one that claims `verified` with no evidence reference.
    const unbacked = Object.entries(matrix).filter(
      ([id, entry]) =>
        id !== 'schema_version' &&
        entry &&
        typeof entry === 'object' &&
        entry.verified === true &&
        !entry.evidence
    );

    if (unbacked.length === 0) return { findings, fromFuture };

    findings.push({
      id: 'matrix-unbacked-closure',
      artifact: relative,
      from: 1,
      to: ARTIFACT_SCHEMA_VERSION,
      severity: 'critical',
      description: `${unbacked.length} requirement(s) marked verified with no evidence record: ${unbacked
        .map(([id]) => id)
        .join(', ')}.`,
      action:
        'Downgrade them to `tested: false, verified: false` with a note. Re-close them properly with `agentic verify`.',
      applied: apply,
    });

    if (apply) {
      const migrated = { ...matrix };
      for (const [id, entry] of unbacked) {
        migrated[id] = {
          ...entry,
          tested: false,
          verified: false,
          note: 'Closure revoked by `agentic migrate`: no evidence record backs it. Re-verify to close.',
        };
      }
      this.writeJson(file, migrated);
    }

    return { findings, fromFuture };
  }

  // --------------------------------------------------------------- utils ----
  private stampJson(relative: string, id: string, label: string, apply: boolean) {
    const file = path.join(this.projectRoot, relative);
    const findings: MigrationFinding[] = [];
    const fromFuture: string[] = [];

    const artifact = this.readJson<Record<string, unknown>>(file);
    if (!artifact) return { findings, fromFuture };
    if (isFromFuture(artifact)) return { findings, fromFuture: [relative] };

    const version = versionOf(artifact);
    if (version >= ARTIFACT_SCHEMA_VERSION) return { findings, fromFuture };

    findings.push({
      id,
      artifact: relative,
      from: version,
      to: ARTIFACT_SCHEMA_VERSION,
      severity: 'info',
      description: `${label} predates artifact versioning.`,
      action: 'Stamp it with the current schema version.',
      applied: apply,
    });

    if (apply) {
      this.writeJson(file, { schema_version: ARTIFACT_SCHEMA_VERSION, ...artifact });
    }

    return { findings, fromFuture };
  }

  private readJson<T>(file: string): T | undefined {
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
    } catch {
      return undefined;
    }
  }

  private writeJson(file: string, data: unknown): void {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
}
