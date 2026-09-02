import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import {
  AgentProductDefinition,
  AgentProductId,
  IntegrationResult,
  IntegrationStatus,
  WrittenFile,
} from '../types/integrations.js';
import { RulesTemplateOptions, renderAgentSkill, renderSlashCommands } from './rules-templates.js';
import {
  entryPointFor,
  renderAntigravityWorkflows,
  renderChatGptBootstrap,
  renderClaudeSettings,
  renderCompactProtocol,
  renderGeminiCommands,
  renderProductRules,
} from './product-templates.js';

export interface InstallIntegrationsOptions extends RulesTemplateOptions {
  /** Which products to wire. Defaults to every supported product. */
  products?: AgentProductId[];
  /** Overwrite files the user may have edited. */
  force?: boolean;
  /** Add the Claude Code SessionStart hook. */
  hooks?: boolean;
  /** Pre-approve `agentic` commands in .claude/settings.json. */
  permissions?: boolean;
}

/** Delimiters of the block this framework owns inside a file it does not own. */
const PROTOCOL_BEGIN = '<!-- BEGIN AGENTIC SDLC PROTOCOL -->';
const PROTOCOL_END = '<!-- END AGENTIC SDLC PROTOCOL -->';

/**
 * Instruction files a project may already have. When one of these exists and was
 * written by someone else, the protocol is appended inside markers instead of
 * overwriting their rules - and instead of being silently skipped, which left
 * Codex and Antigravity ungoverned while the CLI reported them as wired.
 */
const SHARED_INSTRUCTION_FILES = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  'CODEX.md',
  '.github/copilot-instructions.md',
  '.windsurfrules',
]);

/** Files that must carry the protocol for a product to count as wired. */
const PROTOCOL_BEARING_FILES: Partial<Record<AgentProductId, string[]>> = {
  claude: ['CLAUDE.md'],
  antigravity: ['AGENTS.md'],
  gemini: ['GEMINI.md'],
  codex: ['AGENTS.md', 'CODEX.md'],
  chatgpt: ['.agentic/agents/CHATGPT.md'],
  cursor: ['.cursor/rules/agentic.mdc'],
  copilot: ['.github/copilot-instructions.md'],
  windsurf: ['.windsurfrules'],
};

export const AGENT_PRODUCTS: AgentProductDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    entryPoint: entryPointFor('claude'),
    files: ['CLAUDE.md', '.claude/commands/*.md', '.claude/skills/agentic/SKILL.md', '.claude/settings.json'],
    detect: ['.claude', '.claude.json', 'AppData/Roaming/Claude'],
  },
  {
    id: 'antigravity',
    label: 'Google Antigravity',
    entryPoint: entryPointFor('antigravity'),
    files: ['AGENTS.md', '.agents/skills/agentic/SKILL.md', '.agents/workflows/*.md'],
    detect: ['.agents', '.antigravity', '.gemini/antigravity'],
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    entryPoint: entryPointFor('gemini'),
    files: ['GEMINI.md', '.gemini/commands/*.toml'],
    detect: ['.gemini'],
  },
  {
    id: 'codex',
    label: 'OpenAI Codex',
    entryPoint: entryPointFor('codex'),
    files: ['AGENTS.md', 'CODEX.md'],
    detect: ['.codex'],
  },
  {
    id: 'chatgpt',
    label: 'ChatGPT (no repo access)',
    entryPoint: entryPointFor('chatgpt'),
    files: ['.agentic/agents/CHATGPT.md'],
  },
  {
    id: 'cursor',
    label: 'Cursor',
    entryPoint: entryPointFor('cursor'),
    files: ['.cursor/rules/agentic.mdc'],
    detect: ['.cursor'],
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    entryPoint: entryPointFor('copilot'),
    files: ['.github/copilot-instructions.md'],
    detect: ['.github'],
  },
  {
    id: 'windsurf',
    label: 'Windsurf',
    entryPoint: entryPointFor('windsurf'),
    files: ['.windsurfrules'],
    detect: ['.windsurf'],
  },
];

export const ALL_PRODUCT_IDS: AgentProductId[] = AGENT_PRODUCTS.map((p) => p.id);

/**
 * Writes the workflow instructions into whatever each AI product actually reads,
 * so the same protocol applies whichever tool a teammate opens the repository with.
 *
 * Two files are shared by more than one product (`AGENTS.md` for Antigravity and
 * Codex, `.agents/skills/` for Antigravity), so writes are deduplicated and
 * reported per product rather than per file.
 */
export class AgentIntegrations {
  private projectRoot: string;
  private written = new Set<string>();
  private processEngine = 'superpowers';

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public install(options: InstallIntegrationsOptions): IntegrationResult[] {
    this.written.clear();
    this.processEngine = options.processEngine;
    const products = options.products && options.products.length > 0 ? options.products : ALL_PRODUCT_IDS;
    const results: IntegrationResult[] = [];

    for (const id of products) {
      const definition = AGENT_PRODUCTS.find((p) => p.id === id);
      if (!definition) continue;

      results.push({
        product: id,
        label: definition.label,
        entryPoint: definition.entryPoint,
        detected: this.detect(definition),
        files: this.installProduct(id, options),
      });
    }

    return results;
  }

