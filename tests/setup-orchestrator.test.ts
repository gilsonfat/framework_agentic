import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { SetupOrchestrator } from '../src/core/setup-orchestrator.js';

describe('SetupOrchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-setup-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should run full automated setup in target directory', () => {
    const setup = new SetupOrchestrator(tempDir);
    const result = setup.runFullSetup({ installEngines: false });

    expect(result.scaffoldSuccess).toBe(true);
    expect(result.gitInitialized).toBe(true);
    expect(result.rulesConfigured).toContain('AGENTS.md');
    expect(result.rulesConfigured).toContain('GEMINI.md');
    expect(result.rulesConfigured).toContain('CLAUDE.md');

    expect(fs.existsSync(path.join(tempDir, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'GEMINI.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, 'CLAUDE.md'))).toBe(true);

    expect(fs.existsSync(path.join(tempDir, '.agentic', 'state', 'observed-state.json'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'state', 'reconciled-state.json'))).toBe(true);
    expect(result.doctorReport.ready).toBe(true);
  });
});
