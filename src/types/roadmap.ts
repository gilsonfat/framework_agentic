/**
 * Milestone and phase lifecycle.
 *
 * The framework could deliver a task but never advance a project: `M01` was
 * hardcoded in nine places, `declared-state.milestone` never changed, and no
 * command closed a phase. The roadmap is the shared, committed answer to
 * "where are we and what comes next".
 */

export type MilestoneStatus = 'planned' | 'active' | 'complete';
export type PhaseStatus = 'planned' | 'active' | 'complete';

export interface RoadmapPhase {
  id: string;
  title: string;
  status: PhaseStatus;
  requirements: string[];
  opened_at?: string;
  closed_at?: string;
  /** Run that closed the phase, for traceability. */
  closed_by_run?: string;
  /**
   * Imported from a roadmap the project already had. Such a phase is never
   * created as `complete`: `declared_complete` records what the legacy document
   * claimed, which is a declaration and not evidence this framework collected.
   */
  imported_from?: string;
  declared_complete?: boolean;
}

export interface RoadmapMilestone {
  id: string;
  title: string;
  status: MilestoneStatus;
  goal?: string;
  phases: RoadmapPhase[];
  opened_at?: string;
  closed_at?: string;
  /** Gate that must be approved before this milestone can be activated. */
  gate?: string;
}

export interface Roadmap {
  schema_version?: number;
  current_milestone: string;
  milestones: RoadmapMilestone[];
}

export interface PhaseProgress {
  phase: string;
  title: string;
  status: PhaseStatus;
  /** Declared done by a pre-existing roadmap, with no evidence in this framework. */
  declaredComplete?: boolean;
  requirementsTotal: number;
  /** Requirements closed against an evidence record. */
  requirementsClosed: number;
  /** Requirements the matrix claims are closed without usable evidence. */
  requirementsUnbacked: string[];
}

export interface MilestoneProgress {
  milestone: string;
  title: string;
  status: MilestoneStatus;
  phases: PhaseProgress[];
  phasesComplete: number;
  phasesTotal: number;
  requirementsClosed: number;
  requirementsTotal: number;
  /** True when every phase is complete and the milestone can be closed. */
  readyToClose: boolean;
}
