import { OrchestratorState, ObservedState } from './state.js';
import { WorkPackage, TaskContract, TaskDAG } from './task.js';
import { VerificationReport, RemediationPackage } from './verification.js';
import { EvidenceRecord } from './evidence.js';
import { BmadBriefing } from './bmad.js';
import { GrillMeResult, DecisionRecord } from './decision.js';
import { GitHubSpecKitDocument } from './spec-kit.js';

export interface RunAgentAssignment {
  agent_id: string;
  role: string;
  domain: string;
  tasks: string[];
  worktree?: string;
}

export interface RunDescriptor {
  run_id: string;
  status: OrchestratorState;
  started_at: string;
  finished_at?: string;
  baseline_commit: string;
  result_commit?: string;
  initial_observed_state?: ObservedState;
  work_package: WorkPackage;
  bmad_briefing?: BmadBriefing;
  grill_me?: GrillMeResult;
  decisions?: DecisionRecord[];
  spec_kit?: GitHubSpecKitDocument;
  spec?: Record<string, unknown>;
  tasks?: TaskContract[];
  dag?: TaskDAG;
  agents?: RunAgentAssignment[];
  worktrees?: string[];
  commits?: string[];
  tests?: Record<string, unknown>;
  review?: Record<string, unknown>;
  verification?: VerificationReport;
  /** Executed test evidence that backed (or refused) closure of this run. */
  evidence?: EvidenceRecord;
  /** Complexity assessment and resolved providers actually used by this run. */
  routing?: Record<string, unknown>;
  /** Task dispatch record: prompt packs, waves, agent assignments, results. */
  dispatch?: Record<string, unknown>;
  /** Why the run is not COMPLETE, and what to do next. */
  blockers?: string[];
  remediations?: RemediationPackage[];
  reconciliation?: Record<string, unknown>;
  as_built?: Record<string, unknown>;
  resulting_state?: ObservedState;
}

