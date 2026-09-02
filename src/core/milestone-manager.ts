import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import {
  MilestoneProgress,
  PhaseProgress,
  Roadmap,
  RoadmapMilestone,
  RoadmapPhase,
} from '../types/roadmap.js';
import { RequirementClosureMatrix } from '../types/verification.js';
import { ARTIFACT_SCHEMA_VERSION } from './artifact-schema.js';
import { AuditLogger } from './audit-logger.js';
import { GateKeeper } from './gate-keeper.js';
import { IdRegistry } from './id-registry.js';
import { EvidenceCollector } from './evidence-collector.js';

export interface AdvanceResult {
  closedPhases: string[];
  closedMilestone?: string;
  activatedMilestone?: string;
  /** Why nothing (or not everything) moved. */
  blockers: string[];
}

/**
 * Owns the roadmap: which milestone is active, which phases belong to it, and
 * when either of them can be considered done.
 *
 * The rule that makes this trustworthy is the same one that governs a single
 * requirement: a phase closes only when every requirement it carries is closed
 * *against an evidence record*. A matrix entry that claims closure without
 * evidence blocks the phase instead of advancing it.
 */
export class MilestoneManager {
  private projectRoot: string;
  private auditLogger: AuditLogger;
  private idRegistry: IdRegistry;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger, idRegistry?: IdRegistry) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
    this.idRegistry = idRegistry || new IdRegistry(this.projectRoot, this.auditLogger);
  }

  // ------------------------------------------------------------- reading ---
  public load(): Roadmap {
    const file = this.roadmapFile();
    if (fs.existsSync(file)) {
      try {
        const parsed = YAML.parse(fs.readFileSync(file, 'utf8')) as Roadmap | null;
        if (parsed && Array.isArray(parsed.milestones) && parsed.milestones.length > 0) {
          return parsed;
        }
      } catch {
        // fall through to the default roadmap
      }
    }

    // Materialize the default roadmap so its milestone id is visible to the id
    // registry; otherwise the next `milestone new` allocates the same id again.
    const roadmap = this.defaultRoadmap();
    this.save(roadmap);
    return roadmap;
  }

  public currentMilestone(): RoadmapMilestone {
    const roadmap = this.load();
    return (
      roadmap.milestones.find((m) => m.id === roadmap.current_milestone) ||
      roadmap.milestones.find((m) => m.status === 'active') ||
      roadmap.milestones[0]
    );
  }

  /** Milestone id used to stamp new work packages. */
  public currentMilestoneId(): string {
    return this.currentMilestone().id;
  }

  /** The phase currently being worked, if any. */
  public activePhase(): RoadmapPhase | undefined {
    return this.currentMilestone().phases.find((p) => p.status === 'active');
  }

  /** The next phase that has not been started. */
  public nextPlannedPhase(): RoadmapPhase | undefined {
    return this.currentMilestone().phases.find((p) => p.status === 'planned');
  }

  // ------------------------------------------------------------- writing ---
  /**
   * Registers a phase on the current milestone. Called whenever a run creates a
   * work package, so the roadmap reflects what is actually being built rather
   * than a plan nobody updates.
   */
  public registerPhase(input: { phase: string; title: string; requirements: string[] }): RoadmapPhase {
    const roadmap = this.load();
    const milestone = this.milestoneOf(roadmap, roadmap.current_milestone);

    let phase = milestone.phases.find((p) => p.id === input.phase);
    if (!phase) {
      phase = {
        id: input.phase,
        title: input.title,
        status: 'active',
        requirements: [...input.requirements],
        opened_at: new Date().toISOString(),
      };
      milestone.phases.push(phase);
    } else {
      phase.title = phase.title || input.title;
      phase.requirements = Array.from(new Set([...phase.requirements, ...input.requirements]));
      if (phase.status === 'planned') {
        phase.status = 'active';
        phase.opened_at = phase.opened_at || new Date().toISOString();
      }
    }

    if (milestone.status === 'planned') {
      milestone.status = 'active';
      milestone.opened_at = milestone.opened_at || new Date().toISOString();
    }

    this.save(roadmap);
    return phase;
  }

  /**
   * Opens a milestone. `gates.yaml` declares `new_milestone` as a human gate, so
   * the milestone is recorded as `planned` and only becomes active once the gate
   * is approved (or when the gate is not required).
   */
  public open(title: string, options: { goal?: string; runId?: string } = {}): {
    milestone: RoadmapMilestone;
    gateId?: string;
  } {
    const roadmap = this.load();
    let id = this.idRegistry.allocate('MILESTONE', { title, runId: options.runId });

    // Defensive: a duplicate id would silently merge two milestones.
    while (roadmap.milestones.some((m) => m.id === id)) {
      id = this.idRegistry.allocate('MILESTONE', { title, runId: options.runId });
    }

    const milestone: RoadmapMilestone = {
      id,
      title,
      status: 'planned',
      goal: options.goal,
      phases: [],
    };
    roadmap.milestones.push(milestone);
    this.save(roadmap);

    let gateId: string | undefined;
    try {
      const keeper = new GateKeeper(this.projectRoot, undefined, this.auditLogger);
      const evaluation = keeper.evaluate({
        runId: options.runId || 'SYSTEM',
        workPackage: {
          run_id: options.runId || 'SYSTEM',
          milestone: id,
          phase: id,
          goal: title,
          scope: { include: [], exclude: [] },
          requirements: [],
          dependencies: [],
          risks: [],
          blockers: [],
          complexity: 'M',
          expected_domains: [],
        },
        newMilestone: true,
      });
      const gate = evaluation.triggered.find((g) => g.gate === 'new_milestone');
      if (gate) {
        gateId = gate.id;
        milestone.gate = gate.id;
        this.save(roadmap);
      }
    } catch {
      // No gate configuration: nothing gates the milestone.
    }

    if (!gateId) {
      this.activate(id);
      return { milestone: this.milestoneOf(this.load(), id) };
    }

    return { milestone, gateId };
  }

  /** Makes a planned milestone the current one, once its gate allows it. */
  public activate(milestoneId: string): { activated: boolean; reason: string } {
    const roadmap = this.load();
    const milestone = this.milestoneOf(roadmap, milestoneId);

    if (milestone.gate) {
      const gate = new GateKeeper(this.projectRoot, undefined, this.auditLogger).get(milestone.gate);
      if (gate && gate.status !== 'APPROVED') {
        return {
          activated: false,
          reason: `Milestone ${milestoneId} is behind gate ${gate.id} (${gate.status}). Decide it with: agentic gate approve ${gate.id}`,
        };
      }
    }

    for (const other of roadmap.milestones) {
      if (other.id !== milestoneId && other.status === 'active') {
        other.status = 'complete';
        other.closed_at = other.closed_at || new Date().toISOString();
      }
    }

    milestone.status = 'active';
    milestone.opened_at = milestone.opened_at || new Date().toISOString();
    roadmap.current_milestone = milestoneId;
    this.save(roadmap);

    this.auditLogger.emit('SYSTEM', 'MILESTONE_ACTIVATED', {
      metadata: { milestone: milestoneId, title: milestone.title },
    });

    return { activated: true, reason: `Milestone ${milestoneId} is now current.` };
  }

  /**
   * Closes every phase whose requirements are all backed by evidence, then the
   * milestone itself when nothing is left open.
   */
  public advance(options: { runId?: string } = {}): AdvanceResult {
    const roadmap = this.load();
    const milestone = this.milestoneOf(roadmap, roadmap.current_milestone);
    const progress = this.progress(milestone.id);
    const result: AdvanceResult = { closedPhases: [], blockers: [] };

    for (const phase of milestone.phases) {
      if (phase.status === 'complete') continue;

      const phaseProgress = progress.phases.find((p) => p.phase === phase.id);
      if (!phaseProgress) continue;

      if (phaseProgress.requirementsUnbacked.length > 0) {
        result.blockers.push(
          `${phase.id}: ${phaseProgress.requirementsUnbacked.join(', ')} claim closure with no usable evidence (run \`agentic migrate\` or re-verify).`
        );
        continue;
      }

      if (phaseProgress.requirementsTotal === 0) {
        result.blockers.push(`${phase.id}: no requirement is attached to it yet.`);
        continue;
      }

      if (phaseProgress.requirementsClosed < phaseProgress.requirementsTotal) {
        result.blockers.push(
          `${phase.id}: ${phaseProgress.requirementsClosed}/${phaseProgress.requirementsTotal} requirements closed with evidence.`
        );
        continue;
      }

      phase.status = 'complete';
      phase.closed_at = new Date().toISOString();
      phase.closed_by_run = options.runId;
      result.closedPhases.push(phase.id);

      this.auditLogger.emit(options.runId || 'SYSTEM', 'PHASE_CLOSED', {
        metadata: { phase: phase.id, milestone: milestone.id, requirements: phase.requirements },
      });
    }

    const allComplete =
      milestone.phases.length > 0 && milestone.phases.every((phase) => phase.status === 'complete');

    if (allComplete && milestone.status !== 'complete') {
      milestone.status = 'complete';
      milestone.closed_at = new Date().toISOString();
      result.closedMilestone = milestone.id;

      this.auditLogger.emit(options.runId || 'SYSTEM', 'MILESTONE_CLOSED', {
        metadata: { milestone: milestone.id, phases: milestone.phases.length },
      });

      const nextPlanned = roadmap.milestones.find((m) => m.status === 'planned');
      if (nextPlanned) {
        this.save(roadmap);
        const activation = this.activate(nextPlanned.id);
        if (activation.activated) {
          result.activatedMilestone = nextPlanned.id;
        } else {
          result.blockers.push(activation.reason);
        }
        return result;
      }
    }

    this.save(roadmap);
    return result;
  }

  /** Marks phases complete from the evidence matrix, without closing milestones. */
  public syncFromMatrix(runId?: string): string[] {
    return this.advance({ runId }).closedPhases;
  }

  // ------------------------------------------------------------ progress ---
  public progress(milestoneId?: string): MilestoneProgress {
    const roadmap = this.load();
    const milestone = this.milestoneOf(roadmap, milestoneId || roadmap.current_milestone);
    const matrix = this.matrix();
    const collector = new EvidenceCollector(this.projectRoot);

    const phases: PhaseProgress[] = milestone.phases.map((phase) => {
      const unbacked: string[] = [];
      let closed = 0;

      for (const requirement of phase.requirements) {
        const entry = matrix[requirement];
        if (!entry || !(entry.implemented && entry.tested && entry.verified)) continue;

        // Closure only counts when an evidence record actually backs it.
        const evidence = entry.evidence ? collector.load(entry.evidence) : undefined;
        if (evidence && EvidenceCollector.isClosable(evidence)) {
          closed += 1;
        } else {
          unbacked.push(requirement);
        }
      }

      return {
        phase: phase.id,
        title: phase.title,
        status: phase.status,
        requirementsTotal: phase.requirements.length,
        requirementsClosed: closed,
        requirementsUnbacked: unbacked,
      };
    });

    return {
      milestone: milestone.id,
      title: milestone.title,
      status: milestone.status,
      phases,
      phasesComplete: phases.filter((p) => p.status === 'complete').length,
      phasesTotal: phases.length,
      requirementsClosed: phases.reduce((sum, p) => sum + p.requirementsClosed, 0),
      requirementsTotal: phases.reduce((sum, p) => sum + p.requirementsTotal, 0),
      readyToClose:
        phases.length > 0 &&
        phases.every((p) => p.requirementsTotal > 0 && p.requirementsClosed === p.requirementsTotal),
    };
  }

  // --------------------------------------------------------------- utils ---
  public save(roadmap: Roadmap): void {
    const file = this.roadmapFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      YAML.stringify({ schema_version: ARTIFACT_SCHEMA_VERSION, ...roadmap }),
      'utf8'
    );
  }

  private milestoneOf(roadmap: Roadmap, id: string): RoadmapMilestone {
    const milestone = roadmap.milestones.find((m) => m.id === id);
    if (!milestone) {
      throw new Error(
        `Milestone '${id}' is not on the roadmap. Known milestones: ${roadmap.milestones.map((m) => m.id).join(', ')}`
      );
    }
    return milestone;
  }

  private matrix(): RequirementClosureMatrix {
    const file = path.join(this.projectRoot, '.agentic', 'verification', 'requirement-matrix.json');
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as RequirementClosureMatrix;
    } catch {
      return {};
    }
  }

  private defaultRoadmap(): Roadmap {
    return {
      schema_version: ARTIFACT_SCHEMA_VERSION,
      current_milestone: 'M-01',
      milestones: [
        {
          id: 'M-01',
          title: 'Initial milestone',
          status: 'active',
          phases: [],
          opened_at: new Date().toISOString(),
        },
      ],
    };
  }

  private roadmapFile(): string {
    return path.join(this.projectRoot, '.agentic', 'planning', 'roadmap.yaml');
  }
}
