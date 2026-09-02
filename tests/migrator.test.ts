import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { Scaffolder } from '../src/core/scaffolder.js';
import { Migrator } from '../src/core/migrator.js';
import { ArtifactValidator } from '../src/core/artifact-validator.js';
import { StatusDashboard } from '../src/core/status.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { Observer } from '../src/core/observer.js';
import { Doctor } from '../src/core/doctor.js';
import { ARTIFACT_SCHEMA_VERSION, isLegacy, versionOf } from '../src/core/artifact-schema.js';

describe('Artifact versioning and migration', () => {
  let tempDir: string;

  const write = (relative: string, data: unknown) => {
    const full = path.join(tempDir, relative);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  };
  const read = <T>(relative: string): T => JSON.parse(fs.readFileSync(path.join(tempDir, relative), 'utf8')) as T;

  /** A run as the pre-evidence pipeline used to write it. */
  const legacyRun = (overrides: Record<string, unknown> = {}) => ({
    run_id: 'RUN-2026-08-28-1004',
    status: 'COMPLETE',
    started_at: new Date().toISOString(),
    baseline_commit: 'abc1234',
    work_package: { milestone: 'M01', phase: 'P01', requirements: ['REQ-001'] },
    dag: { nodes: [{ id: 'TASK-001' }] },
    ...overrides,
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-migrate-'));
    new Scaffolder().scaffold(tempDir, { autoObserve: false });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('treats an unstamped artifact as v1 and a stamped one as current', () => {
    expect(versionOf({})).toBe(1);
    expect(versionOf({ schema_version: ARTIFACT_SCHEMA_VERSION })).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(isLegacy({})).toBe(ARTIFACT_SCHEMA_VERSION > 1);
    expect(isLegacy({ schema_version: ARTIFACT_SCHEMA_VERSION })).toBe(false);
  });

  it('retires a run that was closed without evidence', () => {
    write('.agentic/execution/current-run.json', legacyRun());

    const dryRun = new Migrator(tempDir).inspect();
    const finding = dryRun.findings.find((f) => f.id === 'run-v1-unbacked-closure');
    expect(finding).toBeDefined();
    expect(finding?.severity).toBe('critical');
    // A dry run must not touch anything.
    expect(read<{ status: string }>('.agentic/execution/current-run.json').status).toBe('COMPLETE');

    new Migrator(tempDir).apply();
    const migrated = read<{ status: string; schema_version: number; blockers: string[] }>(
      '.agentic/execution/current-run.json'
    );
    expect(migrated.status).toBe('STOPPED');
    expect(migrated.schema_version).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(migrated.blockers.join(' ')).toContain('pre-evidence pipeline');
  });

  it('keeps a legacy run that was never closed, only stamping it', () => {
    write('.agentic/execution/current-run.json', legacyRun({ status: 'AWAITING_AGENT' }));

    new Migrator(tempDir).apply();
    const migrated = read<{ status: string; schema_version: number }>('.agentic/execution/current-run.json');

    expect(migrated.status).toBe('AWAITING_AGENT');
    expect(migrated.schema_version).toBe(ARTIFACT_SCHEMA_VERSION);
  });

  it('downgrades a test status that was never measured', () => {
    write('.agentic/state/observed-state.json', {
      run_id: 'RUN-2026-08-28-1004',
      git: { branch: 'main', commit: 'abc', is_clean: true, dirty_files: [], recent_commits: [] },
      project: { name: 'x', stack: [], scripts: { test: 'vitest' }, migrations: [] },
      tests: { status: 'pass', passed: 0, failed: 0, skipped: 0, duration_ms: 0, failed_test_files: [] },
      requirements: {},
      tasks: {},
      specs: { planned: [], as_built: [] },
      risks: [],
      blockers: [],
      timestamp: new Date().toISOString(),
    });

    const report = new Migrator(tempDir).apply();
    expect(report.findings.some((f) => f.id === 'observed-v1-unmeasured-pass')).toBe(true);

    const migrated = read<{ tests: { status: string }; risks: string[] }>('.agentic/state/observed-state.json');
    expect(migrated.tests.status).toBe('pending');
    expect(migrated.risks.join(' ')).toContain('never measured');
  });

  it('revokes requirement closures with no evidence record', () => {
    write('.agentic/verification/requirement-matrix.json', {
      'REQ-001': { implemented: true, tested: true, verified: true, tasks: ['TASK-001'] },
      'REQ-002': { implemented: true, tested: true, verified: true, tasks: ['TASK-002'], evidence: 'EV-123' },
    });

    const report = new Migrator(tempDir).apply();
    const finding = report.findings.find((f) => f.id === 'matrix-unbacked-closure');
    expect(finding?.description).toContain('REQ-001');
    expect(finding?.description).not.toContain('REQ-002');

    const matrix = read<Record<string, { verified: boolean; note?: string }>>(
      '.agentic/verification/requirement-matrix.json'
    );
    expect(matrix['REQ-001'].verified).toBe(false);
    expect(matrix['REQ-001'].note).toContain('Closure revoked');
    // A properly closed requirement is left alone.
    expect(matrix['REQ-002'].verified).toBe(true);
  });

  it('is idempotent', () => {
    write('.agentic/execution/current-run.json', legacyRun());

    expect(new Migrator(tempDir).apply().findings.length).toBeGreaterThan(0);
    expect(new Migrator(tempDir).inspect().findings).toEqual([]);
  });

  it('refuses to migrate an artifact written by a newer build', () => {
    write('.agentic/execution/current-run.json', {
      ...legacyRun(),
      schema_version: ARTIFACT_SCHEMA_VERSION + 5,
    });

    const report = new Migrator(tempDir).apply();
    expect(report.fromFuture).toContain('.agentic/execution/current-run.json');
    expect(report.findings.some((f) => f.artifact.includes('current-run'))).toBe(false);
    // Untouched.
    expect(read<{ status: string }>('.agentic/execution/current-run.json').status).toBe('COMPLETE');
  });

  it('stamps every artifact the cycle writes', () => {
    new Observer(tempDir).observe('RUN-STAMP-1');
    expect(read<{ schema_version: number }>('.agentic/state/observed-state.json').schema_version).toBe(
      ARTIFACT_SCHEMA_VERSION
    );
  });

  describe('status dashboard', () => {
    it('refuses to report a legacy run as if it were current', () => {
      write('.agentic/execution/current-run.json', legacyRun());
      const data = new StatusDashboard(tempDir).getStatusData();

      expect(data.state).toContain('LEGACY');
      expect(data.schemaMismatch).toEqual({ found: 1, expected: ARTIFACT_SCHEMA_VERSION, direction: 'legacy' });
      expect(data.nextAction).toContain('agentic migrate');
      expect(new StatusDashboard(tempDir).render()).toContain('artifact v1');
    });

    it('flags an artifact from a newer build', () => {
      write('.agentic/execution/current-run.json', {
        ...legacyRun(),
        schema_version: ARTIFACT_SCHEMA_VERSION + 1,
      });
      const data = new StatusDashboard(tempDir).getStatusData();

      expect(data.state).toContain('UNREADABLE');
      expect(data.nextAction).toContain('Update the agentic CLI');
    });
  });

  it('does not resume a run from another schema version', async () => {
    write('.agentic/execution/current-run.json', legacyRun({ status: 'AWAITING_AGENT' }));
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
      YAML.stringify({ version: 1, evidence: { test_command: 'exit 0' } }),
      'utf8'
    );

    const orchestrator = new Orchestrator(tempDir);
    expect(orchestrator.isRunCompatible(orchestrator.loadCurrentRun())).toBe(false);

    const result = await orchestrator.runCycle({ phaseId: 'P-001' });
    // A brand new run, not a continuation of the incompatible one.
    expect(result.run_id).not.toBe('RUN-2026-08-28-1004');
    expect(result.schema_version ?? versionOf(read('.agentic/execution/current-run.json'))).toBe(
      ARTIFACT_SCHEMA_VERSION
    );
  });

  describe('schema validation', () => {
    it('validates the real artifacts against the shipped JSON Schemas', () => {
      new Observer(tempDir).observe('RUN-VALIDATE-1');
      expect(new ArtifactValidator(tempDir).failures()).toEqual([]);
    });

    it('accepts the run ids the CLI actually produces', () => {
      new Observer(tempDir).observe('RUN-OBSERVE-1788359796413');
      const results = new ArtifactValidator(tempDir).validateAll();
      const observed = results.find((r) => r.artifact.includes('observed-state'));

      expect(observed?.valid).toBe(true);
    });

    it('catches an artifact that does not match its contract', () => {
      write('.agentic/state/observed-state.json', { run_id: 'not-a-run-id', schema_version: 2 });
      const failures = new ArtifactValidator(tempDir).failures();

      expect(failures).toHaveLength(1);
      expect(failures[0].errors.length).toBeGreaterThan(0);
    });
  });

  describe('doctor', () => {
    it('fails while an unbacked closure is still on disk', () => {
      write('.agentic/verification/requirement-matrix.json', {
        'REQ-001': { implemented: true, tested: true, verified: true, tasks: [] },
      });

      const before = new Doctor(tempDir).runDiagnostics();
      expect(before.checks.find((c) => c.name === 'Artifact schema')?.status).toBe('FAIL');
      expect(before.ready).toBe(false);

      new Migrator(tempDir).apply();

      const after = new Doctor(tempDir).runDiagnostics();
      expect(after.checks.find((c) => c.name === 'Artifact schema')?.status).toBe('PASS');
    });
  });
});
