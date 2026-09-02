import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync, spawnSync } from 'child_process';

/**
 * The in-process CLI tests cover behaviour; these cover the wiring the user
 * actually runs: the `bin` shim, the compiled output, the real exit codes and
 * what lands on stdout/stderr.
 */
describe('agentic binary', () => {
  const repoRoot = process.cwd();
  const bin = path.join(repoRoot, 'bin', 'agentic.js');
  let tempDir: string;

  const run = (args: string[], cwd = tempDir) =>
    spawnSync(process.execPath, [bin, ...args], { cwd, encoding: 'utf8', env: { ...process.env, CI: '1' } });

  beforeAll(() => {
    // The binary runs the build output, so it has to exist.
    if (!fs.existsSync(path.join(repoRoot, 'dist', 'cli', 'cli-runner.js'))) {
      execSync('npm run build', { cwd: repoRoot, stdio: 'ignore' });
    }
  }, 180_000);

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-bin-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('prints the package version and exits 0', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')) as { version: string };
    const result = run(['--version']);

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('exits 1 with an actionable message on an uninitialized project', () => {
    const result = run(['prompt', 'criar algo']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('agentic init');
    expect(result.stderr).not.toContain('at Command');
    expect(result.stderr).not.toContain('node:internal');
  });

  it('exits 1 on an unknown command', () => {
    const result = run(['nope']);

    expect(result.status).toBe(1);
    expect(`${result.stderr}${result.stdout}`).toContain('--help');
  });

  it('initializes a project and reports a coherent status', () => {
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email bin@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Bin', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"name":"bin-fixture","scripts":{"test":"exit 0"}}', 'utf8');

    const init = run(['init', '--agents', 'claude']);
    expect(init.status).toBe(0);
    expect(init.stdout).toContain('READY TO USE');

    const status = run(['status']);
    expect(status.status).toBe(0);
    expect(status.stdout).toContain('Agentic SDLC Status');

    const doctor = run(['doctor']);
    expect(doctor.status).toBe(0);
    expect(doctor.stdout).toContain('STATUS: READY');

    // Nothing is claimed as done before any work happened.
    expect(status.stdout).toContain('0 / 0 closed with evidence');
  }, 120_000);

  it('runs the two-phase flow end to end and closes with evidence', () => {
    execSync('git init -q .', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.email bin@example.com', { cwd: tempDir, stdio: 'ignore' });
    execSync('git config user.name Bin', { cwd: tempDir, stdio: 'ignore' });
    fs.writeFileSync(
      path.join(tempDir, 'package.json'),
      '{"name":"bin-flow","type":"module","scripts":{"test":"node --test"}}',
      'utf8'
    );
    fs.mkdirSync(path.join(tempDir, 'tests'), { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, 'tests', 'smoke.test.js'),
      "import { test } from 'node:test';\nimport assert from 'node:assert';\ntest('ok', () => assert.equal(1, 1));\n",
      'utf8'
    );
    execSync('git add -A && git commit -qm init', { cwd: tempDir, stdio: 'ignore' });
    const head = execSync('git rev-parse HEAD', { cwd: tempDir, encoding: 'utf8' }).trim();

    expect(run(['init', '--agents', 'claude']).status).toBe(0);

    const prompt = run(['prompt', 'Criar rota de listagem de produtos']);
    expect(prompt.status).toBe(0);
    expect(prompt.stdout).toContain('AWAITING_AGENT');
    expect(fs.existsSync(path.join(tempDir, '.agentic', 'execution', 'inbox', 'TASK-001.md'))).toBe(true);

    // The policy refuses a completed feature with no test.
    const bad = run(['report', 'TASK-001', '--status', 'completed', '--commit', head]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('policies.tdd.feature');

    const good = run([
      'report',
      'TASK-001',
      '--status',
      'completed',
      '--files',
      'src/products.js',
      '--tests',
      'tests/smoke.test.js',
      '--commit',
      head,
    ]);
    expect(good.status).toBe(0);

    const verify = run(['verify']);
    expect(verify.status).toBe(0);
    expect(verify.stdout).toContain('COMPLETE');
    expect(verify.stdout).toContain('Verification: PASS');

    const matrix = JSON.parse(
      fs.readFileSync(path.join(tempDir, '.agentic', 'verification', 'requirement-matrix.json'), 'utf8')
    ) as Record<string, { verified: boolean; evidence?: string }>;
    const closed = Object.values(matrix).filter((entry) => entry.verified && entry.evidence);
    expect(closed.length).toBeGreaterThan(0);
  }, 120_000);
});
