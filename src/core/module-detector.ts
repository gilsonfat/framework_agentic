import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

export interface DetectedModule {
  name: string;
  relativePath: string;
  absolutePath: string;
  type: 'app' | 'package' | 'module' | 'service';
  hasPlanning: boolean;
  planningScopePath?: string;
  planningRoadmapPath?: string;
}

export interface ProjectStructureInfo {
  isMultiModule: boolean;
  modules: DetectedModule[];
  hasRootPlanning: boolean;
  rootPlanningPath: string;
  rootScopePath: string;
}

export class ModuleDetector {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * Discovers all modules/apps/packages in the project.
   */
  public detect(): ProjectStructureInfo {
    const modules: DetectedModule[] = [];
    const planningDir = path.join(this.projectRoot, '.planning');
    const rootScopePath = path.join(planningDir, 'SCOPE.md');

    // 1. Check directories: apps, packages, modules, src/modules, services
    const searchRoots: Array<{ dir: string; type: DetectedModule['type'] }> = [
      { dir: 'apps', type: 'app' },
      { dir: 'packages', type: 'package' },
      { dir: 'modules', type: 'module' },
      { dir: path.join('src', 'modules'), type: 'module' },
      { dir: 'services', type: 'service' },
    ];

    for (const { dir, type } of searchRoots) {
      const fullDir = path.join(this.projectRoot, dir);
      if (fs.existsSync(fullDir) && fs.statSync(fullDir).isDirectory()) {
        try {
          const entries = fs.readdirSync(fullDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
              const relPath = path.join(dir, entry.name).replace(/\\/g, '/');
              const absPath = path.join(fullDir, entry.name);
              const modulePlanningDir = path.join(planningDir, 'modules', entry.name);
              const hasPlanning = fs.existsSync(modulePlanningDir);

              modules.push({
                name: entry.name,
                relativePath: relPath,
                absolutePath: absPath,
                type,
                hasPlanning,
                planningScopePath: path.join(modulePlanningDir, 'SCOPE.md'),
                planningRoadmapPath: path.join(modulePlanningDir, 'ROADMAP.md'),
              });
            }
          }
        } catch {
          // ignore read error
        }
      }
    }

