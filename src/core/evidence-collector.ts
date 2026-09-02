import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawnSync } from 'child_process';
import {
  EvidenceConfig,
  EvidenceRecord,
  EvidenceStatus,
} from '../types/evidence.js';
import { ConfigLoader } from './config-loader.js';
import { AuditLogger } from './audit-logger.js';

export interface CollectOptions {
  runId: string;
  /** Overrides the detected/configured command. */
  command?: string;
  /** Skip execution and produce an `absent` record (used by dry runs). */
  dryRun?: boolean;
}

interface ParsedCounters {
  passed: number;
  failed: number;
  skipped: number;
  parser: string;
  inferred: boolean;
  failedFiles: string[];
}

const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');

/**
 * Executes the project's test suite and records an immutable evidence record.
 *
 * This is the only component allowed to assert that tests passed. Nothing else in
 * the framework may synthesize test counters.
 */
export class EvidenceCollector {
  private projectRoot: string;
  private config: EvidenceConfig;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader, auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    const loader = configLoader || new ConfigLoader(this.projectRoot);
    this.config = loader.loadEvidenceConfig();
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  /** Resolves the command used to produce evidence, or null when the project has no test runner. */
  public detectTestCommand(): string | null {
    const configured = this.config.evidence.test_command;
    if (configured && configured.trim().length > 0) {
      return configured.trim();
    }

    const pkgPath = path.join(this.projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts?.test) {
          return 'npm test --silent';
        }
      } catch {
        // malformed package.json: fall through to other ecosystems
      }
    }

    if (
      fs.existsSync(path.join(this.projectRoot, 'pytest.ini')) ||
      fs.existsSync(path.join(this.projectRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(this.projectRoot, 'tests', '__init__.py'))
    ) {
      return 'pytest -q';
    }
    if (fs.existsSync(path.join(this.projectRoot, 'go.mod'))) {
      return 'go test ./...';
    }
    if (fs.existsSync(path.join(this.projectRoot, 'Cargo.toml'))) {
      return 'cargo test';
    }
    if (fs.existsSync(path.join(this.projectRoot, 'pom.xml'))) {
      return 'mvn -q test';
    }

    return null;
  }

  public collect(options: CollectOptions): EvidenceRecord {
    const command = options.command || this.detectTestCommand();
    const commit = this.currentCommit();

    if (!command) {
      return this.buildRecord({
        runId: options.runId,
        source: 'absent',
        status: 'unavailable',
        command: '(none detected)',
        exitCode: null,
        counters: { passed: 0, failed: 0, skipped: 0, parser: 'none', inferred: true, failedFiles: [] },
        durationMs: 0,
        output: '',
        commit,
        notes: [
          'No test runner detected. Configure .agentic/orchestrator/evidence.yaml -> evidence.test_command.',
        ],
      });
    }

    if (options.dryRun) {
      return this.buildRecord({
        runId: options.runId,
        source: 'absent',
        status: 'unavailable',
        command,
        exitCode: null,
        counters: { passed: 0, failed: 0, skipped: 0, parser: 'none', inferred: true, failedFiles: [] },
        durationMs: 0,
        output: '',
        commit,
        notes: ['Dry run: test suite was not executed, so no requirement may be closed.'],
      });
    }

    this.auditLogger.emit(options.runId, 'EVIDENCE_COLLECTION_STARTED', {
      metadata: { command },
    });

    const started = Date.now();
    const result = spawnSync(command, {
      cwd: this.projectRoot,
      shell: true,
      encoding: 'utf8',
      timeout: this.config.evidence.timeout_ms,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });
    const durationMs = Date.now() - started;

    const output = `${result.stdout || ''}${result.stderr || ''}`;
    const exitCode = typeof result.status === 'number' ? result.status : null;
    const counters = this.parseCounters(output, command);

    let status: EvidenceStatus;
    if (result.error) {
      status = 'error';
    } else if (exitCode === 0 && counters.failed === 0) {
      status = 'pass';
    } else {
      status = 'fail';
    }

    const notes: string[] = [];
    if (result.error) {
      notes.push(`Runner error: ${result.error.message}`);
    }
    if (counters.inferred) {
      notes.push('Test counters could not be parsed; exit code is the only signal.');
    }

    const record = this.buildRecord({
      runId: options.runId,
      source: 'executed',
      status,
      command,
      exitCode,
      counters,
      durationMs,
      output,
      commit,
      notes,
    });

    this.auditLogger.emit(options.runId, 'EVIDENCE_COLLECTED', {
      metadata: {
        evidence: record.id,
        status: record.status,
        passed: record.passed,
        failed: record.failed,
        exit_code: record.exit_code,
      },
    });

    return record;
  }

  /** True when this record is strong enough to close a requirement. */
  public static isClosable(record: EvidenceRecord | undefined): boolean {
    if (!record) return false;
    return record.source === 'executed' && record.status === 'pass' && record.exit_code === 0 && record.failed === 0;
  }

  public load(evidenceId: string): EvidenceRecord | undefined {
    const file = path.join(this.evidenceDir(), `${evidenceId}.json`);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as EvidenceRecord;
    } catch {
      return undefined;
    }
  }

  public latest(): EvidenceRecord | undefined {
    const file = path.join(this.evidenceDir(), 'latest.json');
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as EvidenceRecord;
    } catch {
      return undefined;
    }
  }

  private parseCounters(output: string, command: string): ParsedCounters {
    const clean = output.replace(ANSI_PATTERN, '');

    // Vitest: "Tests  39 passed (39)" / "Tests  1 failed | 38 passed (39)"
    const vitest = clean.match(/Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed(?:\s*\|\s*(\d+)\s+skipped)?/);
    if (vitest) {
      return {
        failed: Number(vitest[1] || 0),
        passed: Number(vitest[2] || 0),
        skipped: Number(vitest[3] || 0),
        parser: 'vitest',
        inferred: false,
        failedFiles: this.extractFailedFiles(clean),
      };
    }

    // Jest: "Tests:       1 failed, 2 skipped, 10 passed, 13 total"
    const jest = clean.match(/Tests:\s+(.+?total)/);
    if (jest) {
      const segment = jest[1];
      const pick = (label: string) => {
        const m = segment.match(new RegExp(`(\\d+)\\s+${label}`));
        return m ? Number(m[1]) : 0;
      };
      return {
        failed: pick('failed'),
        passed: pick('passed'),
        skipped: pick('skipped') + pick('todo'),
        parser: 'jest',
        inferred: false,
        failedFiles: this.extractFailedFiles(clean),
      };
    }

    // Pytest: "===== 3 failed, 12 passed, 1 skipped in 2.13s ====="
    if (/=+\s.*\d+\s+(?:passed|failed).*in\s+[\d.]+s/.test(clean)) {
      const pick = (label: string) => {
        const m = clean.match(new RegExp(`(\\d+)\\s+${label}`));
        return m ? Number(m[1]) : 0;
      };
      return {
        failed: pick('failed') + pick('error') + pick('errors'),
        passed: pick('passed'),
        skipped: pick('skipped'),
        parser: 'pytest',
        inferred: false,
        failedFiles: this.extractFailedFiles(clean),
      };
    }

    // Go: count "--- FAIL:" / "--- PASS:" lines
    if (/^go test/.test(command) || /--- (PASS|FAIL):/.test(clean)) {
      const passed = (clean.match(/--- PASS:/g) || []).length;
      const failed = (clean.match(/--- FAIL:/g) || []).length;
      const skipped = (clean.match(/--- SKIP:/g) || []).length;
      if (passed + failed + skipped > 0) {
        return { passed, failed, skipped, parser: 'go', inferred: false, failedFiles: this.extractFailedFiles(clean) };
      }
    }

    // node:test / TAP: lines like "# pass 12", "# fail 0" or "i pass 12".
    const nodeTest = clean.match(/[#ℹ]\s*pass\s+(\d+)/);
    if (nodeTest) {
      const pick = (label: string) => {
        const m = clean.match(new RegExp(`[#ℹ]\s*${label}\s+(\d+)`));
        return m ? Number(m[1]) : 0;
      };
      return {
        passed: Number(nodeTest[1]),
        failed: pick('fail'),
        skipped: pick('skipped') + pick('todo'),
        parser: 'node-test',
        inferred: false,
        failedFiles: this.extractFailedFiles(clean),
      };
    }

    // Cargo: "test result: ok. 12 passed; 0 failed; 1 ignored"
    const cargo = clean.match(/test result:.*?(\d+)\s+passed;\s*(\d+)\s+failed;\s*(\d+)\s+ignored/);
    if (cargo) {
      return {
        passed: Number(cargo[1]),
        failed: Number(cargo[2]),
        skipped: Number(cargo[3]),
        parser: 'cargo',
        inferred: false,
        failedFiles: [],
      };
    }

    return { passed: 0, failed: 0, skipped: 0, parser: 'exit-code', inferred: true, failedFiles: [] };
  }

  private extractFailedFiles(output: string): string[] {
    const files = new Set<string>();
    const patterns = [
      /FAIL\s+([\w./\\-]+\.(?:test|spec)\.[jt]sx?)/g,
      /FAILED\s+([\w./\\-]+\.py)/g,
      /---\s+FAIL:\s+(\S+)/g,
    ];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(output)) !== null) {
        files.add(match[1]);
      }
    }
    return Array.from(files).slice(0, 50);
  }

  private buildRecord(input: {
    runId: string;
    source: EvidenceRecord['source'];
    status: EvidenceStatus;
    command: string;
    exitCode: number | null;
    counters: ParsedCounters;
    durationMs: number;
    output: string;
    commit: string;
    notes?: string[];
  }): EvidenceRecord {
    const tailChars = this.config.evidence.output_tail_chars;
    const hash = crypto.createHash('sha256').update(input.output).digest('hex');
    const id = `EV-${Date.now()}-${crypto.createHash('sha256').update(input.command).digest('hex').slice(0, 6)}`;

    const record: EvidenceRecord = {
      id,
      run_id: input.runId,
      source: input.source,
      status: input.status,
      command: input.command,
      cwd: this.projectRoot,
      exit_code: input.exitCode,
      passed: input.counters.passed,
      failed: input.counters.failed,
      skipped: input.counters.skipped,
      counters_inferred: input.counters.inferred,
      parser: input.counters.parser,
      duration_ms: input.durationMs,
      failed_test_files: input.counters.failedFiles,
      output_tail: input.output.slice(-tailChars),
      output_sha256: hash,
      commit: input.commit,
      collected_at: new Date().toISOString(),
      notes: input.notes && input.notes.length > 0 ? input.notes : undefined,
    };

    this.save(record);
    return record;
  }

  private save(record: EvidenceRecord) {
    const dir = this.evidenceDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(path.join(dir, `${record.id}.json`), JSON.stringify(record, null, 2), 'utf8');
    fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(record, null, 2), 'utf8');
  }

  private evidenceDir(): string {
    return path.join(this.projectRoot, '.agentic', 'verification', 'evidence');
  }

  private currentCommit(): string {
    const result = spawnSync('git rev-parse HEAD', {
      cwd: this.projectRoot,
      shell: true,
      encoding: 'utf8',
    });
    return (result.stdout || '').trim() || 'unknown';
  }
}
