import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { PlanningIngestor } from '../src/core/planning-ingestor.js';
import { Scaffolder } from '../src/core/scaffolder.js';

describe('PlanningIngestor (Adopting GSD and Legacy Planning)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-ingest-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('ingests executed and pending items from ROADMAP.md and STATE.md', () => {
    const planningDir = path.join(tempDir, '.planning');
    fs.mkdirSync(planningDir, { recursive: true });

    // 1. Existing STATE.md
    const stateContent = `# Project State
Milestone: M02
Fase: P05 - Refatoração Tech
Status: em andamento
`;
    fs.writeFileSync(path.join(planningDir, 'STATE.md'), stateContent, 'utf8');

    // 2. Existing ROADMAP.md
    const roadmapContent = `# Project Roadmap

## Fase 1: Fundação
- [x] Configuração inicial do banco de dados (db)
- [x] Criação do módulo auth e login

## Fase 2: Módulos de Negócio
- [x] Implementação do módulo tech organizations
- [ ] Integração com job-engine
- [ ] Adicionar push notifications
`;
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), roadmapContent, 'utf8');

    // 3. Existing modules
    fs.mkdirSync(path.join(tempDir, 'apps', 'tech'), { recursive: true });
    fs.mkdirSync(path.join(tempDir, 'packages', 'db'), { recursive: true });

    const ingestor = new PlanningIngestor(tempDir);
    const ingested = ingestor.ingest();

    expect(ingested.currentMilestone).toBe('M02');
    expect(ingested.currentPhase).toBe('P05 - Refatoração Tech');

    expect(ingested.executedPhases).toHaveLength(3);
    expect(ingested.executedPhases[0].name).toContain('Configuração inicial');
    expect(ingested.executedPhases[1].name).toContain('Criação do módulo auth');
    expect(ingested.executedPhases[2].name).toContain('Implementação do módulo tech');

    expect(ingested.pendingPhases).toHaveLength(2);
    expect(ingested.pendingPhases[0].name).toContain('Integração com job-engine');
    expect(ingested.pendingPhases[1].name).toContain('Adicionar push notifications');
  });

  it('migrates legacy .planning/modulos/ to .planning/modules/ and syncs roadmaps', () => {
    const planningDir = path.join(tempDir, '.planning');
    const legacyModulos = path.join(planningDir, 'modulos', 'auth');
    fs.mkdirSync(legacyModulos, { recursive: true });
    fs.writeFileSync(path.join(legacyModulos, 'DOC.md'), '# Documentação legada de Auth', 'utf8');

    // Scaffold initial structure
    new Scaffolder().scaffold(tempDir, { autoObserve: false });

    // Setup ROADMAP with auth tasks
    const roadmapContent = `# Roadmap
- [x] Setup auth-core tokens
- [ ] Implementar auth 2FA
`;
    fs.writeFileSync(path.join(planningDir, 'ROADMAP.md'), roadmapContent, 'utf8');

    const ingestor = new PlanningIngestor(tempDir);
    const ingested = ingestor.ingest();
    const result = ingestor.applyPlanningState(ingested);

    // Verify migration from modulos to modules
    expect(fs.existsSync(path.join(planningDir, 'modules', 'auth', 'DOC.md'))).toBe(true);

    // Verify auth module roadmap has real executed vs pending items
    const authRoadmap = fs.readFileSync(path.join(planningDir, 'modules', 'auth', 'ROADMAP.md'), 'utf8');
    expect(authRoadmap).toContain('Fases Executadas');
    expect(authRoadmap).toContain('- [x] Setup auth-core tokens');
    expect(authRoadmap).toContain('Fases Pendentes');
    expect(authRoadmap).toContain('- [ ] Implementar auth 2FA');

    // Verify declared-state.json was updated with executed requirements
    const declaredStatePath = path.join(tempDir, '.agentic', 'state', 'declared-state.json');
    const declared = JSON.parse(fs.readFileSync(declaredStatePath, 'utf8'));
    expect(Object.keys(declared.requirements).length).toBeGreaterThan(0);
    const doneReq = Object.values(declared.requirements).find((r: any) => r.status === 'done');
    expect(doneReq).toBeDefined();
  });
});