    // 2. Check if .planning/modules has folders not in apps/packages
    const planningModulesDir = path.join(planningDir, 'modules');
    if (fs.existsSync(planningModulesDir)) {
      try {
        const entries = fs.readdirSync(planningModulesDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const alreadyFound = modules.some(m => m.name === entry.name);
            if (!alreadyFound) {
              const modulePlanningDir = path.join(planningModulesDir, entry.name);
              modules.push({
                name: entry.name,
                relativePath: entry.name,
                absolutePath: path.join(this.projectRoot, entry.name),
                type: 'module',
                hasPlanning: true,
                planningScopePath: path.join(modulePlanningDir, 'SCOPE.md'),
                planningRoadmapPath: path.join(modulePlanningDir, 'ROADMAP.md'),
              });
            }
          }
        }
      } catch {
        // ignore read error
      }
    }

    return {
      isMultiModule: modules.length > 0,
      modules,
      hasRootPlanning: fs.existsSync(planningDir),
      rootPlanningPath: planningDir,
      rootScopePath,
    };
  }

  /**
   * Scaffolds or updates the .planning structure with modular separation.
   * NEVER overwrites existing user content.
   */
  public scaffoldModularPlanning(): { created: string[]; preserved: string[] } {
    const created: string[] = [];
    const preserved: string[] = [];
    const info = this.detect();

    const planningDir = path.join(this.projectRoot, '.planning');
    if (!fs.existsSync(planningDir)) {
      fs.mkdirSync(planningDir, { recursive: true });
      created.push('.planning/');
    }

    // 1. Root SCOPE.md
    const rootScope = path.join(planningDir, 'SCOPE.md');
    if (!fs.existsSync(rootScope)) {
      const modulesList = info.modules.length > 0
        ? info.modules.map(m => `- **\`${m.name}\`** (\`${m.relativePath}\`): Módulo ${m.type}`).join('\n')
        : '- (Monólito / raiz da aplicação)';

      const content = `# Application Scope Contract

## 1. Visão Geral e Propósito
Definição do escopo macro da aplicação, fronteiras de domínio e acordos inegociáveis.

## 2. Escopo Geral (In-Scope)
- Funcionalidades centrais da aplicação.
- Contratos e integrações documentados.
- Testes automatizados cobrindo cada critério de aceitação.

## 3. Fora de Escopo (Out-of-Scope)
- Funcionalidades não documentadas em especificações aprovadas.
- Quebras de contrato entre módulos sem versionamento ou migração.

## 4. Invariantes de Engenharia & Segurança
1. **Verificação Real**: Nenhum requisito é concluído sem evidência de testes executados (\`agentic verify\`).
2. **Isolamento de Escrita**: Cada tarefa deve respeitar os caminhos de escrita atribuídos no prompt pack.
3. **Documentação como Reflexo da Realidade**: As-built gerado a partir do diff real do Git.

## 5. Módulos do Sistema
${modulesList}
`;
      fs.writeFileSync(rootScope, content, 'utf8');
      created.push('.planning/SCOPE.md');
    } else {
      preserved.push('.planning/SCOPE.md');
    }

    // 2. Modules folders: .planning/modules/<module-name>/
    const modulesDir = path.join(planningDir, 'modules');
    if (!fs.existsSync(modulesDir)) {
      fs.mkdirSync(modulesDir, { recursive: true });
      created.push('.planning/modules/');
    }

    for (const mod of info.modules) {
      const modPlanningDir = path.join(modulesDir, mod.name);
      if (!fs.existsSync(modPlanningDir)) {
        fs.mkdirSync(modPlanningDir, { recursive: true });
        created.push(`.planning/modules/${mod.name}/`);
      }

      const modScope = path.join(modPlanningDir, 'SCOPE.md');
      if (!fs.existsSync(modScope)) {
        const modScopeContent = `# Módulo: ${mod.name}

## 1. Identificação
- **Caminho Raiz**: \`${mod.relativePath}\`
- **Tipo**: \`${mod.type}\`

## 2. Responsabilidade do Módulo
- Escopo específico e funcionalidades sob responsabilidade de \`${mod.name}\`.

## 3. Limites de Escrita (Write Boundaries)
- **Permitido (WRITE)**: \`${mod.relativePath}/**\`
- **Somente Leitura (READ-ONLY)**: Contratos públicos de outros módulos
- **Proibido (FORBIDDEN)**: Modificar código de outros módulos sem aprovação

## 4. Requisitos e Critérios de Aceitação
- Requisitos em desenvolvimento são rastreados via \`agentic prompt\` com tag \`--domain ${mod.name}\`.
`;
        fs.writeFileSync(modScope, modScopeContent, 'utf8');
        created.push(`.planning/modules/${mod.name}/SCOPE.md`);
      } else {
        preserved.push(`.planning/modules/${mod.name}/SCOPE.md`);
      }

      const modRoadmap = path.join(modPlanningDir, 'ROADMAP.md');
      if (!fs.existsSync(modRoadmap)) {
        const modRoadmapContent = `# Roadmap: ${mod.name}

## Marcos & Fases Ativas
- [ ] Fase 1: Fundação e contratos de interface
- [ ] Fase 2: Implementação com TDD estrito
- [ ] Fase 3: Integração e verificação de regressão
`;
        fs.writeFileSync(modRoadmap, modRoadmapContent, 'utf8');
        created.push(`.planning/modules/${mod.name}/ROADMAP.md`);
      } else {
        preserved.push(`.planning/modules/${mod.name}/ROADMAP.md`);
      }

      const modChangelog = path.join(modPlanningDir, 'CHANGELOG.md');
      if (!fs.existsSync(modChangelog)) {
        const modChangelogContent = `# Changelog: ${mod.name}

Histórico detalhado de alterações, tarefas implementadas e entregas verificadas neste módulo.

## Histórico de Entregas
`;
        fs.writeFileSync(modChangelog, modChangelogContent, 'utf8');
        created.push(`.planning/modules/${mod.name}/CHANGELOG.md`);
      } else {
        preserved.push(`.planning/modules/${mod.name}/CHANGELOG.md`);
      }
    }

    // 3. Team governance: .planning/team/OWNERSHIP.md
    const teamDir = path.join(planningDir, 'team');
    if (!fs.existsSync(teamDir)) {
      fs.mkdirSync(teamDir, { recursive: true });
      created.push('.planning/team/');
    }

    const ownershipFile = path.join(teamDir, 'OWNERSHIP.md');
    if (!fs.existsSync(ownershipFile)) {
      const ownershipTable = info.modules.length > 0
        ? info.modules.map(m => `| \`${m.name}\` | \`${m.relativePath}/**\` | Equipe / Agente responsável |`).join('\n')
        : '| `core` | `src/**` | Equipe principal |';

      const content = `# Team Ownership & Boundaries

Este arquivo governa quais equipes e agentes possuem autoridade de escrita em cada módulo,
prevenindo conflitos e sobreposição de código.

## Mapeamento de Módulos

| Módulo | Caminho Permitido (WRITE) | Responsável |
| :--- | :--- | :--- |
${ownershipTable}

## Protocolo de Bloqueio (Claims)
Antes de iniciar uma fase ou tarefa sobre um módulo, registre o claim:
\`\`\`bash
agentic team claim <MODULE-NAME> --note "Implementando funcionalidade X"
\`\`\`
`;
      fs.writeFileSync(ownershipFile, content, 'utf8');
      created.push('.planning/team/OWNERSHIP.md');
    } else {
      preserved.push('.planning/team/OWNERSHIP.md');
    }

    return { created, preserved };
  }

  /**
   * Records changes (files touched, actor, commit/ref, message) into
   * the respective .planning/modules/<mod>/CHANGELOG.md file.
   */
  public recordModuleChanges(options: RecordChangeOptions = {}): RecordChangeResult {
    const info = this.detect();
    let files = options.files ? [...options.files] : [];

    // If no files were explicitly supplied, inspect git status
    if (files.length === 0) {
      try {
        const statusOutput = execSync('git status --porcelain', {
          cwd: this.projectRoot,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        const lines = statusOutput.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const parts = trimmed.split(/\s+/);
          if (parts.length >= 2) {
            const filePath = parts[parts.length - 1];
            if (
              filePath &&
              !filePath.startsWith('.agentic/') &&
              !filePath.startsWith('.planning/') &&
              !filePath.startsWith('.claude/') &&
              !filePath.startsWith('.gemini/') &&
              !filePath.startsWith('.cursor/')
            ) {
              files.push(filePath.replace(/\\/g, '/'));
            }
          }
        }
      } catch {
        // git unavailable or not a repo
      }

      // If still empty, check last commit
      if (files.length === 0) {
        try {
          const diffOutput = execSync('git diff-tree --no-commit-id --name-only -r HEAD', {
            cwd: this.projectRoot,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'ignore'],
          });
          files = diffOutput
            .split('\n')
            .map((f) => f.trim())
            .filter(
              (f) =>
                f.length > 0 &&
                !f.startsWith('.agentic/') &&
                !f.startsWith('.planning/') &&
                !f.startsWith('.claude/') &&
                !f.startsWith('.gemini/') &&
                !f.startsWith('.cursor/')
            );
        } catch {
          // ignore
        }
      }
    }

    // Resolve author and commit
    let actor = options.actor;
    if (!actor) {
      try {
        const name = execSync('git config user.name', { cwd: this.projectRoot, encoding: 'utf8' }).trim();
        const email = execSync('git config user.email', { cwd: this.projectRoot, encoding: 'utf8' }).trim();
        if (name && email) actor = `${name} <${email}>`;
        else if (email) actor = email;
        else if (name) actor = name;
      } catch {}
    }
    if (!actor) {
      actor = process.env.USER || process.env.USERNAME || 'unknown-actor';
    }

    let commit = options.commit;
    if (!commit) {
      try {
        commit = execSync('git rev-parse --short HEAD', { cwd: this.projectRoot, encoding: 'utf8' }).trim();
      } catch {
        commit = 'working-tree';
      }
    }

    // Map files to modules
    const moduleMap = new Map<string, string[]>();
    for (const file of files) {
      const normalizedFile = file.replace(/\\/g, '/');
      let matchedModule: string | undefined;

      if (options.module) {
        matchedModule = options.module;
      } else {
        for (const mod of info.modules) {
          const modRel = mod.relativePath.replace(/\\/g, '/');
          if (
            normalizedFile.startsWith(`${modRel}/`) ||
            normalizedFile === modRel ||
            normalizedFile.startsWith(`apps/${mod.name}/`) ||
            normalizedFile.startsWith(`packages/${mod.name}/`) ||
            normalizedFile.startsWith(`modules/${mod.name}/`) ||
            normalizedFile.startsWith(`src/modules/${mod.name}/`) ||
            normalizedFile.includes(`/${mod.name}/`)
          ) {
            matchedModule = mod.name;
            break;
          }
        }
      }

      const targetMod = matchedModule || 'geral';
      if (!moduleMap.has(targetMod)) {
        moduleMap.set(targetMod, []);
      }
      moduleMap.get(targetMod)!.push(normalizedFile);
    }

    const updatedModules: RecordChangeResult['updatedModules'] = [];
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);
    const message = options.message || 'Atualização e alterações de código no módulo';

    for (const [modName, modFiles] of moduleMap.entries()) {
      if (modFiles.length === 0) continue;

      let changelogPath: string;
      if (modName === 'geral') {
        const planningDir = path.join(this.projectRoot, '.planning');
        if (!fs.existsSync(planningDir)) fs.mkdirSync(planningDir, { recursive: true });
        changelogPath = path.join(planningDir, 'CHANGELOG.md');
      } else {
        const modPlanningDir = path.join(this.projectRoot, '.planning', 'modules', modName);
        if (!fs.existsSync(modPlanningDir)) fs.mkdirSync(modPlanningDir, { recursive: true });
        changelogPath = path.join(modPlanningDir, 'CHANGELOG.md');
      }

      if (!fs.existsSync(changelogPath)) {
        const header = `# Changelog: ${modName}\n\nHistórico detalhado de alterações, tarefas implementadas e entregas verificadas neste módulo.\n\n## Histórico de Entregas\n`;
        fs.writeFileSync(changelogPath, header, 'utf8');
      }

      const fileItems = modFiles.map((f) => `  - \`${f}\``).join('\n');
      const entry = `\n### [${timestamp}] ${message}
- **Autor / Usuário**: ${actor}
- **Commit / Ref**: \`${commit}\`
- **Status**: ${options.status || 'Modificação Registrada'}
${options.taskId ? `- **Tarefa / Task**: \`${options.taskId}\`\n` : ''}${options.phase ? `- **Fase**: \`${options.phase}\`\n` : ''}- **Arquivos Alterados no Módulo (${modFiles.length})**:
${fileItems}
`;

      fs.appendFileSync(changelogPath, entry, 'utf8');
      updatedModules.push({
        module: modName,
        changelogPath,
        filesCount: modFiles.length,
        files: modFiles,
      });
    }

    return {
      updatedModules,
      totalFiles: files.length,
      actor,
      commit,
    };
  }
}

export interface RecordChangeOptions {
  message?: string;
  commit?: string;
  files?: string[];
  actor?: string;
  taskId?: string;
  phase?: string;
  status?: string;
  module?: string;
}

export interface RecordChangeResult {
  updatedModules: Array<{
    module: string;
    changelogPath: string;
    filesCount: number;
    files: string[];
  }>;
  totalFiles: number;
  actor: string;
  commit: string;
}
