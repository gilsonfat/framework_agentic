import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { EvidenceCollector } from '../src/core/evidence-collector.js';

describe('EvidenceCollector (executable evidence)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-evidence-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('records a passing suite as executed, closable evidence', () => {
    const collector = new EvidenceCollector(tempDir);
    const record = collector.collect({ runId: 'RUN-EV-PASS', command: 'exit 0' });

    expect(record.source).toBe('executed');
    expect(record.status).toBe('pass');
    expect(record.exit_code).toBe(0);
    expect(record.output_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(EvidenceCollector.isClosable(record)).toBe(true);

    const saved = path.join(tempDir, '.agentic', 'verification', 'evidence', `${record.id}.json`);
    expect(fs.existsSync(saved)).toBe(true);
  });

  it('records a failing suite as non-closable evidence', () => {
    const collector = new EvidenceCollector(tempDir);
    const record = collector.collect({ runId: 'RUN-EV-FAIL', command: 'exit 1' });

    expect(record.source).toBe('executed');
    expect(record.status).toBe('fail');
    expect(record.exit_code).toBe(1);
    expect(EvidenceCollector.isClosable(record)).toBe(false);
  });

  it('refuses to invent counters on a dry run', () => {
    const collector = new EvidenceCollector(tempDir);
    const record = collector.collect({ runId: 'RUN-EV-DRY', command: 'exit 0', dryRun: true });

    expect(record.source).toBe('absent');
    expect(record.passed).toBe(0);
    expect(EvidenceCollector.isClosable(record)).toBe(false);
  });

  it('reports unavailable evidence when the project has no test runner', () => {
    const collector = new EvidenceCollector(tempDir);
    expect(collector.detectTestCommand()).toBeNull();

    const record = collector.collect({ runId: 'RUN-EV-NONE' });
    expect(record.source).toBe('absent');
    expect(record.status).toBe('unavailable');
    expect(EvidenceCollector.isClosable(record)).toBe(false);
  });

  it('parses node:test counters', () => {
    const collector = new EvidenceCollector(tempDir);
    const record = collector.collect({
      runId: 'RUN-EV-NODE',
      command: 'echo "# pass 12" && echo "# fail 0" && exit 0',
    });

    expect(record.parser).toBe('node-test');
    expect(record.passed).toBe(12);
    expect(record.failed).toBe(0);
    expect(record.counters_inferred).toBe(false);
  });

  it('parses vitest counters from real runner output', () => {
    const collector = new EvidenceCollector(tempDir);
    const record = collector.collect({
      runId: 'RUN-EV-PARSE',
      command: 'echo "Tests  1 failed | 38 passed (39)" && exit 1',
    });

    expect(record.parser).toBe('vitest');
    expect(record.passed).toBe(38);
    expect(record.failed).toBe(1);
    expect(record.counters_inferred).toBe(false);
  });
});
