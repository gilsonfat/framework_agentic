import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { runCli } from '../src/cli/cli-runner.js';
import { Scaffolder } from '../src/core/scaffolder.js';

/**
 * The CLI is the surface every human and agent touches, so its failure modes
 * matter as much as its happy paths: an operator must never be handed a Node
 * stack trace for something they can fix.
 */
describe('CLI', () => {
  let tempDir: string;
  let out: string[];
  let err: string[];

  const invoke = (args: string[], cwd = tempDir) => runCli(['node', 'agentic', ...args], cwd);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-cli-'));
    out = [];
    err = [];
    vi.spyOn(console, 'log').mockImplementation((...args) => void out.push(args.join(' ')));
    vi.spyOn(console, 'error').mockImplementation((...args) => void err.push(args.join(' ')));
    process.exitCode = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('on an uninitialized project', () => {
    it('tells the operator to initialize instead of throwing', async () => {
      const code = await invoke(['prompt', 'criar algo']);

      expect(code).toBe(1);
      expect(err.join('\n')).toContain('needs this project to be initialized');
      expect(err.join('\n')).toContain('agentic init');
      // No stack trace leaked.
      expect(err.join('\n')).not.toContain('at Command');
    });

    it('guards every command that depends on the architecture', async () => {
      for (const args of [['run'], ['verify'], ['grill', 'x'], ['gate', 'list'], ['migrate']]) {
        err = [];
        const code = await invoke(args);
        expect(code, `${args.join(' ')} should fail`).toBe(1);
        expect(err.join('\n'), `${args.join(' ')} should point at init`).toContain('agentic init');
      }
    });

    it('answers status with guidance rather than an error', async () => {
      const code = await invoke(['status']);

      expect(code).toBe(0);
      expect(out.join('\n')).toContain('not initialized');
      expect(out.join('\n')).toContain('agentic init');
    });
  });

  describe('argument errors', () => {
    it('reports an unknown command with a way forward', async () => {
      const code = await invoke(['definitely-not-a-command']);

      expect(code).toBe(1);
      expect(err.join('\n')).toContain('agentic --help');
    });

    it('reports a missing argument without a stack trace', async () => {
      const code = await invoke(['report']);

      expect(code).toBe(1);
      expect(err.join('\n')).not.toContain('at Command');
    });
  });

  describe('on an initialized project', () => {
    beforeEach(() => {
      new Scaffolder().scaffold(tempDir, { autoObserve: false });
    });

    it('runs status', async () => {
      const code = await invoke(['status']);

      expect(code).toBe(0);
      expect(out.join('\n')).toContain('Agentic SDLC Status');
    });

    it('turns an unknown gate into an actionable message', async () => {
      const code = await invoke(['gate', 'approve', 'GATE-DOES-NOT-EXIST']);

      expect(code).toBe(1);
      const output = err.join('\n');
      expect(output).toContain('not found');
      expect(output).toContain('agentic gate list');
      expect(output).not.toContain('at Command');
    });

    it('reports migration findings as a dry run by default', async () => {
      fs.writeFileSync(
        path.join(tempDir, '.agentic', 'execution', 'current-run.json'),
        JSON.stringify({ run_id: 'RUN-2026-01-01-0001', status: 'COMPLETE', work_package: {} }),
        'utf8'
      );

      const code = await invoke(['migrate']);
      const output = out.join('\n');

      expect(code).toBe(0);
      expect(output).toContain('run-v1-unbacked-closure');
      expect(output).toContain('Dry run');
      // Still untouched.
      const run = JSON.parse(
        fs.readFileSync(path.join(tempDir, '.agentic', 'execution', 'current-run.json'), 'utf8')
      );
      expect(run.status).toBe('COMPLETE');
    });
  });

  it('reports the version from package.json', async () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
    ) as { version: string };

    const logged: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logged.push(String(chunk));
      return true;
    });

    const code = await invoke(['--version']);
    write.mockRestore();

    expect(code).toBe(0);
    expect(logged.join('')).toContain(pkg.version);
  });
});
