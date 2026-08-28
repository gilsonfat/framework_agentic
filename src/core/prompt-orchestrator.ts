import path from 'path';
import { Orchestrator } from './orchestrator.js';
import { Planner } from './planner.js';
import { ComplexityLevel } from '../types/config.js';
import { WorkPackage } from '../types/task.js';
import { RunDescriptor } from '../types/run.js';

export interface PromptDispatchOptions {
  phaseId?: string;
  domain?: string;
  complexity?: ComplexityLevel;
}

export class PromptOrchestrator {
  private projectRoot: string;
  private orchestrator: Orchestrator;
  private planner: Planner;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
    this.orchestrator = new Orchestrator(this.projectRoot);
    this.planner = new Planner(this.projectRoot);
  }

  public async dispatchPrompt(
    promptText: string,
    options: PromptDispatchOptions = {}
  ): Promise<RunDescriptor> {
    const trimmedPrompt = promptText.trim();
    if (!trimmedPrompt) {
      throw new Error('Prompt instruction cannot be empty.');
    }

    console.log(`\n=============================================================`);
    console.log(`>>> AUTO-ORCHESTRATING USER PROMPT:`);
    console.log(`"${trimmedPrompt}"`);
    console.log(`=============================================================\n`);

    // 1. Infer domain and complexity from prompt
    const domain = options.domain || this.inferDomain(trimmedPrompt);
    const complexity = options.complexity || this.inferComplexity(trimmedPrompt);

    // 2. Generate stable requirement IDs and acceptance criteria
    const reqNumber = String(Math.floor(Math.random() * 900) + 100);
    const reqId = `REQ-${reqNumber}`;
    const phaseId = options.phaseId || `P-${reqNumber}`;

    const workPackage: WorkPackage = {
      run_id: `RUN-${new Date().toISOString().slice(0, 10)}-${reqNumber}`,
      milestone: 'M01',
      phase: phaseId,
      goal: trimmedPrompt,
      scope: {
        include: [`src/**`],
        exclude: ['node_modules/**', '.git/**'],
      },
      requirements: [reqId],
      dependencies: [],
      risks: [],
      blockers: [],
      complexity,
      expected_domains: [domain],
      human_gate_required: complexity === 'XL' || domain === 'security',
    };

    // 3. Save work package for this prompt
    this.planner.saveWorkPackage(workPackage);
    console.log(`+ Generated Work Package: ${workPackage.phase} [${complexity}] (Domain: ${domain})`);

    // 4. Run the full Orchestrated Cycle
    const runResult = await this.orchestrator.runCycle({ phaseId });

    console.log(`\n=============================================================`);
    console.log(`>>> PROMPT ORCHESTRATION FINISHED:`);
    console.log(`- Run ID: ${runResult.run_id}`);
    console.log(`- Final Status: ${runResult.status}`);
    console.log(`- Verification: ${runResult.verification?.status || 'UNKNOWN'}`);
    console.log(`=============================================================\n`);

    return runResult;
  }

  private inferDomain(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes('banco') || lower.includes('database') || lower.includes('migration') || lower.includes('tabela') || lower.includes('schema') || lower.includes('sql')) {
      return 'database';
    }
    if (lower.includes('tela') || lower.includes('layout') || lower.includes('frontend') || lower.includes('ui') || lower.includes('component') || lower.includes('css') || lower.includes('react')) {
      return 'frontend';
    }
    if (lower.includes('seguranca') || lower.includes('security') || lower.includes('auth') || lower.includes('jwt') || lower.includes('login') || lower.includes('token') || lower.includes('senha')) {
      return 'security';
    }
    if (lower.includes('teste') || lower.includes('test') || lower.includes('e2e') || lower.includes('coverage')) {
      return 'testing';
    }
    return 'backend';
  }

  private inferComplexity(prompt: string): ComplexityLevel {
    const lower = prompt.toLowerCase();
    if (lower.includes('refatorar arquitetura') || lower.includes('migrar todo') || lower.includes('microserviço') || lower.includes('multiplos modulos')) {
      return 'XL';
    }
    if (lower.includes('novo modulo') || lower.includes('sistema de pagamento') || lower.includes('fluxo completo')) {
      return 'L';
    }
    if (lower.includes('criar rota') || lower.includes('endpoint') || lower.includes('adicionar campo') || lower.includes('corrigir bug')) {
      return 'S';
    }
    if (lower.includes('ajuste') || lower.includes('typo') || lower.includes('renomear')) {
      return 'XS';
    }
    return 'M';
  }
}
