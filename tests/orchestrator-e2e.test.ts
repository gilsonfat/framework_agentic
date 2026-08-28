import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Orchestrator } from '../src/core/orchestrator.js';
import { Scaffolder } from '../src/core/scaffolder.js';

describe('Orchestrator E2E Loop', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-e2e-test-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    const scaffolder = new Scaffolder();
    scaffolder.scaffold(tempDir, { autoObserve: true });
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should execute a full autonomous cycle: observe -> plan -> compile -> execute -> review -> verify -> as-built -> state update', async () => {
    const orchestrator = new Orchestrator(tempDir);
    const result = await orchestrator.runCycle({ phaseId: 'P01' });
    expect(result).toBeDefined();
    expect(result.run_id).toMatch(/^RUN-/);
    expect(result.status).toBe('COMPLETE');
    expect(result.verification?.status).toBe('PASS');
    expect(result.dag?.nodes.length).toBeGreaterThan(0);
  });
});
