import { AgentProductId } from '../types/integrations.js';
import {
  RulesTemplateOptions,
  processLabel,
  processShortLabel,
  renderWorkspaceRules,
} from './rules-templates.js';

/**
 * Per-product renderings of one single protocol.
 *
 * The protocol itself lives in `rules-templates.ts`. This module only answers
 * "what does *this* product read, and how does the user trigger the workflow in
 * it", so a team using Claude Code, Antigravity, Gemini CLI, Codex, Cursor,
 * Copilot and plain ChatGPT at the same time still follows one workflow.
 */

const ENTRY_POINTS: Record<AgentProductId, string> = {
  claude: '/agentic <request>',
  antigravity: '/agentic <request>',
  gemini: '/agentic <request>',
  codex: 'ask normally - AGENTS.md governs the session',
  chatgpt: 'paste .agentic/agents/CHATGPT.md, then describe the task',
  cursor: 'ask normally - the always-on rule governs the session',
  copilot: 'ask normally - copilot-instructions.md governs the session',
  windsurf: 'ask normally - .windsurfrules governs the session',
};

export function entryPointFor(product: AgentProductId): string {
  return ENTRY_POINTS[product];
}

/**
 * Product-specific preamble prepended to the shared rules, telling the agent
 * exactly which affordances it has in this environment.
 */
export function renderProductPreamble(product: AgentProductId): string {
  switch (product) {
    case 'claude':
      return `> **You are running in Claude Code.**
> Slash commands: \`/agentic\`, \`/agentic-grill\`, \`/agentic-verify\`, \`/agentic-gate\`,
> \`/agentic-team\`, \`/agentic-skills\`, \`/agentic-status\`, \`/agentic-doctor\`, \`/agentic-run\`.
> The \`agentic\` skill in \`.claude/skills/agentic/\` carries the full protocol, and
> \`agentic\` commands are pre-approved in \`.claude/settings.json\`.
`;
    case 'antigravity':
      return `> **You are running in Google Antigravity.**
> Workflows (type \`/\` in the agent chat): \`/agentic\`, \`/agentic-verify\`, \`/agentic-grill\`,
> \`/agentic-status\`. The \`agentic\` skill in \`.agents/skills/agentic/SKILL.md\` carries the
> full protocol and is loaded automatically for engineering tasks.
`;
    case 'gemini':
      return `> **You are running in Gemini CLI.**
> Custom commands: \`/agentic\`, \`/agentic:verify\`, \`/agentic:grill\`, \`/agentic:status\`,
> \`/agentic:gate\`, \`/agentic:skills\` (defined in \`.gemini/commands/\`).
> Run shell commands with the \`run_shell_command\` tool.
`;
    case 'codex':
      return `> **You are running in OpenAI Codex.**
> There are no slash commands here: this file is your standing instruction. Every
> engineering request goes through the two-phase flow below, using the \`agentic\` CLI
> from the shell.
`;
    case 'chatgpt':
      return `> **You are ChatGPT working on this repository through a human operator.**
> You cannot run commands yourself. Emit the exact \`agentic\` commands for the operator
> to run, and wait for their output before continuing. Never assume a command succeeded.
`;
    case 'cursor':
      return `> **You are running in Cursor.**
> This rule is always applied. Run \`agentic\` commands in the terminal.
`;
    case 'copilot':
      return `> **You are GitHub Copilot in this repository.**
> These instructions apply to every request. Run \`agentic\` commands in the terminal.
`;
    case 'windsurf':
      return `> **You are running in Windsurf.**
> These rules apply to every request. Run \`agentic\` commands in the terminal.
`;
    default:
      return '';
  }
}

/** Full rules file for a product that reads a long markdown instruction file. */
export function renderProductRules(product: AgentProductId, options: RulesTemplateOptions): string {
  return `${renderProductPreamble(product)}\n${renderWorkspaceRules(options)}`;
}

/**
 * Short protocol, for files that are injected into *every* request (Cursor
 * rules, Copilot instructions, Windsurf rules). Long files get truncated or
 * eat the context budget, so this keeps only what changes behaviour.
 */
