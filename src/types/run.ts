import { OrchestratorState, ObservedState } from './state.js';
import { WorkPackage, TaskContract, TaskDAG } from './task.js';
import { VerificationReport, RemediationPackage } from './verification.js';

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
  spec?: Record<string, unknown>;
  tasks?: TaskContract[];
  dag?: TaskDAG;
  agents?: RunAgentAssignment[];
  worktrees?: string[];
  commits?: string[];
  tests?: Record<string, unknown>;
  review?: Record<string, unknown>;
  verification?: VerificationReport;
  remediations?: RemediationPackage[];
  reconciliation?: Record<string, unknown>;
  as_built?: Record<string, unknown>;
  resulting_state?: ObservedState;
}
