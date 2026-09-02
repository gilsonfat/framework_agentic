import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { TeamCoordinator } from '../src/core/team.js';

describe('TeamCoordinator (multi-developer coordination)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-team-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.email dev-a@example.com', { cwd: tempDir, stdio: 'ignore' });
      execSync('git config user.name "Dev A"', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    delete process.env.AGENTIC_ACTOR;
  });

  afterEach(() => {
    delete process.env.AGENTIC_ACTOR;
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('derives the actor identity from git configuration', () => {
    const identity = new TeamCoordinator(tempDir).identity();
    expect(identity.email).toBe('dev-a@example.com');
    expect(identity.name).toBe('Dev A');
    expect(identity.host.length).toBeGreaterThan(0);
  });

  it('claims a phase and reports it as unavailable to another developer', () => {
    const devA = new TeamCoordinator(tempDir);
    const lease = devA.claim('P-001', { runId: 'RUN-A', note: 'checkout flow' });

    expect(lease.owner_email).toBe('dev-a@example.com');
    expect(devA.check('P-001').available).toBe(true);
    expect(devA.check('P-001').mine).toBe(true);

    process.env.AGENTIC_ACTOR = 'dev-b@example.com';
    const devB = new TeamCoordinator(tempDir);
    const check = devB.check('P-001');

    expect(check.available).toBe(false);
    expect(check.reason).toContain('dev-a@example.com');
    expect(() => devB.claim('P-001')).toThrow(/claimed by/);
  });

  it('allows a deliberate takeover with force', () => {
    new TeamCoordinator(tempDir).claim('P-002');

    process.env.AGENTIC_ACTOR = 'dev-b@example.com';
    const devB = new TeamCoordinator(tempDir);
    const lease = devB.claim('P-002', { force: true });

    expect(lease.owner_email).toBe('dev-b@example.com');
    expect(devB.check('P-002').mine).toBe(true);
  });

  it('treats an expired lease as available', () => {
    const coordinator = new TeamCoordinator(tempDir);
    coordinator.claim('P-003', { ttlMinutes: 1 });

    const leaseFile = path.join(tempDir, '.agentic', 'team', 'leases', 'P-003.json');
    const lease = JSON.parse(fs.readFileSync(leaseFile, 'utf8'));
    lease.expires_at = new Date(Date.now() - 60_000).toISOString();
    fs.writeFileSync(leaseFile, JSON.stringify(lease), 'utf8');

    process.env.AGENTIC_ACTOR = 'dev-b@example.com';
    const check = new TeamCoordinator(tempDir).check('P-003');
    expect(check.available).toBe(true);
    expect(check.expired).toBe(true);
  });

  it('refuses to release someone elses lease without force', () => {
    new TeamCoordinator(tempDir).claim('P-004');

    process.env.AGENTIC_ACTOR = 'dev-b@example.com';
    const devB = new TeamCoordinator(tempDir);
    expect(() => devB.release('P-004')).toThrow(/belongs to/);
    expect(devB.release('P-004', { force: true })).toBe(true);
  });

  it('declares the shared/local artifact split and a mergeable audit stream', () => {
    const result = new TeamCoordinator(tempDir).ensureCollaborationPolicy();
    expect(result.written).toContain('.gitattributes');
    expect(result.written).toContain('.agentic/.gitignore');

    const attributes = fs.readFileSync(path.join(tempDir, '.gitattributes'), 'utf8');
    expect(attributes).toContain('.agentic/audit/events.jsonl merge=union');

    const ignore = fs.readFileSync(path.join(tempDir, '.agentic', '.gitignore'), 'utf8');
    expect(ignore).toContain('state/observed-state.json');
    expect(ignore).toContain('verification/evidence/');
    expect(ignore).toContain('team/leases/');
    // Shared team truth must stay committed: no ignore rule may exclude it.
    const ignoreRules = ignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));
    expect(ignoreRules).not.toContain('specs/');
    expect(ignoreRules).not.toContain('gates/');
    expect(ignoreRules).not.toContain('registry/');
    expect(ignoreRules).not.toContain('planning/');
  });
});