export function renderCompactProtocol(options: RulesTemplateOptions): string {
  const label = processShortLabel(options.processEngine);

  return `# Agentic SDLC - Mandatory Workflow

This repository is governed by the Agentic SDLC Orchestrator. Every feature, bugfix or
refactor goes through the \`agentic\` CLI. You write the code; the CLI structures the work
and decides what is DONE.

## Two-phase flow

\`\`\`bash
agentic prompt "<the request>"     # 1. structures + specifies + gates + dispatches
# implement each pack in .agentic/execution/inbox/ with strict TDD
agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>
agentic verify                     # 2. runs the suite, verifies, closes with evidence
\`\`\`

A run in state \`AWAITING_AGENT\` is waiting for you to implement, not broken.

## Rules you cannot break

1. Read the task's prompt pack in \`.agentic/execution/inbox/<TASK-ID>.md\` before coding:
   it holds the acceptance criteria, the binding ADRs and your WRITE/READ-ONLY/FORBIDDEN paths.
2. Only touch paths listed as WRITE. Otherwise report \`blocked\` and explain.
3. Strict TDD (${label}): failing test first, minimum code, then refactor. Never weaken,
   skip or delete a test to reach green.
4. Never claim tests pass without the executed output. Never mark a requirement DONE:
   only \`agentic verify\` closes work, from a real test run.
5. Identifiers (\`REQ-###\`, \`SPEC-###\`, \`AC-###.#\`, \`ADR-###\`) come from the registry.
   Never invent one.
6. \`HUMAN_GATE\` means a human must decide (\`agentic gate list\`). Stop and report it.
7. Before driving a phase, check \`agentic team who\`; claim it with \`agentic team claim <phase>\`.
8. Use the team's mapped skill for the step: \`agentic skills stage <stage> --installed\`.

## Orientation

\`agentic status\` (where the cycle is) - \`agentic doctor\` (readiness) - full protocol in \`AGENTS.md\`.
`;
}

/** Paste-ready bootstrap for products with no repository integration. */
export function renderChatGptBootstrap(options: RulesTemplateOptions): string {
  return `# ChatGPT Bootstrap - Agentic SDLC

Paste this whole file into a new ChatGPT conversation before describing your task.
(In Codex or any agent with repository access, use \`AGENTS.md\` instead: it is read automatically.)

---

${renderProductPreamble('chatgpt')}
${renderCompactProtocol(options)}

---

## How our exchange works

1. I describe the task.
2. You reply with the exact command to run, and nothing else:
   \`agentic prompt "<the task, restated precisely>"\`
3. I paste the output. If the status is \`HUMAN_GATE\`, you explain the risk and ask me to
   decide. If it is \`AWAITING_AGENT\`, you ask me for the contents of
   \`.agentic/execution/inbox/INDEX.md\` and of each task's prompt pack.
4. For each task, you produce: the failing test first, then the implementation, then the
   commands to run. You never assume a test passed - you wait for the output I paste back.
5. When a task is done you give me:
   \`agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>\`
6. To close, you give me \`agentic verify\` and interpret its result honestly:
   \`COMPLETE\` (closed with evidence), \`FAIL\`/\`REMEDIATING\` (fix and re-verify), or
   \`BLOCKED\` (closure refused - say so plainly).

Never write "done" for something that has not been verified with executed evidence.
`;
}

export interface GeminiCommandFile {
  /** Path under `.gemini/commands/`, e.g. `agentic.toml` or `agentic/verify.toml`. */
  file: string;
  content: string;
}

/**
 * Gemini CLI custom commands: TOML files under `.gemini/commands/`, where a
 * subdirectory becomes a namespace (`agentic/verify.toml` -> `/agentic:verify`)
 * and `{{args}}` receives whatever the user typed after the command.
 */
