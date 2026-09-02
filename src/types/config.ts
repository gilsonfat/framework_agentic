export interface WorkflowConfig {
  version: number;
  workflow: {
    name: string;
    mode: string;
    stages: string[];
    failure_transitions: Record<string, Record<string, string>>;
    terminal_conditions: string[];
  };
}

export interface StateMachineStateTransition {
  next?: string[];
  success?: string;
  failure?: string;
  partial_failure?: string;
  findings?: string;
  critical?: string;
  needs_state_repair?: string;
  needs_human?: string;
  no_work?: string;
  no_more_work?: string;
  awaiting_agent?: string;
  blocked_by_gate?: string;
  repeated_failure?: string;
  approved?: string;
  rejected?: string;
  resolved?: string;
  aborted?: string;
  terminal?: boolean;
}

export interface StateMachineConfig {
  version: number;
  states: Record<string, StateMachineStateTransition>;
}

export interface PoliciesConfig {
  version: number;
  policies: {
    evidence_required_for_done: boolean;
    author_must_differ_from_verifier: boolean;
    spec_required: Record<string, boolean>;
    tdd: Record<string, string>;
    worktree: Record<string, string>;
    git: {
      atomic_commit_per_task: boolean;
      force_push: string;
      rewrite_shared_history: string;
    };
    security: Record<string, string>;
    documentation: {
      generate_as_built: boolean;
      update_after_verified_only: boolean;
    };
    loop: {
      maximum_automatic_remediation_attempts: number;
      reobserve_after_success: boolean;
    };
  };
}

export type ComplexityLevel = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface ComplexityLevelConfig {
  files_estimate: string;
  domains: number;
  agent_strategy: string;
  swarm: boolean | string;
}

export interface ComplexityConfig {
  version: number;
  levels: Record<ComplexityLevel, ComplexityLevelConfig>;
}

export interface GatesConfig {
  version: number;
  human_gates: Record<string, { required: boolean }>;
}

export interface DomainRouting {
  preferred_agent: string;
  skills?: string[];
  mode?: string;
  human_gate_if_breaking?: boolean;
}

export interface RoutingConfig {
  version: number;
  routing: Record<string, DomainRouting>;
}

export interface ProviderEntry {
  engine: string;
  required?: boolean;
  fallback?: string;
  fresh_context?: boolean;
  auto_select?: boolean;
  /** Execution provider only: 'delegated' (hand prompt packs to an agent) or 'command'. */
  mode?: 'delegated' | 'command';
  /** Execution provider in `command` mode: shell template with {{prompt_file}} placeholders. */
  command?: string;
}

export interface ProvidersConfig {
  version: number;
  providers: Record<string, ProviderEntry>;
}
