import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ModuleDetector } from '../src/core/module-detector.js';
import { Observer } from '../src/core/observer.js';
import { Scaffolder } from '../src/core/scaffolder.js';

describe('ModuleDetector and Multi-Module .planning', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-modules-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('detects monorepo apps and packages accurately', () => {
    // Scaffold fake monorepo: apps/tech, packages/ui, modules/billing
    fs.mkdirSync(path.join(tempDir, 'apps', 'tech'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'packages', 'ui'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'modules', 'billing'), { recursive: true });

    const detector = new ModuleDetector(tempDir);
    const info = detector.detect();

    expect(info.isMultiModule).toBe(true);
    expect(info.modules).toHaveLength(3);

    const techMod = info.modules.find((m) => m.name === 'tech');
    expect(techMod).toBeDefined();
    expect(techMod?.type).toBe('app');
    expect(techMod?.relativePath).toBe('apps/tech');

    const uiMod = info.modules.find((m) => m.name === 'ui');
    expect(uiMod).toBeDefined();
    expect(uiMod?.type).toBe('package');
    expect(uiMod?.relativePath).toBe('packages/ui');
  });

  it('scaffolds .planning/SCOPE.md and .planning/modules/<mod> non-destructively', () => {
    // Setup apps/tech
    fs.mkdirSync(path.join(tempDir, 'apps', 'tech'), { recursive: true });

    // Pre-create custom .planning/SCOPE.md to test preservation
    const planningDir = path.join(tempDir, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });
    const customScope = '# Custom User Scope - Do Not Overwrite';
    fs.writeFileSync(path.join(planningDir, 'SCOPE.md'), customScope, 'utf8');

    const detector = new ModuleDetector(tempDir);
    const result = detector.scaffoldModularPlanning();

    // Check that root SCOPE was preserved
    expect(result.preserved).toContain('.planning/SCOPE.md');
    const readScope = fs.readFileSync(path.join(planningDir, 'SCOPE.md'), 'utf8');
    expect(readScope).toBe(customScope);

    // Check that tech module planning was created
    expect(result.created).toContain('.planning/modules/tech/');
    expect(result.created).toContain('.planning/modules/tech/SCOPE.md');
    expect(result.created).toContain('.planning/modules/tech/ROADMAP.md');
    expect(result.created).toContain('.planning/team/OWNERSHIP.md');

    expect(fs.existsSync(path.join(planningDir, 'modules', 'tech', 'SCOPE.md'))).toBe(true);
    const techScope = fs.readFileSync(path.join(planningDir, 'modules', 'tech', 'SCOPE.md'), 'utf8');
    expect(techScope).toContain('apps/tech/**');
    expect(techScope).toContain('Módulo: tech');

    // Check team ownership table
    const ownership = fs.readFileSync(path.join(planningDir, 'team', 'OWNERSHIP.md'), 'utf8');
    expect(ownership).toContain('`tech`');
    expect(ownership).toContain('apps/tech/**');
  });

  it('Observer integrates detected modules into observed state', () => {
    fs.mkdirSync(path.join(tempDir, 'apps', 'tech'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'packages', 'ui'), { recursive: true });

    const observer = new Observer(tempDir);
    const observed = observer.observe('RUN-TEST-001');

    expect(observed.project.is_multi_module).toBe(true);
    expect(observed.project.modules).toContain('tech');
    expect(observed.project.modules).toContain('ui');
  });

  it('Scaffolder automatically creates modular .planning during scaffold()', () => {
    fs.mkdirSync(path.join(tempDir, 'apps', 'web'), { recursive: true });

    const scaffolder = new Scaffolder();
    const result = scaffolder.scaffold(tempDir);

    expect(fs.existsSync(path.join(tempDir, '.planning', 'SCOPE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.planning', 'modules', 'web', 'SCOPE.md'))).toBe(true);
    expect(fs.existsSync(path.join(tempDir, '.planning', 'team', 'OWNERSHIP.md'))).toBe(true);
    expect(result.createdFiles).toContain('.planning/SCOPE.md');
  });
});
