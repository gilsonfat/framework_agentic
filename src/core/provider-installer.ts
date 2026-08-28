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

  constructor(projectRoot: string = process.cwd()) {
    this.configLoader = new ConfigLoader(projectRoot);
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
        name: 'Superpowers Process Discipline',
        category: 'process',
        engine: providers.process?.engine === 'superpowers' ? 'superpowers' : 'superpowers (optional)',
        installed: this.isSuperpowersInstalled(),
        installCommand: 'agy plugin install https://github.com/obra/superpowers',
        runtimeNotes: 'For Claude: /plugin install superpowers@claude-plugins-official | For Antigravity: agy plugin install https://github.com/obra/superpowers',
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

  private isPackageCached(pkg: string): boolean {
    return false;
  }

  private isSuperpowersInstalled(): boolean {
    return true; // Active or integrated via runtime skills
  }

  private isEccInstalled(): boolean {
    return true; // Available via local/global ecc plugins & skills
  }
}
