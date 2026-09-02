/**
 * Skill packs: external, agent-invocable skill collections that the framework
 * recommends at specific stages of the cycle.
 *
 * The framework never *depends* on a pack (every stage has a native path), but
 * when a pack is installed the prompt packs tell the implementing agent exactly
 * which skill to invoke, so a whole team uses the same technique at the same
 * step instead of improvising per developer.
 */

/** Stages of the cycle a skill can be attached to. */
export type SkillStage =
  | 'observe'
  | 'research'
  | 'refine'
  | 'probe'
  | 'specify'
  | 'architect'
  | 'compile'
  | 'prototype'
  | 'implement'
  | 'review'
  | 'verify'
  | 'remediate'
  | 'merge'
  | 'handoff'
  | 'triage'
  | 'plan_multi_session';

export interface SkillPackInstall {
  /** Command for Claude Code (plugin marketplace). */
  claude?: string;
  /** Command for any other agent supporting the `skills` installer. */
  generic?: string;
  /** Slash command to run once per repository after installing. */
  post_install?: string;
}

export interface SkillPack {
  /** Human-readable pack name. */
  name: string;
  /** Upstream source, e.g. `mattpocock/skills`. */
  source: string;
  /** How the agent invokes a skill from this pack (`/{skill}` by default). */
  invocation?: string;
  install?: SkillPackInstall;
  /** Glob-ish paths (relative to the project or to $HOME) proving installation. */
  detect?: string[];
  /** Stage -> ordered list of skill slugs. */
  stages?: Partial<Record<SkillStage, string[]>>;
  /** Domain -> extra skill slugs, added on top of the stage skills. */
  domains?: Record<string, string[]>;
  /** Skills whose name collides with a framework command, and how to disambiguate. */
  aliases?: Record<string, string>;
  enabled?: boolean;
}

export interface SkillsConfig {
  version: number;
  packs: Record<string, SkillPack>;
}

export interface SkillRecommendation {
  pack: string;
  packName: string;
  skill: string;
  /** What the agent literally types, e.g. `/tdd`. */
  invocation: string;
  installed: boolean;
  stage: SkillStage;
  note?: string;
}

export interface SkillPackStatus {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  installed: boolean;
  /** Where it was detected, when it was. */
  detectedAt?: string;
  installCommands: string[];
  postInstall?: string;
  stagesCovered: SkillStage[];
}

export const DEFAULT_SKILLS_CONFIG: SkillsConfig = { version: 1, packs: {} };
