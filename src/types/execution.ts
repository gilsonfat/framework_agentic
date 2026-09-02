import { TaskContract } from './task.js';

export type ExecutionMode = 'delegated' | 'command';

export type TaskResultStatus = 'completed' | 'failed' | 'blocked' | 'pending';

export interface TaskResult {
  task_id: string;
  run_id: string;
  status: TaskResultStatus;
  /** Who reported the result: an agent id, a CLI actor, or a command. */
  reported_by: string;
  reported_at: string;
  files_changed: string[];
  tests_added: string[];
  commit?: string;
  /** Reference to the evidence record produced for this task, when any. */
  evidence_id?: string;
  notes?: string[];
  error?: string;
}

export interface DispatchedTask {
  task_id: string;
  wave: number;
  contract_file: string;
  prompt_file: string;
  domain: string;
  skills: string[];
  agent: string;
}

export interface DispatchResult {
  run_id: string;
  mode: ExecutionMode;
  dispatched: DispatchedTask[];
  /** Tasks with no reported result yet. */
  awaiting: string[];
  results: TaskResult[];
  index_file: string;
}

export interface PromptPackInput {
  runId: string;
  contract: TaskContract;
  wave: number;
  totalWaves: number;
  goal: string;
  specFile?: string;
  decisionRefs?: string[];
  skills: string[];
  agent: string;
  testCommand: string;
  openQuestions?: string[];
  assumptions?: string[];
  /** Pre-rendered "Skills To Use" markdown from the SkillRegistry. */
  skillGuidance?: string;
}
