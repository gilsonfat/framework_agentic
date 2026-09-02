import fs from 'fs';
import path from 'path';
import { Migrator } from './migrator.js';
import { GateKeeper } from './gate-keeper.js';
import { MilestoneManager } from './milestone-manager.js';
import { Orchestrator } from './orchestrator.js';
import { AgentBridge } from './agent-bridge.js';
import { EvidenceCollector } from './evidence-collector.js';
import { isCurrent, isFromFuture } from './artifact-schema.js';

export type NextActionKind =
  | 'init'
  | 'migrate'
  | 'update_cli'
  | 'decide_gate'
  | 'implement'
  | 'report'
  | 'verify'
  | 'remediate'
  | 'unblock'
  | 'advance_milestone'
  | 'start_work'
  | 'measure_tests';

export interface NextAction {
  kind: NextActionKind;
  /** One line the operator (or an agent) can act on. */
  summary: string;
  /** The exact command to run, when there is a single obvious one. */
  command?: string;
  /** Supporting detail: what is blocking, which files to open. */
  details: string[];
  /** Safe to execute without a human decision. */
  autoRunnable: boolean;
}

/**
 * Answers one question: what should happen next in this repository?
 *
 * The answer lived in three places (the status dashboard, the setup summary and
 * the operator's head), so it drifted. Concentrating it here means `agentic next`,
 * `agentic status` and every agent instruction give the same answer.
 */
export class NextActionResolver {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public resolve(): NextAction {
    // 1. Is this even a project the framework governs?
    if (!fs.existsSync(path.join(this.projectRoot, '.agentic', 'orchestrator', 'workflow.yaml'))) {
      return {
        kind: 'init',
        summary: 'This project is not initialized yet.',
        command: 'agentic init',
        details: ['Creates .agentic/, wires every AI product to the workflow and runs a diagnosis.'],
        autoRunnable: false,
      };
    }

    // 2. Can the state be trusted at all?
    const migration = new Migrator(this.projectRoot).inspect();
    if (migration.fromFuture.length > 0) {
      return {
        kind: 'update_cli',
        summary: 'Artifacts here were written by a newer build of the framework.',
        details: migration.fromFuture,
        autoRunnable: false,
      };
    }
    if (migration.findings.length > 0) {
      return {
        kind: 'migrate',
        summary: `${migration.findings.length} artifact(s) predate the current schema, so the state cannot be read as-is.`,
        command: 'agentic migrate --apply',
        details: migration.findings.map((f) => `[${f.id}] ${f.artifact}: ${f.description}`),
        autoRunnable: false,
      };
    }

    // 3. Anything waiting on a human decision outranks work.
    const gates = this.pendingGates();
    if (gates.length > 0) {
      return {
        kind: 'decide_gate',
        summary: `${gates.length} human gate(s) are blocking the cycle.`,
        command: 'agentic gate list',
        details: gates,
        autoRunnable: false,
      };
    }

    // 4. Where is the current run?
    const orchestrator = new Orchestrator(this.projectRoot);
    const run = orchestrator.loadCurrentRun();

    if (run && isCurrent(run) && !isFromFuture(run)) {
      const taskIds = (run.dag?.nodes || []).map((node) => node.id);
      const results = new AgentBridge(this.projectRoot).collectResults(run.run_id, taskIds);
      const reported = new Set(results.filter((r) => r.status !== 'pending').map((r) => r.task_id));
      const awaiting = taskIds.filter((id) => !reported.has(id));

      if (run.status === 'AWAITING_AGENT' && awaiting.length > 0) {
        return {
          kind: 'implement',
          summary: `${awaiting.length} task(s) are waiting for implementation.`,
          command: `agentic report ${awaiting[0]} --status completed --tests "<test files>" --commit <sha>`,
          details: [
            `Prompt packs: ${path.join('.agentic', 'execution', 'inbox')}`,
            ...awaiting.map((id) => `${id}: .agentic/execution/inbox/${id}.md`),
          ],
          autoRunnable: false,
        };
      }

      if (run.status === 'AWAITING_AGENT') {
        return {
          kind: 'verify',
          summary: 'Every task was reported. Close the cycle against real evidence.',
          command: 'agentic verify',
          details: [`Run ${run.run_id}, phase ${run.work_package.phase}`],
          autoRunnable: true,
        };
      }

      if (run.status === 'REMEDIATING' || run.verification?.status === 'FAIL') {
        return {
          kind: 'remediate',
          summary: 'Verification failed: fix the code and verify again.',
          command: 'agentic verify',
          details: run.verification?.blocking_findings || run.blockers || [],
          autoRunnable: false,
        };
      }

      if (run.status === 'BLOCKED' || run.status === 'HUMAN_GATE') {
        return {
          kind: 'unblock',
          summary: `Run ${run.run_id} is ${run.status}.`,
          details: run.blockers || ['See `agentic status` for the blocking reason.'],
          autoRunnable: false,
        };
      }
    }

    // 5. No run in flight: is the roadmap ready to move?
    const milestones = new MilestoneManager(this.projectRoot);
    const progress = milestones.progress();

    if (progress.readyToClose && progress.status !== 'complete') {
      return {
        kind: 'advance_milestone',
        summary: `Every phase of ${progress.milestone} is closed with evidence.`,
        command: 'agentic milestone advance',
        details: progress.phases.map((p) => `${p.phase}: ${p.requirementsClosed}/${p.requirementsTotal} closed`),
        autoRunnable: true,
      };
    }

    const nextPhase = milestones.nextPlannedPhase();
    if (nextPhase) {
      return {
        kind: 'start_work',
        summary: `Next planned phase: ${nextPhase.id} - ${nextPhase.title}`,
        command: `agentic run --phase ${nextPhase.id}`,
        details: [`Requirements: ${nextPhase.requirements.join(', ') || 'none attached yet'}`],
        autoRunnable: false,
      };
    }

    // 6. Nothing pending. Is the baseline even measured?
    const evidence = new EvidenceCollector(this.projectRoot).latest();
    if (!evidence) {
      return {
        kind: 'measure_tests',
        summary: 'No test evidence has ever been collected here; the baseline is unknown.',
        command: 'agentic observe --tests',
        details: ['Measuring once gives the cycle something real to compare against.'],
        autoRunnable: true,
      };
    }

    return {
      kind: 'start_work',
      summary: `Nothing is in flight on ${progress.milestone} (${progress.title}).`,
      command: 'agentic prompt "<what you want built>"',
      details: [
        `Phases: ${progress.phasesComplete}/${progress.phasesTotal} complete`,
        `Requirements closed with evidence: ${progress.requirementsClosed}/${progress.requirementsTotal}`,
      ],
      autoRunnable: false,
    };
  }

  private pendingGates(): string[] {
    try {
      return new GateKeeper(this.projectRoot)
        .listPending()
        .map((gate) => `${gate.id} (${gate.gate}): ${gate.reason}`);
    } catch {
      return [];
    }
  }
}
