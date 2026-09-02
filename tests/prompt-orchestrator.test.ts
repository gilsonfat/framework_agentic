import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import YAML from 'yaml';
import { execSync } from 'child_process';
import { PromptOrchestrator } from '../src/core/prompt-orchestrator.js';
import { Scaffolder } from '../src/core/scaffolder.js';
import { AgentBridge } from '../src/core/agent-bridge.js';
import { Orchestrator } from '../src/core/orchestrator.js';
import { GateKeeper } from '../src/core/gate-keeper.js';

describe('PromptOrchestrator', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-prompt-'));
    try {
      execSync('git init', { cwd: tempDir, stdio: 'ignore' });
    } catch {
      // ignore
    }
    new Scaffolder().scaffold(tempDir, { autoObserve: true });
    fs.writeFileSync(
      path.join(tempDir, '.agentic', 'orchestrator', 'evidence.yaml'),
      YAML.stringify({ version: 1, evidence: { test_command: 'exit 0', timeout_ms: 60000, output_tail_chars: 2000 } }),
      'utf8'
    );
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('structures a prompt into BMAD, probes, ADRs and a Spec Kit contract, then hands work to an agent', async () => {
    const runResult = await new PromptOrchestrator(tempDir).dispatchPrompt(
      'Implementar rota de checkout com cartao de credito'
    );

    // The structuring layer never claims the work was implemented.
    expect(runResult.status).toBe('AWAITING_AGENT');
    expect(runResult.verification).toBeUndefined();

    // 1. BMAD briefing
    expect(runResult.bmad_briefing?.metadata.engine).toBe('bmad-method');
    const promptFiles = fs.readdirSync(path.join(tempDir, '.agentic', 'prompts'));
    expect(promptFiles.some((f) => f.startsWith('BMAD-') && f.endsWith('.md'))).toBe(true);

    // 2. Probing, carried forward as explicit assumptions
    expect(runResult.grill_me?.probes.length).toBeGreaterThanOrEqual(4);
    expect(runResult.grill_me?.fully_resolved).toBe(false);
    expect(runResult.work_package.risks.some((r) => r.includes('unanswered'))).toBe(true);

    // 3. ADRs, sequential and still proposals
    expect(runResult.decisions?.[0].id).toMatch(/^ADR-\d+$/);
    expect(runResult.decisions?.[0].status).toBe('PROPOSED');
    const decisionsDir = path.join(tempDir, '.agentic', 'specs', 'decisions');
    expect(fs.readdirSync(decisionsDir).some((f) => f.startsWith('ADR-') && f.endsWith('.md'))).toBe(true);

    // 4. Spec Kit contract with registry-allocated identifiers
    expect(runResult.spec_kit?.spec_id).toMatch(/^SPEC-\d+$/);
    expect(runResult.work_package.requirements[0]).toMatch(/^REQ-\d+$/);
    expect(fs.readdirSync(path.join(tempDir, '.agentic', 'specs', 'planned')).length).toBeGreaterThan(0);

    // 5. Task prompt packs carry the assumptions and the open questions
    const inbox = path.join(tempDir, '.agentic', 'execution', 'inbox');
    const pack = fs.readFileSync(path.join(inbox, 'TASK-001.md'), 'utf8');
    expect(pack).toContain('Assumptions In Force');
    expect(pack).toContain('Open Questions');
  });

  it('turns answered probes into ACCEPTED decisions', async () => {
    const answers = {
      'GRILL-001': 'Reject malformed payloads with 422 and a problem+json envelope.',
      'GRILL-002': 'Circuit breaker with 3 retries and 2s timeout.',
      'GRILL-003': 'Idempotency ledger keyed by gateway event id.',
      'GRILL-005': 'Contract tests plus a failing-gateway integration test.',
    };

    const runResult = await new PromptOrchestrator(tempDir).dispatchPrompt(
      'Implementar webhook de pagamento idempotente',
      { userAnswers: answers }
    );

    expect(runResult.grill_me?.fully_resolved).toBe(true);
    expect(runResult.decisions?.[0].status).toBe('ACCEPTED');
  });

  it('refuses to proceed in strict mode while probes are unanswered', async () => {
    await expect(
      new PromptOrchestrator(tempDir).dispatchPrompt('Criar endpoint de relatorio', { strict: true })
    ).rejects.toThrow(/unanswered/);
  });

  it('routes security work to a human gate before any dispatch', async () => {
    const runResult = await new PromptOrchestrator(tempDir).dispatchPrompt(
      'Implementar autenticacao JWT com refresh token'
    );

    expect(runResult.status).toBe('HUMAN_GATE');
    expect(new GateKeeper(tempDir).listPending().length).toBeGreaterThan(0);
  });

  it('completes end to end once the agent reports and evidence is collected', async () => {
    const dispatched = await new PromptOrchestrator(tempDir).dispatchPrompt(
      'Criar rota de listagem de produtos'
    );
    expect(dispatched.status).toBe('AWAITING_AGENT');

    for (const node of dispatched.dag?.nodes || []) {
      new AgentBridge(tempDir).recordResult({
        runId: dispatched.run_id,
        taskId: node.id,
        status: 'completed',
        filesChanged: ['src/products/list.ts'],
        commit: 'deadbee',
      });
    }

    const closed = await new Orchestrator(tempDir).closeCycle(dispatched, {});
    expect(closed.status).toBe('COMPLETE');
    expect(closed.verification?.status).toBe('PASS');

    const asBuilt = path.join(tempDir, '.agentic', 'specs', 'as-built', closed.work_package.phase);
    expect(fs.existsSync(asBuilt)).toBe(true);
  });

  it('should reject empty prompts', async () => {
    await expect(new PromptOrchestrator(tempDir).dispatchPrompt('   ')).rejects.toThrow(
      /Prompt instruction cannot be empty/
    );
  });
});
