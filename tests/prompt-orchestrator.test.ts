import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PromptOrchestrator } from '../src/core/prompt-orchestrator.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { execSync } from 'child_process';

describe('PromptOrchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-prompt-test-'));
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

  it('should auto-orchestrate a backend prompt into a completed cycle with verification and as-built', async () => {
    const promptOrch = new PromptOrchestrator(tempDir);
    const runResult = await promptOrch.dispatchPrompt('Implementar rota de autenticação JWT com refresh token');

    expect(runResult.status).toBe('COMPLETE');
    expect(runResult.verification?.status).toBe('PASS');
    expect(runResult.work_package.expected_domains).toContain('security');
    expect(runResult.work_package.goal).toContain('autenticação JWT');

    // Check as-built spec generated
    const asBuiltDir = path.join(tempDir, '.agentic', 'specs', 'as-built', runResult.work_package.phase);
    expect(fs.existsSync(asBuiltDir)).toBe(true);
  });

  it('should reject empty prompts', async () => {
    const promptOrch = new PromptOrchestrator(tempDir);
    await expect(promptOrch.dispatchPrompt('   ')).rejects.toThrow(/Prompt instruction cannot be empty/);
  });
});