  /** Advisory check: does this product look like it is used here or by this user? */
  public detect(definition: AgentProductDefinition): boolean {
    for (const hint of definition.detect || []) {
      if (fs.existsSync(path.join(this.projectRoot, hint))) return true;
      if (fs.existsSync(path.join(os.homedir(), hint))) return true;
    }

    const binaries: Partial<Record<AgentProductId, string>> = {
      claude: 'claude',
      gemini: 'gemini',
      codex: 'codex',
      cursor: 'cursor',
      windsurf: 'windsurf',
    };
    const binary = binaries[definition.id];
    if (!binary) return false;

    try {
      execSync(process.platform === 'win32' ? `where ${binary}` : `which ${binary}`, {
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Which product integrations are really in place.
   *
   * A file existing is not enough: the file the product reads has to *carry the
   * protocol*. Otherwise a project with its own `AGENTS.md` would be reported as
   * wired while Codex and Antigravity read nothing about the workflow.
   */
  public status(): IntegrationStatus[] {
    return AGENT_PRODUCTS.map((definition) => {
      const concrete = definition.files.filter((f) => !f.includes('*'));
      const globbed = definition.files.filter((f) => f.includes('*'));

      const filesExist =
        concrete.every((f) => fs.existsSync(path.join(this.projectRoot, f))) &&
        globbed.every((pattern) => {
          const dir = path.join(this.projectRoot, path.dirname(pattern));
          if (!fs.existsSync(dir)) return false;
          const extension = path.extname(pattern);
          try {
            return fs.readdirSync(dir).some((entry) => entry.endsWith(extension));
          } catch {
            return false;
          }
        });

      const withoutProtocol = (PROTOCOL_BEARING_FILES[definition.id] || []).filter((file) => {
        const full = path.join(this.projectRoot, file);
        return fs.existsSync(full) && !this.carriesProtocol(full);
      });

      const state: IntegrationStatus['state'] = !filesExist
        ? 'missing'
        : withoutProtocol.length > 0
        ? 'partial'
        : 'installed';

      return {
        definition,
        state,
        installed: state === 'installed',
        detected: this.detect(definition),
        withoutProtocol,
      };
    });
  }

  /** True when the file carries this framework's protocol. */
  private carriesProtocol(fullPath: string): boolean {
    try {
      const content = fs.readFileSync(fullPath, 'utf8');
      return content.includes(PROTOCOL_BEGIN) || /AGENTIC SDLC/i.test(content);
    } catch {
      return false;
    }
  }

  private installProduct(id: AgentProductId, options: InstallIntegrationsOptions): WrittenFile[] {
    const files: WrittenFile[] = [];
    const rules: RulesTemplateOptions = { processEngine: options.processEngine };

    switch (id) {
      case 'claude': {
        files.push(this.write('CLAUDE.md', renderProductRules('claude', rules), id, options.force));
        for (const command of renderSlashCommands(rules)) {
          files.push(
            this.write(path.join('.claude', 'commands', command.file), command.content, id, options.force)
          );
        }
        files.push(
          this.write(
            path.join('.claude', 'skills', 'agentic', 'SKILL.md'),
            renderAgentSkill(rules),
            id,
            options.force
          )
        );
        if (options.permissions !== false) {
          files.push(this.mergeClaudeSettings(id, options.hooks !== false));
        }
        break;
      }

      case 'antigravity': {
        files.push(this.write('AGENTS.md', renderProductRules('antigravity', rules), id, options.force));
        files.push(
          this.write(
            path.join('.agents', 'skills', 'agentic', 'SKILL.md'),
            renderAgentSkill(rules),
            id,
            options.force
          )
        );
        for (const workflow of renderAntigravityWorkflows(rules)) {
          files.push(
            this.write(path.join('.agents', 'workflows', workflow.file), workflow.content, id, options.force)
          );
        }
        break;
      }

      case 'gemini': {
        files.push(this.write('GEMINI.md', renderProductRules('gemini', rules), id, options.force));
        for (const command of renderGeminiCommands(rules)) {
          files.push(
            this.write(path.join('.gemini', 'commands', command.file), command.content, id, options.force)
          );
        }
        break;
      }

      case 'codex': {
        // AGENTS.md is the shared standard; CODEX.md carries the Codex-specific framing.
        files.push(this.write('AGENTS.md', renderProductRules('antigravity', rules), id, options.force));
        files.push(this.write('CODEX.md', renderProductRules('codex', rules), id, options.force));
        break;
      }

      case 'chatgpt': {
        files.push(
          this.write(
            path.join('.agentic', 'agents', 'CHATGPT.md'),
            renderChatGptBootstrap(rules),
            id,
            options.force
          )
        );
        break;
      }

      case 'cursor': {
        const mdc = [
          '---',
          'description: Agentic SDLC - mandatory delivery workflow for this repository',
          'globs:',
          'alwaysApply: true',
          '---',
          '',
          renderCompactProtocol(rules),
        ].join('\n');
        files.push(this.write(path.join('.cursor', 'rules', 'agentic.mdc'), mdc, id, options.force));
        break;
      }

      case 'copilot': {
        files.push(
          this.write(
            path.join('.github', 'copilot-instructions.md'),
            renderCompactProtocol(rules),
            id,
            options.force
          )
        );
        break;
      }

      case 'windsurf': {
        files.push(this.write('.windsurfrules', renderCompactProtocol(rules), id, options.force));
        break;
      }
    }

    return files;
  }

  private write(relativePath: string, content: string, product: AgentProductId, force?: boolean): WrittenFile {
    const normalized = relativePath.split(path.sep).join('/');

    // Shared files (AGENTS.md, the agentic skill) are written once per run.
    if (this.written.has(normalized)) {
      return { path: normalized, action: 'preserved', product };
    }

    const full = path.join(this.projectRoot, relativePath);
    const existed = fs.existsSync(full);

    if (existed && !force && !this.isFrameworkOwned(full)) {
      // A file the user (or another tool) authored is never overwritten. When it
      // is one of the files an agent reads for its standing instructions, the
      // protocol is appended inside markers so their rules survive and the
      // product is actually governed.
      if (SHARED_INSTRUCTION_FILES.has(normalized)) {
        return this.appendProtocol(full, normalized, product);
      }
      return { path: normalized, action: 'preserved', product };
    }

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    this.written.add(normalized);

    return { path: normalized, action: existed ? 'updated' : 'created', product };
  }

  /**
   * Adds (or refreshes) the protocol block inside a file owned by the project.
   * The block is delimited, so re-running `agents sync` updates it in place and
   * never duplicates it.
   */
  private appendProtocol(fullPath: string, normalized: string, product: AgentProductId): WrittenFile {
    const existing = fs.readFileSync(fullPath, 'utf8');
    const block = [
      PROTOCOL_BEGIN,
      '',
      renderCompactProtocol({ processEngine: this.processEngine }),
      '',
      'Full protocol: `docs/ARCHITECTURE.md` and the `agentic` CLI (`agentic next` tells you the next step).',
      '',
      PROTOCOL_END,
    ].join('\n');

    const begin = existing.indexOf(PROTOCOL_BEGIN);
    const end = existing.indexOf(PROTOCOL_END);

    const updated =
      begin !== -1 && end !== -1
        ? `${existing.slice(0, begin)}${block}${existing.slice(end + PROTOCOL_END.length)}`
        : `${existing.trimEnd()}\n\n---\n\n${block}\n`;

    fs.writeFileSync(fullPath, updated, 'utf8');
    this.written.add(normalized);

    return { path: normalized, action: 'appended', product };
  }

  /**
   * True when the framework generated the *whole* file, so regenerating it is
   * safe.
   *
   * A file that merely carries the protocol block belongs to the project: it was
   * appended to, and rewriting it wholesale would delete the team's own rules.
   * That distinction is the difference between refreshing an integration and
   * destroying someone's instructions on the second `agents sync`.
   */
  private isFrameworkOwned(fullPath: string): boolean {
    try {
      const head = fs.readFileSync(fullPath, 'utf8').slice(0, 4000);
      if (head.includes(PROTOCOL_BEGIN)) return false;
      return /AGENTIC SDLC ORCHESTRATOR|Agentic SDLC - Mandatory Workflow|^# \/agentic|^name: agentic$/im.test(
        head
      );
    } catch {
      return false;
    }
  }

  /**
   * Merges into `.claude/settings.json` instead of overwriting it: the file
   * belongs to the user and may already carry unrelated permissions and hooks.
   */
  private mergeClaudeSettings(product: AgentProductId, includeHooks: boolean): WrittenFile {
    const relativePath = '.claude/settings.json';
    const full = path.join(this.projectRoot, '.claude', 'settings.json');
    const patch = renderClaudeSettings({ includeHooks });

    let current: Record<string, unknown> = {};
    let existed = false;
    if (fs.existsSync(full)) {
      existed = true;
      try {
        current = JSON.parse(fs.readFileSync(full, 'utf8')) as Record<string, unknown>;
      } catch {
        // Unparseable settings: leave the file alone rather than destroying it.
        return { path: relativePath, action: 'preserved', product };
      }
    }

    const permissions = (current.permissions as { allow?: string[] } | undefined) || {};
    const allow = new Set([...(permissions.allow || []), ...patch.permissions.allow]);
    current.permissions = { ...permissions, allow: Array.from(allow).sort() };

    if (patch.hooks) {
      const hooks = (current.hooks as Record<string, unknown[]> | undefined) || {};
      const sessionStart = hooks.SessionStart || [];
      const serialized = JSON.stringify(sessionStart);
      // Idempotent: only add our hook when an equivalent one is not already there.
      if (!serialized.includes('agentic status')) {
        hooks.SessionStart = [...sessionStart, ...(patch.hooks.SessionStart || [])];
      }
      current.hooks = hooks;
    }

    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, `${JSON.stringify(current, null, 2)}\n`, 'utf8');

    return { path: relativePath, action: existed ? 'merged' : 'created', product };
  }
}