export function renderGeminiCommands(options: RulesTemplateOptions): GeminiCommandFile[] {
  const label = processLabel(options.processEngine);

  const toml = (description: string, prompt: string) =>
    `description = "${description}"\n\nprompt = """\n${prompt}\n"""\n`;

  return [
    {
      file: 'agentic.toml',
      content: toml(
        'Deliver a request through the governed Agentic SDLC cycle',
        `Deliver this request through the Agentic SDLC cycle: {{args}}

Follow this protocol exactly.

1. Structure and dispatch the work:
   run_shell_command: agentic prompt "{{args}}"
   - If the status is HUMAN_GATE: stop, explain which gate blocks it, and tell me to run
     \`agentic gate list\`.
   - If the status is AWAITING_AGENT: continue.

2. Read the work orders: .agentic/execution/inbox/INDEX.md for the wave order, then each
   .agentic/execution/inbox/<TASK-ID>.md (acceptance criteria, binding ADRs, ownership
   boundaries, assumptions in force).

3. Inspect the real code, tests and configuration involved before changing anything.
   Contradicting evidence in the codebase overrides any assumption in the pack.

4. Implement each task with ${label}:
   - RED: write the failing test that encodes every AC-###.# in the pack, run the suite.
   - GREEN: the minimum implementation that passes.
   - REFACTOR: remove duplication, keep types strict.
   Only touch paths listed as WRITE. One atomic commit per task.

5. Report each task:
   run_shell_command: agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>

6. Close the cycle with real evidence:
   run_shell_command: agentic verify

7. Summarize: what changed, which ADRs applied, the evidence id and its counters, and
   anything still open (assumptions, gates, blocked tasks).

Never claim tests pass without the executed output, and never declare success on a
BLOCKED, FAIL or REMEDIATING outcome.`
      ),
    },
    {
      file: 'agentic/verify.toml',
      content: toml(
        'Close the current cycle with real test evidence',
        `Close the current Agentic SDLC cycle.

1. run_shell_command: agentic status
2. Report any task you finished but did not report yet:
   agentic report <TASK-ID> --status completed --commit <sha>
3. run_shell_command: agentic verify

Interpret the outcome honestly:
- COMPLETE: requirements closed against evidence. Report the evidence id and counters.
- FAIL or REMEDIATING: the suite or an acceptance criterion failed. Fix, then re-verify.
- BLOCKED: closure was refused (no executable evidence, or missing acceptance criteria).
  Say so plainly instead of implying success.`
      ),
    },
    {
      file: 'agentic/grill.toml',
      content: toml(
        'Probe a request for ambiguities and record the decisions',
        `Interrogate this request before any code is written: {{args}}

1. run_shell_command: agentic grill "{{args}}"
2. Every probe marked ASSUMED DEFAULT is an open question, not a decision. Put the real
   choices to me with their trade-offs.
3. Collect my answers into answers.json: { "GRILL-001": "...", "GRILL-003": "..." }
4. Ratify them (this promotes the ADR from PROPOSED to ACCEPTED):
   run_shell_command: agentic grill "{{args}}" --answers answers.json
5. Only then deliver: agentic prompt "{{args}}" --answers answers.json`
      ),
    },
    {
      file: 'agentic/status.toml',
      content: toml(
        'Show where the delivery cycle currently stands',
        `run_shell_command: agentic status

Report the state, the requirement and task counters, the evidence line, pending gates,
active team claims and the printed next action. A test status of "not measured" is
unknown - never report it as green.`
      ),
    },
    {
      file: 'agentic/gate.toml',
      content: toml(
        'Review and decide pending human gates',
        `1. run_shell_command: agentic gate list
2. For each gate, explain in plain language what it protects, what the run intends to do,
   and the consequence of approving it. Do not decide on my behalf.
3. Record my decision:
   agentic gate approve <GATE-ID> --note "<rationale>"
   agentic gate reject  <GATE-ID> --note "<rationale>"
4. Continue: agentic run`
      ),
    },
    {
      file: 'agentic/skills.toml',
      content: toml(
        'Show the team skills mapped to each stage of the cycle',
        `run_shell_command: agentic skills

Then, for the stage we are in: agentic skills stage <stage> --installed

Use the team's mapped skill instead of improvising. If a mapped skill is not installed on
this machine, say so and use the native path rather than silently diverging.`
      ),
    },
  ];
}

export interface WorkflowFile {
  file: string;
  content: string;
}

/**
 * Antigravity workflows: saved prompts under `.agents/workflows/`, triggered
 * with `/` in the agent chat.
 */
