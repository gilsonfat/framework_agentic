export type OrchestratorState =
  | 'IDLE'
  | 'OBSERVING'
  | 'RECONCILING'
  | 'STATE_REPAIR'
  | 'PLANNING'
  | 'SPECIFYING'
  | 'SPEC_READY'
  | 'COMPILING'
  | 'EXECUTION_READY'
  | 'EXECUTING'
  | 'REVIEWING'
  | 'VERIFYING'
  | 'REMEDIATING'
  | 'RECONCILING_IMPLEMENTATION'
  | 'AS_BUILT'
  | 'UPDATING_STATE'
  | 'HUMAN_GATE'
  | 'BLOCKED'
  | 'COMPLETE'
  | 'STOPPED';

export interface GitObservedState {
  branch: string;
  commit: string;
  is_clean: boolean;
  dirty_files: string[];
  recent_commits: string[];
}

export interface ProjectObservedState {
  name: string;
  stack: string[];
  scripts: Record<string, string>;
  migrations: string[];
}

export interface TestsObservedState {
  status: 'pass' | 'fail' | 'unavailable' | 'pending';
  passed: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  failed_test_files: string[];
}

export interface RequirementObservedState {
  status: 'done' | 'partial' | 'not_started' | 'failed';
  verified: boolean;
}

export interface TaskObservedState {
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked';
  commit?: string;
}

export interface SpecsObservedState {
  planned: string[];
  as_built: string[];
}

export interface ObservedState {
  run_id: string;
  git: GitObservedState;
  project: ProjectObservedState;
  tests: TestsObservedState;
  requirements: Record<string, RequirementObservedState>;
  tasks: Record<string, TaskObservedState>;
  specs: SpecsObservedState;
  risks: string[];
  blockers: string[];
  timestamp: string;
}

export interface DeclaredState {
  milestone: string;
  phase: string;
  requirements: Record<string, { status: string; title?: string }>;
  tasks: Record<string, { status: string; title?: string }>;
  status: string;
}

export interface ReconciledItem {
  id: string;
  type: 'requirement' | 'task' | 'test' | 'migration';
  declared: string;
  observed: string;
  result: 'MATCH' | 'PARTIAL' | 'MISMATCH' | 'UNKNOWN';
  evidence: string[];
}

export interface ReconciledState {
  timestamp: string;
  status: string;
  matches: ReconciledItem[];
  partials: ReconciledItem[];
  mismatches: ReconciledItem[];
  unknowns: ReconciledItem[];
}
