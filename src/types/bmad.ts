export interface BmadBriefing {
  raw_prompt: string;
  enhanced_prompt: string;
  title: string;
  business: {
    objective: string;
    stakeholders: string[];
    value_proposition: string;
    scope_in: string[];
    scope_out: string[];
    business_rules: string[];
  };
  modeling: {
    domain_entities: string[];
    state_models: string[];
    lifecycle_events: string[];
    data_contracts: string[];
  };
  architecture: {
    style: string;
    patterns: string[];
    components: string[];
    integration_points: string[];
    security_boundaries: string[];
    performance_nfrs: string[];
  };
  delivery: {
    slices: string[];
    testability_strategy: string;
    key_risks: string[];
  };
  metadata: {
    engine: 'bmad-method';
    version: string;
    generated_at: string;
  };
}