export function renderAntigravityWorkflows(options: RulesTemplateOptions): WorkflowFile[] {
  const label = processLabel(options.processEngine);

  return [
    {
      file: 'agentic.md',
      content: `# /agentic - Governed Delivery

Deliver the user's request through the Agentic SDLC cycle.

1. Structure and dispatch: \`agentic prompt "<the request>"\`.
   - \`HUMAN_GATE\`: stop, explain the blocking gate, point to \`agentic gate list\`.
   - \`AWAITING_AGENT\`: continue.
2. Read \`.agentic/execution/inbox/INDEX.md\`, then each \`<TASK-ID>.md\` prompt pack
   (acceptance criteria, binding ADRs, WRITE/READ-ONLY/FORBIDDEN paths, assumptions).
3. Inspect the real code and tests before changing anything. Reality overrides assumptions.
4. Implement with ${label}: failing test first, minimum code, then refactor. Only owned
   paths. One atomic commit per task.
5. Report: \`agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>\`.
6. Close: \`agentic verify\`.
7. Summarize changes, ADRs applied, evidence id and counters, and anything still open.

Never claim tests pass without executed output. Never declare success on BLOCKED, FAIL or
REMEDIATING.
`,
    },
    {
      file: 'agentic-verify.md',
      content: `# /agentic-verify - Close With Evidence

1. \`agentic status\` - see what is still awaiting a report.
2. \`agentic report <TASK-ID> --status completed --commit <sha>\` for anything finished.
3. \`agentic verify\` - runs the real suite, verifies each acceptance criterion, writes the
   as-built spec and updates the requirement matrix.

\`COMPLETE\` closes the cycle; \`FAIL\`/\`REMEDIATING\` needs a fix; \`BLOCKED\` means closure was
refused - report that plainly.
`,
    },
    {
      file: 'agentic-grill.md',
      content: `# /agentic-grill - Probe And Record Decisions

1. \`agentic grill "<the request>"\`.
2. Probes marked ASSUMED DEFAULT are open questions, not decisions. Put the real options to
   the user with their trade-offs.
3. Save the answers to \`answers.json\` keyed by probe id.
4. \`agentic grill "<the request>" --answers answers.json\` ratifies the ADR (PROPOSED -> ACCEPTED).
5. Deliver with \`agentic prompt "<the request>" --answers answers.json\`.
`,
    },
    {
      file: 'agentic-status.md',
      content: `# /agentic-status - Cycle Dashboard

Run \`agentic status\` and report the state, counters, evidence line, pending gates, active
claims and the printed next action. A test status of "not measured" is unknown, never green.

Then \`agentic doctor\` if anything looks off, and relay failures with their exact details.
`,
    },
  ];
}

export interface ClaudeSettingsPatch {
  permissions: { allow: string[] };
  hooks?: Record<string, unknown[]>;
}

/**
 * Claude Code project settings: pre-approve the framework's own commands (so the
 * workflow is not interrupted by a prompt on every step) and, optionally, show
 * the cycle state at session start so the agent always knows whether a run is
 * already awaiting implementation.
 *
 * Only read-only/idempotent commands are pre-approved. Anything that decides a
 * gate, forces a lease takeover or installs software stays interactive.
 */
export function renderClaudeSettings(options: { includeHooks?: boolean } = {}): ClaudeSettingsPatch {
  const patch: ClaudeSettingsPatch = {
    permissions: {
      allow: [
        'Bash(agentic status)',
        'Bash(agentic status:*)',
        'Bash(agentic doctor)',
        'Bash(agentic doctor:*)',
        'Bash(agentic observe:*)',
        'Bash(agentic reconcile:*)',
        'Bash(agentic prompt:*)',
        'Bash(agentic do:*)',
        'Bash(agentic grill:*)',
        'Bash(agentic spec:*)',
        'Bash(agentic run:*)',
        'Bash(agentic report:*)',
        'Bash(agentic verify:*)',
        'Bash(agentic evidence:*)',
        'Bash(agentic gate list)',
        'Bash(agentic skills:*)',
        'Bash(agentic team who)',
        'Bash(agentic team claim:*)',
        'Bash(agentic audit:*)',
        'Bash(agentic ids:*)',
        'Bash(agentic resume)',
      ],
    },
  };

  if (options.includeHooks !== false) {
    patch.hooks = {
      SessionStart: [
        {
          hooks: [
            {
              type: 'command',
              command: 'agentic status',
              timeout: 30,
            },
          ],
        },
      ],
    };
  }

  return patch;
}
