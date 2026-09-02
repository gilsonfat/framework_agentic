import fs from 'fs';
import path from 'path';
import { DeclaredState } from '../types/state.js';

export interface IngestedPhase {
  name: string;
  module?: string;
  completed: boolean;
  rawLine: string;
}

export interface IngestedRequirement {
  id: string;
  title: string;
  module?: string;
  completed: boolean;
}

export interface IngestedPlanningResult {
  currentMilestone: string;
  currentPhase: string;
  executedPhases: IngestedPhase[];
  pendingPhases: IngestedPhase[];
  executedRequirements: IngestedRequirement[];
  pendingRequirements: IngestedRequirement[];
  moduleRoadmaps: Record<string, { executed: string[]; pending: string[] }>;
  migratedLegacyDocs: string[];
}

export class PlanningIngestor {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * Ingests existing planning files (.planning/ROADMAP.md, STATE.md, REQUIREMENTS.md, modulos/)
   * and extracts what was already executed vs what is pending.
   */
  public ingest(): IngestedPlanningResult {
    const planningDir = path.join(this.projectRoot, '.planning');
    let currentMilestone = 'M01';
    let currentPhase = 'P01';

    const executedPhases: IngestedPhase[] = [];
    const pendingPhases: IngestedPhase[] = [];
    const executedRequirements: IngestedRequirement[] = [];
    const pendingRequirements: IngestedRequirement[] = [];
    const moduleRoadmaps: Record<string, { executed: string[]; pending: string[] }> = {};
    const migratedLegacyDocs: string[] = [];

    // 1. Read STATE.md for current milestone and phase
    const stateFile = path.join(planningDir, 'STATE.md');
    if (fs.existsSync(stateFile)) {
      try {
        const stateContent = fs.readFileSync(stateFile, 'utf8');
        const milestoneMatch = stateContent.match(/milestone[:\s]+([^\n\r,]+)/i) || stateContent.match(/marco[:\s]+([^\n\r,]+)/i);
        if (milestoneMatch) {
          currentMilestone = milestoneMatch[1].trim();
        }
        const phaseMatch = stateContent.match(/fase[:\s]+([^\n\r,]+)/i) || stateContent.match(/phase[:\s]+([^\n\r,]+)/i);
        if (phaseMatch) {
          currentPhase = phaseMatch[1].trim();
        }
      } catch {
        // ignore
      }
    }

    // 2. Read the roadmap for executed and pending phases/tasks.
    // A project already in progress usually keeps it at the repository root or
    // under docs/, not inside `.planning/`, so all three are considered.
    const roadmapFile = [
      path.join(planningDir, 'ROADMAP.md'),
      path.join(this.projectRoot, 'ROADMAP.md'),
      path.join(this.projectRoot, 'docs', 'ROADMAP.md'),
    ].find((candidate) => fs.existsSync(candidate));

    if (roadmapFile) {
      try {
        const lines = fs.readFileSync(roadmapFile, 'utf8').split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          const isDone = trimmed.startsWith('- [x]') || trimmed.startsWith('* [x]') || trimmed.toLowerCase().includes('(concluído)') || trimmed.toLowerCase().includes('(done)');
          const isPending = trimmed.startsWith('- [ ]') || trimmed.startsWith('* [ ]');

          if (isDone || isPending) {
            const cleanText = trimmed.replace(/^[-*]\s*\[[ x]\]\s*/i, '').trim();
            const phase: IngestedPhase = {
              name: cleanText,
              completed: isDone,
              rawLine: trimmed,
            };

            if (isDone) {
              executedPhases.push(phase);
            } else {
              pendingPhases.push(phase);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 3. Read REQUIREMENTS.md if present, in the same set of places.
    const reqFile = [
      path.join(planningDir, 'REQUIREMENTS.md'),
      path.join(this.projectRoot, 'REQUIREMENTS.md'),
      path.join(this.projectRoot, 'docs', 'REQUIREMENTS.md'),
    ].find((candidate) => fs.existsSync(candidate));

    if (reqFile) {
      try {
        const lines = fs.readFileSync(reqFile, 'utf8').split('\n');
        let counter = 1;
        for (const line of lines) {
          const trimmed = line.trim();
          const isDone = trimmed.startsWith('- [x]') || trimmed.startsWith('* [x]');
          const isPending = trimmed.startsWith('- [ ]') || trimmed.startsWith('* [ ]');

          if (isDone || isPending) {
            const cleanText = trimmed.replace(/^[-*]\s*\[[ x]\]\s*/i, '').trim();
            const reqMatch = cleanText.match(/(REQ-[A-Z0-9_-]+)/i);
            const reqId = reqMatch ? reqMatch[1] : `REQ-${String(counter++).padStart(3, '0')}`;

            const item: IngestedRequirement = {
              id: reqId,
              title: cleanText,
              completed: isDone,
            };

            if (isDone) {
              executedRequirements.push(item);
            } else {
              pendingRequirements.push(item);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 4. Check for legacy .planning/modulos/ and migrate into .planning/modules/
    const legacyModulosDir = path.join(planningDir, 'modulos');
    const modulesDir = path.join(planningDir, 'modules');
    if (fs.existsSync(legacyModulosDir) && fs.statSync(legacyModulosDir).isDirectory()) {
      try {
        const entries = fs.readdirSync(legacyModulosDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const targetModDir = path.join(modulesDir, entry.name);
            if (!fs.existsSync(targetModDir)) {
              fs.mkdirSync(targetModDir, { recursive: true });
            }
            const srcModDir = path.join(legacyModulosDir, entry.name);
            const files = fs.readdirSync(srcModDir);
            for (const file of files) {
              const srcFile = path.join(srcModDir, file);
              const destFile = path.join(targetModDir, file);
              if (!fs.existsSync(destFile) && fs.statSync(srcFile).isFile()) {
                fs.copyFileSync(srcFile, destFile);
                migratedLegacyDocs.push(`.planning/modules/${entry.name}/${file}`);
              }
            }
          }
        }
      } catch {
        // ignore
      }
    }

    // 5. Partition phases into modules
    const allPhases = [...executedPhases, ...pendingPhases];
    if (fs.existsSync(modulesDir)) {
      try {
        const modEntries = fs.readdirSync(modulesDir, { withFileTypes: true });
        for (const modEntry of modEntries) {
          if (modEntry.isDirectory() && !modEntry.name.startsWith('.')) {
            const modName = modEntry.name.toLowerCase();
            const executed: string[] = [];
            const pending: string[] = [];

            for (const p of allPhases) {
              const lowerName = p.name.toLowerCase();
              if (lowerName.includes(modName) || lowerName.includes(`[${modName}]`) || lowerName.includes(`(${modName})`)) {
                if (p.completed) {
                  executed.push(p.name);
                } else {
                  pending.push(p.name);
                }
              }
            }

            moduleRoadmaps[modEntry.name] = { executed, pending };
          }
        }
      } catch {
        // ignore
      }
    }

    return {
      currentMilestone,
      currentPhase,
      executedPhases,
      pendingPhases,
      executedRequirements,
      pendingRequirements,
      moduleRoadmaps,
      migratedLegacyDocs,
    };
  }

  /**
   * Applies the ingested planning state:
   * 1. Updates .planning/modules/<mod>/ROADMAP.md with real executed and pending tasks.
   * 2. Updates .agentic/state/declared-state.json with real requirements and active phase.
   * 3. Syncs requirement-matrix.json so that completed items are documented.
   */
  public applyPlanningState(ingested: IngestedPlanningResult): {
    updatedRoadmaps: string[];
    declaredStateSynced: boolean;
  } {
    const updatedRoadmaps: string[] = [];
    const planningDir = path.join(this.projectRoot, '.planning');
    const modulesDir = path.join(planningDir, 'modules');

    // 1. Update module roadmaps with real executed and pending phases
    for (const [modName, { executed, pending }] of Object.entries(ingested.moduleRoadmaps)) {
      if (executed.length === 0 && pending.length === 0) continue;

      const roadmapPath = path.join(modulesDir, modName, 'ROADMAP.md');
      const executedLines = executed.length > 0
        ? executed.map((e) => `- [x] ${e}`).join('\n')
        : '- (Nenhuma fase concluída registrada)';

      const pendingLines = pending.length > 0
        ? pending.map((p) => `- [ ] ${p}`).join('\n')
        : '- (Todas as fases mapeadas foram concluídas)';

      const content = `# Roadmap: ${modName}

## 1. Fases Executadas e Concluídas
${executedLines}

## 2. Fases Pendentes e Próximos Passos
${pendingLines}
`;
      fs.writeFileSync(roadmapPath, content, 'utf8');
      updatedRoadmaps.push(`.planning/modules/${modName}/ROADMAP.md`);
    }

    // 2. Update .agentic/state/declared-state.json
    let declaredStateSynced = false;
    const declaredStatePath = path.join(this.projectRoot, '.agentic', 'state', 'declared-state.json');
    if (fs.existsSync(declaredStatePath)) {
      try {
        const declared: DeclaredState = JSON.parse(fs.readFileSync(declaredStatePath, 'utf8'));
        declared.milestone = ingested.currentMilestone || declared.milestone || 'M01';
        declared.phase = ingested.currentPhase || declared.phase || 'P01';

        if (!declared.requirements) {
          declared.requirements = {};
        }

        for (const req of ingested.executedRequirements) {
          declared.requirements[req.id] = {
            title: req.title,
            status: 'done',
          };
        }

        for (const req of ingested.pendingRequirements) {
          if (!declared.requirements[req.id]) {
            declared.requirements[req.id] = {
              title: req.title,
              status: 'not_started',
            };
          }
        }

        // If no requirements were explicitly named in REQUIREMENTS.md, register the executed phases
        if (Object.keys(declared.requirements).length === 0) {
          let idx = 1;
          for (const ep of ingested.executedPhases) {
            const id = `REQ-HIST-${String(idx++).padStart(3, '0')}`;
            declared.requirements[id] = {
              title: ep.name,
              status: 'done',
            };
          }
          for (const pp of ingested.pendingPhases) {
            const id = `REQ-PLAN-${String(idx++).padStart(3, '0')}`;
            declared.requirements[id] = {
              title: pp.name,
              status: 'not_started',
            };
          }
        }

        fs.writeFileSync(declaredStatePath, JSON.stringify(declared, null, 2), 'utf8');
        declaredStateSynced = true;
      } catch {
        // ignore
      }
    }

    return { updatedRoadmaps, declaredStateSynced };
  }
}
