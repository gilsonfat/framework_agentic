export interface GrillMeQuestion {
  id: string;
  category: 'ambiguity' | 'edge_case' | 'trade_off' | 'failure_mode' | 'security' | 'performance';
  question: string;
  context: string;
  options?: string[];
  recommended_option?: string;
  resolved_answer: string;
  rationale: string;
  /**
   * True when `resolved_answer` is the engine's default rather than a human
   * decision. An assumption is not a decision: it is carried into the prompt
   * pack as an explicit assumption and keeps the ADR in PROPOSED status.
   */
  assumed: boolean;
  answered_by?: string;
}

export interface GrillMeResult {
  raw_prompt: string;
  interrogation_summary: string;
  probes: GrillMeQuestion[];
  /** Questions with no human answer, carried forward as open risk. */
  unresolved_items: string[];
  /** Answers the engine defaulted to, which a human still has to confirm. */
  assumptions: string[];
  resolved_at: string;
  interactive: boolean;
  /** True when every probe was answered by a human. */
  fully_resolved: boolean;
}

export interface DecisionRecord {
  id: string;
  title: string;
  status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'SUPERSEDED';
  date: string;
  context: string;
  decision: string;
  alternatives_considered: Array<{
    option: string;
    pros: string[];
    cons: string[];
  }>;
  consequences: {
    positive: string[];
    negative: string[];
    risks: string[];
  };
  trade_offs: string[];
  verification_criteria: string[];
  linked_requirements: string[];
}
