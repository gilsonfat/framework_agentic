import { ComplexityLevel } from './config.js';

export interface WorkPackage {
  run_id: string;
  milestone: string;
  phase: string;
  goal: string;
  scope: {
    include: string[];
    exclude: string[];
  };
  requirements: string[];
  dependencies: string[];
  risks: string[];
  blockers: string[];
  complexity: ComplexityLevel;
  expected_domains: string[];
  human_gate_required?: boolean;
}

export interface TaskOwnership {
  write: string[];
  readonly?: string[];
  forbidden?: string[];
}

export interface TaskContract {
  id: string;
  title?: string;
  role: string;
  objective: string;
  domain: string;
  requirements: string[];
  acceptance_criteria: string[];
  dependencies: string[];
  ownership: TaskOwnership;
  process?: {
    tdd?: boolean;
    systematic_debugging?: boolean;
    verification_before_completion?: boolean;
  };
  output?: {
    implementation_report?: boolean;
    tests?: boolean;
    commit?: boolean;
  };
  completion?: {
    tests_must_pass?: boolean;
    no_self_declared_done?: boolean;
  };
}

export interface TaskDAGNode {
  id: string;
  title: string;
  domain: string;
  requirements: string[];
  acceptance_criteria: string[];
  dependencies: string[];
  ownership: TaskOwnership;
}

export interface TaskDAGEdge {
  from: string;
  to: string;
}

export interface WriteConflict {
  task_a: string;
  task_b: string;
  conflicting_paths: string[];
}

export interface TaskDAG {
  nodes: TaskDAGNode[];
  edges: TaskDAGEdge[];
  parallel_groups: string[][];
  critical_path: string[];
  conflicts: WriteConflict[];
}
