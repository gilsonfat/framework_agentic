import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Scaffolder } from '../src/core/scaffolder.js';
import { Doctor } from '../src/core/doctor.js';

describe('Scaffolder (CLI Project Initialization)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-scaffold-test-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should scaffold complete .agentic structure in an external target project', () => {
    const scaffolder = new Scaffolder();
    const result = scaffolder.scaffold(tempDir, { autoObserve: false });

    expect(result.createdDirectories.length).toBeGreaterThan(10);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'orchestrator', 'workflow.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'orchestrator', 'state-machine.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'orchestrator', 'schemas', 'observed-state.schema.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'prompts', 'orchestrator.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'templates', 'work-package.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'audit', 'events.jsonl'))).toBe(true);

    // Verify Doctor on scaffolded project
    const doctor = new Doctor(tempDir);
    const report = doctor.runDiagnostics();
    expect(report.ready).toBe(true);
  });
});
