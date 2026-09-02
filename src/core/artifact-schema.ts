/**
 * Versioning of the artifacts under `.agentic/`.
 *
 * The framework rewrites its own state on every run. Without a version stamp,
 * an artifact produced by an older build is indistinguishable from a current one
 * and gets read with the wrong assumptions - which is exactly how a run closed by
 * the old (pre-evidence) pipeline could still be reported as COMPLETE.
 *
 * Version history:
 *  - v1: implicit, artifacts written before versioning existed. Notably, runs
 *        could reach COMPLETE without an evidence record, and observed state
 *        reported `tests.status = pass` without ever executing the suite.
 *  - v2: current. Closure requires an executed evidence record; unmeasured test
 *        status is reported as `pending`; runs carry `dispatch` and `evidence`.
 */
export const ARTIFACT_SCHEMA_VERSION = 2;

export interface VersionedArtifact {
  /** Absent means v1 (written before versioning existed). */
  schema_version?: number;
}

/** Adds the current version stamp to an artifact about to be written. */
export function stampVersion<T extends object>(artifact: T): T & { schema_version: number } {
  return { schema_version: ARTIFACT_SCHEMA_VERSION, ...artifact };
}

/** Version of an artifact already on disk. Unstamped artifacts are v1. */
export function versionOf(artifact: unknown): number {
  if (!artifact || typeof artifact !== 'object') return 0;
  const value = (artifact as VersionedArtifact).schema_version;
  return typeof value === 'number' && Number.isFinite(value) ? value : 1;
}

/** True when the artifact can be read with the current assumptions. */
export function isCurrent(artifact: unknown): boolean {
  return versionOf(artifact) === ARTIFACT_SCHEMA_VERSION;
}

/** True when the artifact predates the current schema and needs migration. */
export function isLegacy(artifact: unknown): boolean {
  const version = versionOf(artifact);
  return version > 0 && version < ARTIFACT_SCHEMA_VERSION;
}

/**
 * True when the artifact comes from a *newer* build than this one. Reading it
 * would silently drop fields, so callers must refuse instead of guessing.
 */
export function isFromFuture(artifact: unknown): boolean {
  return versionOf(artifact) > ARTIFACT_SCHEMA_VERSION;
}
