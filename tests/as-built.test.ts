import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { AsBuiltGenerator } from '../src/core/as-built.js';

describe('AsBuiltGenerator', () => {
  let tempDir: string;
  let generator: AsBuiltGenerator;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-asbuilt-'));
    generator = new AsBuiltGenerator(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should generate as-built specification markdown from execution evidence', () => {
    const doc = generator.generate({
      runId: 'RUN-TEST-AB',
      milestone: 'M01',
      phase: 'P01',
      baselineCommit: 'abc1234',
      resultCommit: 'def5678',
      verificationReport: {
        verification_id: 'VER-001',
        run_id: 'RUN-TEST-AB',
        status: 'PASS',
        timestamp: new Date().toISOString(),
        verifier_type: 'fresh_context',
        requirements_checked: [
          {
            requirement_id: 'REQ-001',
            status: 'verified',
            acceptance_criteria_passed: ['AC-001.1'],
            acceptance_criteria_failed: [],
          },
        ],
        evidence: {
          tests_passed: 5,
          tests_failed: 0,
        },
      },
      workPackage: {
        run_id: 'RUN-TEST-AB',
        milestone: 'M01',
        phase: 'P01',
        goal: 'Test Phase',
        scope: { include: [], exclude: [] },
        requirements: ['REQ-001'],
        dependencies: [],
        risks: [],
        blockers: [],
        complexity: 'S',
        expected_domains: ['backend'],
      },
      filesChanged: ['src/core/example.ts'],
      testsSummary: '5 tests passed',
    });

    expect(doc).toContain('# As-Built Specification');
    expect(doc).toContain('RUN-TEST-AB');
    expect(doc).toContain('VER-001');
    expect(doc).toContain('REQ-001');
    expect(doc).toContain('src/core/example.ts');

    // The document is persisted under the phase, inside the target project only.
    const asBuiltFile = path.join(tempDir, '.agentic', 'specs', 'as-built', 'P01', 'RUN-TEST-AB.md');
    expect(fs.existsSync(asBuiltFile)).toBe(true);
  });
});
