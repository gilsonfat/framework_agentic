import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  SkillPack,
  SkillPackStatus,
  SkillRecommendation,
  SkillStage,
  SkillsConfig,
} from '../types/skills.js';
import { ConfigLoader } from './config-loader.js';

/**
 * Resolves which external skill the implementing agent should use at each stage
 * of the cycle, and whether that skill is actually available on this machine.
 *
 * Two rules keep this honest:
 *  - a pack is only recommended as usable when it is *detected on disk*; an
 *    absent pack is reported with its install command instead of being assumed;
 *  - no stage ever depends on a pack. The framework's native path (Grill-Me probes,
 *    Spec Kit contract, evidence-gated verification) runs either
 *    way, so a teammate without the pack installed is degraded, never blocked.
 */
export interface SkillRegistryOptions {
  includeHome?: boolean;
}

export class SkillRegistry {
  private projectRoot: string;
  private config: SkillsConfig;
  private includeHome: boolean;
  private detectionCache = new Map<string, string | undefined>();

  constructor(
    projectRoot: string = process.cwd(),
    configLoader?: ConfigLoader,
    options: SkillRegistryOptions = {}
  ) {
    this.projectRoot = path.resolve(projectRoot);
    this.config = (configLoader || new ConfigLoader(this.projectRoot)).loadSkillsConfig();
    this.includeHome = options.includeHome !== false;
  }

  public listPacks(): SkillPackStatus[] {
    return Object.entries(this.config.packs).map(([id, pack]) => this.statusOf(id, pack));
  }

  public getPack(id: string): SkillPack | undefined {
    return this.config.packs[id];
  }

  public statusOf(id: string, pack?: SkillPack): SkillPackStatus {
    const definition = pack || this.config.packs[id];
    if (!definition) {
      throw new Error(`Skill pack '${id}' is not declared in .agentic/orchestrator/skills.yaml.`);
    }

    const detectedAt = this.detect(id, definition);

    return {
      id,
      name: definition.name,
      source: definition.source,
      enabled: definition.enabled !== false,
      installed: Boolean(detectedAt),
      detectedAt,
      installCommands: [definition.install?.claude, definition.install?.generic].filter(Boolean) as string[],
      postInstall: definition.install?.post_install,
      stagesCovered: Object.keys(definition.stages || {}) as SkillStage[],
    };
  }

  /**
   * Skills recommended for a stage, most specific first. Recommendations from
   * absent packs are still returned (flagged `installed: false`) so the operator
   * can see what the team standard expects and how to get it.
   */
  public forStage(stage: SkillStage, options: { domain?: string; onlyInstalled?: boolean } = {}): SkillRecommendation[] {
    const out: SkillRecommendation[] = [];

    for (const [id, pack] of Object.entries(this.config.packs)) {
      if (pack.enabled === false) continue;

      const installed = Boolean(this.detect(id, pack));
      if (options.onlyInstalled && !installed) continue;

      const stageSkills = pack.stages?.[stage] || [];
      const domainSkills = options.domain ? pack.domains?.[options.domain.toLowerCase()] || [] : [];

      for (const skill of [...stageSkills, ...domainSkills]) {
        if (out.some((r) => r.pack === id && r.skill === skill)) continue;
        out.push({
          pack: id,
          packName: pack.name,
          skill,
          invocation: (pack.invocation || '/{skill}').replace('{skill}', skill),
          installed,
          stage,
          note: pack.aliases?.[skill],
        });
      }
    }

    return out;
  }

  /**
   * Markdown block injected into a task prompt pack. Returns an empty string
   * when there is nothing to say, so the pack stays clean on projects with no
   * skill packs configured.
   */
  public renderPromptSection(stage: SkillStage, options: { domain?: string; heading?: string } = {}): string {
    const recommendations = this.forStage(stage, { domain: options.domain });
    if (recommendations.length === 0) return '';

    const installed = recommendations.filter((r) => r.installed);
    const missing = recommendations.filter((r) => !r.installed);
    const lines: string[] = [options.heading || '## Skills To Use'];

    if (installed.length > 0) {
      lines.push('', 'Installed and expected for this step:');
      for (const rec of installed) {
        lines.push(`- \`${rec.invocation}\` (${rec.packName})${rec.note ? ` - ${rec.note}` : ''}`);
      }
    }

    if (missing.length > 0) {
      lines.push(
        '',
        `Not installed on this machine (do not invoke; the native path applies): ${missing
          .map((r) => `\`${r.invocation}\``)
          .join(', ')}`
      );
    }

    return lines.join('\n');
  }

  /** Stages that no installed pack covers, for diagnostics. */
  public coverage(): { covered: SkillStage[]; uncovered: SkillStage[]; installedPacks: string[] } {
    const covered = new Set<SkillStage>();
    const installedPacks: string[] = [];

    for (const [id, pack] of Object.entries(this.config.packs)) {
      if (pack.enabled === false) continue;
      if (!this.detect(id, pack)) continue;
      installedPacks.push(id);
      for (const stage of Object.keys(pack.stages || {}) as SkillStage[]) {
        covered.add(stage);
      }
    }

    const declared = new Set<SkillStage>();
    for (const pack of Object.values(this.config.packs)) {
      for (const stage of Object.keys(pack.stages || {}) as SkillStage[]) {
        declared.add(stage);
      }
    }

    return {
      covered: Array.from(covered),
      uncovered: Array.from(declared).filter((s) => !covered.has(s)),
      installedPacks,
    };
  }

  /**
   * Where the pack was found, or undefined. Detection paths may be relative to
   * the project or to the user's home directory, and may end in `*` to match a
   * prefix (plugin directories are usually versioned or namespaced).
   */
  private detect(id: string, pack: SkillPack): string | undefined {
    if (this.detectionCache.has(id)) {
      return this.detectionCache.get(id);
    }

    let found: string | undefined;
    for (const candidate of pack.detect || []) {
      const resolved = this.resolveDetectionPath(candidate);
      if (resolved) {
        found = resolved;
        break;
      }
    }

    this.detectionCache.set(id, found);
    return found;
  }

  private resolveDetectionPath(candidate: string): string | undefined {
    const allowHome = this.includeHome && process.env.AGENTIC_TEST_ISOLATION !== 'true';
    const roots = allowHome ? [this.projectRoot, os.homedir()] : [this.projectRoot];

    for (const root of roots) {
      const full = path.resolve(root, candidate);

      if (!candidate.includes('*')) {
        if (fs.existsSync(full)) return full;
        continue;
      }

      // Single trailing/embedded wildcard on the last segment, e.g.
      // `.claude/plugins/*mattpocock*`.
      const dir = path.dirname(full);
      const pattern = path.basename(full);
      if (!fs.existsSync(dir)) continue;

      const needle = pattern.replace(/\*/g, '').toLowerCase();
      try {
        const match = fs.readdirSync(dir).find((entry) => entry.toLowerCase().includes(needle));
        if (match) return path.join(dir, match);
      } catch {
        continue;
      }
    }

    return undefined;
  }
}
