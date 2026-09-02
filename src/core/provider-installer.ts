import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { ConfigLoader } from './config-loader.js';
import { ProvidersConfig } from '../types/config.js';

export interface ProviderInstallStatus {
  name: string;
  engine: string;
  category: 'planner' | 'specification' | 'execution' | 'process' | 'domain_skills';
  installed: boolean;
  installCommand: string;
  runtimeNotes: string;
}

export class ProviderInstaller {
  private configLoader: ConfigLoader;
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = new ConfigLoader(this.projectRoot);
  }

  public checkProviders(): ProviderInstallStatus[] {
    const providers = this.configLoader.loadProvidersConfig().providers;

    const list: ProviderInstallStatus[] = [
      {
        name: 'GSD (Get Shit Done)',
        category: 'planner',
        engine: providers.project_planner?.engine || 'gsd',
        installed: this.isCommandAvailable('gsd') || this.isPackageCached('get-shit-done-cc'),
        installCommand: 'npx get-shit-done-cc@latest',
        runtimeNotes: 'For Antigravity: npx get-shit-done-cc --antigravity --local | For Claude: npx get-shit-done-cc --claude --local',
      },
      {
        name: 'TLC Spec-Driven',
        category: 'specification',
        engine: providers.specification?.engine || 'tlc-spec-driven',
        installed: this.isCommandAvailable('agent-skills') || this.isPackageCached('@tech-leads-club/agent-skills'),
        installCommand: 'npx @tech-leads-club/agent-skills',
        runtimeNotes: 'Select tlc-spec-driven during setup or run: agent-skills install -s tlc-spec-driven',
      },
      {
        name: 'Ruflo Swarm & Execution Engine',
        category: 'execution',
        engine: providers.execution?.engine || 'ruflo',
        installed: this.isCommandAvailable('ruflo') || this.isPackageCached('ruflo'),
        installCommand: 'npx ruflo@latest init',
        runtimeNotes: 'For Claude MCP: claude mcp add ruflo -- npx ruflo@latest mcp start',
      },
      {
        name: 'BMAD Method (Business, Modeling, Architecture, Delivery)',
        category: 'planner',
        engine: providers.bmad?.engine || 'bmad-method',
        // The native BMAD engine ships with this package; an external bmad-core
        // plugin is only reported as present when it is actually on disk.
        installed: this.isPluginPresent('bmad'),
        installCommand: 'agy plugin install https://github.com/bmad-method/bmad-core',
        runtimeNotes: 'Agile AI development framework: prompt refinement, domain modeling, architecture guardrails, and delivery slices.',
      },
      {
        name: 'GitHub Spec Kit (Spec-Driven Development / SDD)',
        category: 'specification',
        engine: providers.spec_kit?.engine || 'github-spec-kit',
        installed: this.isPluginPresent('spec-kit'),
        installCommand: 'agy plugin install https://github.com/github/spec-kit',
        runtimeNotes: 'Contract-first specification toolkit: scenario trees, AC matrices, and interface contracts.',
      },
      {
        name: 'Superpowers Process Discipline',
        category: 'process',
        engine: providers.process?.engine === 'superpowers' ? 'superpowers' : 'superpowers (optional)',
        installed: this.isSuperpowersInstalled(),
        installCommand: 'agy plugin install https://github.com/obra/superpowers',
        runtimeNotes: 'For Claude: /plugin install superpowers@claude-plugins-official | For Antigravity: agy plugin install https://github.com/obra/superpowers',
      },
      {
        name: 'Matt Pocock Skills (technique pack: to-spec, tdd, code-review, diagnosing-bugs)',
        category: 'domain_skills',
        engine: providers.domain_skills?.engine || 'mattpocock-skills',
        installed: this.isPluginPresent('mattpocock') || this.isPluginPresent('to-spec'),
        installCommand: 'npx skills@latest add mattpocock/skills',
        runtimeNotes:
          'For Claude Code: claude plugins install mattpocock-skills | Then run /setup-matt-pocock-skills once per repository. Stage mapping lives in .agentic/orchestrator/skills.yaml.',
      },
      {
        name: 'ECC (Everything Claude Code / Enterprise Coding Capabilities)',
        category: 'process',
        engine: providers.process?.engine === 'ecc' ? 'ecc' : 'ecc (alternative)',
        installed: this.isEccInstalled(),
        installCommand: 'agy plugin install https://github.com/affinda/everything-claude-code',
        runtimeNotes: 'Enterprise suite: tdd-workflow, verification-loop, security-review, agentic-engineering. Usable as primary process engine.',
      },
    ];

    return list;
  }

  public installProvider(name: string): { success: boolean; output: string } {
    const providers = this.checkProviders();
    const target = providers.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));

    if (!target) {
      return { success: false, output: `Provider '${name}' not recognized.` };
    }

    try {
      console.log(`>>> Running setup for ${target.name}: ${target.installCommand}`);
      const output = execSync(target.installCommand, { stdio: 'inherit' });
      return { success: true, output: output ? output.toString() : 'Completed.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, output: `Failed to install ${target.name}: ${msg}\nManual command: ${target.installCommand}\nNotes: ${target.runtimeNotes}` };
    }
  }

  private isCommandAvailable(cmd: string): boolean {
    try {
      const checkCmd = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
      execSync(checkCmd, { stdio: ['pipe', 'pipe', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Real check against the npm/npx cache. The previous implementation returned
   * `false` unconditionally, which made every `installed` flag meaningless.
   */
  private isPackageCached(pkg: string): boolean {
    const scoped = pkg.startsWith('@');
    const relative = scoped ? pkg.split('/') : [pkg];
    const candidates = [
      path.join(this.projectRoot, 'node_modules', ...relative),
      path.join(os.homedir(), '.npm', '_npx'),
    ];

    if (fs.existsSync(candidates[0])) return true;

    const npxCache = candidates[1];
    if (!fs.existsSync(npxCache)) return false;
    try {
      for (const entry of fs.readdirSync(npxCache)) {
        if (fs.existsSync(path.join(npxCache, entry, 'node_modules', ...relative))) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  /** Looks for an installed plugin/skill directory in the usual agent locations. */
  private isPluginPresent(name: string): boolean {
    const roots = [
      path.join(this.projectRoot, '.claude', 'plugins'),
      path.join(this.projectRoot, '.agents', 'skills'),
      path.join(this.projectRoot, '.antigravity', 'plugins'),
      path.join(os.homedir(), '.claude', 'plugins'),
      path.join(os.homedir(), '.antigravity', 'plugins'),
    ];
    for (const root of roots) {
      if (!fs.existsSync(root)) continue;
      try {
        if (fs.readdirSync(root).some((entry) => entry.toLowerCase().includes(name))) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private isSuperpowersInstalled(): boolean {
    return this.isPluginPresent('superpowers');
  }

  private isEccInstalled(): boolean {
    return this.isPluginPresent('everything-claude-code') || this.isPluginPresent('ecc');
  }
}
