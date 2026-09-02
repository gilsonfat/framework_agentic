export interface SpecKitScenario {
  id: string;
  name: string;
  given: string;
  when: string;
  then: string;
  edge_cases?: string[];
}

export interface SpecKitRequirement {
  id: string;
  title: string;
  statement: string;
  acceptance_criteria: Array<{
    id: string;
    description: string;
    executable_check: string;
  }>;
  scenarios: SpecKitScenario[];
  dependencies: string[];
  decision_refs: string[];
}

export interface GitHubSpecKitDocument {
  spec_id: string;
  title: string;
  version: string;
  status: 'DRAFT' | 'PLANNED' | 'VERIFIED' | 'SUPERSEDED';
  milestone: string;
  phase: string;
  overview: {
    problem_statement: string;
    target_outcomes: string[];
    user_stories: string[];
    boundaries: {
      in_scope: string[];
      out_of_scope: string[];
    };
  };
  contracts: {
    inputs: Array<{ name: string; type: string; required: boolean; description: string }>;
    outputs: Array<{ name: string; type: string; description: string }>;
    error_envelopes: Array<{ code: string; message: string; recovery: string }>;
  };
  requirements: SpecKitRequirement[];
  non_functional_requirements: {
    security: string[];
    performance: string[];
    reliability: string[];
  };
  decisions_log: string[];
  bmad_reference?: {
    briefing_title: string;
    engine: string;
  };
  created_at: string;
}
