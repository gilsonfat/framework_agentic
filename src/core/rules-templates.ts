/**
 * Canonical instruction templates written into a project by `agentic setup`.
 *
 * These files are how a *team* shares one standard: every agent (Claude Code,
 * Antigravity/Gemini, Codex) and every developer reads the same protocol, the
 * same evidence rule and the same coordination rules. Keeping them in one module
 * means the CLI, the slash commands and the skill can never drift apart.
 */

export interface RulesTemplateOptions {
  processEngine: 'superpowers' | 'ecc' | 'native' | string;
}

/** Short form, for lines where the full parenthetical would read badly. */
export function processShortLabel(engine: string): string {
  if (engine === 'ecc') return 'ECC';
  if (engine === 'superpowers') return 'Superpowers';
  return 'native TDD';
}

export function processLabel(engine: string): string {
  if (engine === 'ecc') return 'ECC (tdd-workflow, verification-loop, security-review)';
  if (engine === 'superpowers') return 'SUPERPOWERS (strict TDD and systematic debugging)';
  return 'NATIVE TDD (Red-Green-Refactor)';
}

/** Shared workspace rules: AGENTS.md, CLAUDE.md, GEMINI.md, CODEX.md. */
export function renderWorkspaceRules(options: RulesTemplateOptions): string {
  const label = processLabel(options.processEngine);

  return `# AGENTIC SDLC ORCHESTRATOR - WORKSPACE INSTRUCTIONS

> **MANDATORY FOR EVERY AI ASSISTANT AND CODING AGENT** (Claude Code, Antigravity/Gemini, Codex, Cursor, humans included).
> This repository is governed by the Agentic SDLC Orchestrator: Grill-Me probing, ADR
> decisions, Spec Kit contracts, strict TDD, and **evidence-gated closure**.

---

## 0. Lost? One Command

\`\`\`bash
agentic next
\`\`\`

It reads the real state and prints the single next step: initialize, migrate, decide a
gate, implement a task, verify, or start the next phase. Every other section of this
document explains *why* that step is what it is.

---

## 1. How Work Enters This Repository

The framework separates three responsibilities and never blurs them:

| Responsibility | Owner | Never done by |
| :--- | :--- | :--- |
| Structuring, specifying, gating, auditing | \`agentic\` CLI (deterministic) | the agent |
| Writing code and tests | you, the coding agent | the CLI |
| Deciding something is DONE | the verifier, from executed test output | either of the above |

So a task runs in **two phases**:

\`\`\`bash
# Phase 1 - structure and dispatch (produces prompt packs, no code)
agentic prompt "<instruction>"

# ... you implement each pack in .agentic/execution/inbox/ with strict TDD ...
agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>

# Phase 2 - close with real evidence (runs the suite, verifies, writes as-built)
agentic verify
\`\`\`

A run that has been dispatched sits in state \`AWAITING_AGENT\`. That is normal and it is
**not** a failure: it means the framework is waiting for implementation. Nothing is marked
DONE until \`agentic verify\` collects an evidence record from a real test execution.

---

## 2. Non-Negotiable Rules

1. **Observed state beats declared state.** Inspect the repo (git status, tests, migrations,
   schemas) before believing any document, including these instructions.
2. **A test status you did not measure is unknown, never green.** \`pending\` means not measured.
3. **No requirement is DONE without executed evidence.** \`implemented && tested && verified\`,
   backed by an evidence record id.
4. **An assumption is not a decision.** Unanswered Grill-Me probes are carried as explicit
   assumptions and keep the ADR in \`PROPOSED\`. Answer them (\`--answers file.json\`) to ratify.
5. **Specify before implementing.** Stable ids from the registry: \`REQ-###\`, \`SPEC-###\`,
   \`AC-###.#\`, \`ADR-###\`, \`TASK-###\`. Never invent an id by hand.
6. **Strict TDD.** RED (failing test that encodes each AC) -> GREEN (minimum code) -> REFACTOR.
   Never weaken, skip or delete a test to reach green. The prompt pack states whether TDD is
   \`required\` for this change kind; if it is, \`agentic report\` **rejects** a completed task
   with no \`--tests\`, and an atomic \`--commit\` that resolves in git is mandatory.
7. **Respect ownership.** A task prompt pack lists WRITE / READ-ONLY / FORBIDDEN paths.
   Touching anything outside WRITE invalidates the task: report \`blocked\` instead.
8. **Human gates block.** Security, authentication, destructive migrations, XL complexity and
   exhausted remediation stop the run until a human decides (\`agentic gate approve <id>\`).
9. **Documentation comes from reality.** As-built specs are generated from the diff and the
   evidence, never written aspirationally.
10. **A state you cannot read is not a state.** If \`agentic status\` reports LEGACY or
   UNREADABLE, the artifacts came from another build: run \`agentic migrate --apply\` (or
   update the CLI) before trusting anything it says.

---

## 3. The 12-Step Cycle

1. **OBSERVE** - real git/test/migration state (\`agentic observe --tests\` measures the suite).
2. **RECONCILE** - declared vs observed; \`--sync\` rewrites the declaration from reality.
3. **PROBE & DECIDE** - Grill-Me probes and ADRs in \`.agentic/specs/decisions/\`.
4. **PLAN & SPECIFY** - work package plus Spec Kit contract in \`.agentic/specs/planned/\`.
5. **HUMAN GATES** - evaluated before any dispatch; pending gates stop the run.
6. **COMPILE DAG** - Kahn ordering, cycle detection, write-conflict detection.
7. **DISPATCH** - one prompt pack per task in \`.agentic/execution/inbox/\`, in wave order. Tasks
   sharing a wave get their own git worktree; work inside it, never in the main checkout.
8. **IMPLEMENT (${label})** - the agent's job: TDD, owned paths only, one atomic commit per task.
9. **REPORT** - \`agentic report <TASK-ID> --status completed|blocked\`.
10. **REVIEW** - L1 self, L2 suite regression, L3 acceptance criteria, L4 security (read-only).
11. **VERIFY** - fresh verifier over executed evidence. FAIL -> remediation (max 3, then a gate).
12. **AS-BUILT & STATE** - as-built spec, requirement matrix, declared state re-synced, and
   any phase whose requirements are all evidence-backed is closed on the roadmap.

---

## 4. Working As A Team

- **Claim before you drive a phase**: \`agentic team claim P-012 --note "checkout"\`. The
  orchestrator refuses to run a phase claimed by someone else (\`--force\` takes over deliberately).
- **See who holds what**: \`agentic team who\`.
- **Shared vs local artifacts**: specs, decisions, planning, gates, registry and the requirement
  matrix are committed team truth. Observed state, runs, evidence, inbox, results and leases are
  machine-local (see \`.agentic/.gitignore\`).
- **The audit stream merges by union** (\`.gitattributes\`) and is a SHA-256 hash chain:
  \`agentic audit verify\` detects edits and deletions.
- **Identity matters**: every event, lease, gate decision and closure records \`git config user.email\`.

---

## 5. The Roadmap (milestones and phases)

\`.agentic/planning/roadmap.yaml\` is shared team truth: which milestone is active, which
phases belong to it, and which requirements each phase carries. Every run registers its
phase there automatically.

- A **phase closes** when every requirement it carries is closed **against an evidence
  record**. A closure with no usable evidence blocks the phase instead of advancing it.
- A **milestone closes** when all its phases are complete; the next planned one is activated.
- Opening a milestone goes through the \`new_milestone\` human gate: it stays \`planned\` until
  someone approves it.

\`\`\`bash
agentic milestone status     # progress measured against evidence
agentic milestone advance    # close what can honestly be closed
\`\`\`

Never edit the roadmap to mark something done. If a phase will not close, the reason is in
\`agentic milestone status\` and it is always the same kind of reason: something claims to be
done without proof.

---

## 6. Skill Packs (shared techniques)

The framework maps external skills to stages of the cycle in
\`.agentic/orchestrator/skills.yaml\`, so everyone applies the same technique at the
same step. \`agentic skills\` shows what is mapped and what is actually installed here.

Currently mapped (\`mattpocock/skills\`):

| Stage | Skill | Use it to |
| :--- | :--- | :--- |
| refine | \`/grill-with-docs\`, \`/domain-modeling\` | deepen the domain understanding and the terminology |
| probe | \`/grill-me\`, \`/grilling\` | run the live interview over the open probes |
| specify | \`/to-spec\` | enrich the generated SPEC (registry ids stay authoritative) |
| architect | \`/codebase-design\`, \`/improve-codebase-architecture\` | module boundaries and refactoring opportunities |
| compile | \`/to-tickets\` | decompose a work package (the task DAG stays authoritative) |
| implement | \`/implement\`, \`/tdd\` | the red-green-refactor loop itself |
| review | \`/code-review\` | review layers L1 and L3 |
| remediate | \`/diagnosing-bugs\` | systematic debugging when a test will not go green |
| merge | \`/resolving-merge-conflicts\` | resolve conflicts by intent |
| handoff | \`/handoff\` | compact the session before a context reset |

Install it with \`agentic skills install mattpocock\` (add \`--run\` to execute), then run
\`/setup-matt-pocock-skills\` once per repository.

Two boundaries never move, whichever skill you use:

- **Identifiers** come from the registry (\`REQ-###\`, \`SPEC-###\`, \`AC-###.#\`, \`ADR-###\`).
  A skill may enrich a spec; it may not mint an id.
- **Evidence** comes from \`agentic verify\`. A skill reporting "tests pass" is not evidence.

Note on naming: \`/grill-me\` is the pack's interview skill. The framework's own
deterministic probe list plus ADR recording is \`/agentic-grill\` (CLI: \`agentic grill\`).
They compose: the CLI produces the question set, the skill conducts the conversation.

---

## 7. Command Reference

| Command | Purpose |
| :--- | :--- |
| \`agentic prompt "<x>"\` (\`do\`) | Structure an instruction and dispatch prompt packs |
| \`agentic report <TASK> --status <s>\` | Report a task outcome back to the orchestrator |
| \`agentic verify\` | Collect evidence, verify, generate as-built, update state |
| \`agentic run [--phase P-012]\` | Run or resume the cycle |
| \`agentic grill "<x>" [--answers f.json]\` | Adversarial probing and ADR recording |
| \`agentic spec "<x>"\` | Spec Kit contract only |
| \`agentic evidence [--show]\` | Execute the suite and record evidence |
| \`agentic gate list \\| approve <id> \\| reject <id>\` | Human gate decisions |
| \`agentic team init \\| who \\| claim <scope> \\| release <scope>\` | Team coordination |
| \`agentic skills [list \\| stage <s> \\| install <pack>]\` | Skill packs mapped per stage, and their real availability |
| \`agentic audit verify \\| tail\` | Audit stream integrity and history |
| \`agentic observe [--tests]\` / \`agentic reconcile [--sync]\` | State inspection and repair |
| \`agentic migrate [--apply]\` | Bring \`.agentic\` artifacts to the current schema version |
| \`agentic prompt "<x>" --split "<a>" --split "<b>" [--parallel]\` | Decompose an epic into slices, each with its own REQ, spec and task |
| \`agentic worktree list \\| clean\` | Isolated checkouts created for parallel waves |
| \`agentic next\` | What to do now, resolved from the real state |
| \`agentic milestone status \\| list \\| new \\| activate \\| advance\` | Roadmap: phases and milestones |
| \`agentic status\` / \`agentic doctor\` / \`agentic ids\` | Dashboard, diagnostics, identifiers |
| \`agentic resume [--apply]\` | Inspect and resume an interrupted run |
`;
}

/** Antigravity / generic agent skill definition. */
export function renderAgentSkill(options: RulesTemplateOptions): string {
  const label = processLabel(options.processEngine);

  return `---
name: agentic
description: Deliver any task, feature, bugfix or refactoring through the Agentic SDLC cycle - Grill-Me probing, ADR decisions, Spec Kit contracts, DAG dispatch, strict TDD, 4-layer review, evidence-gated verification and as-built documentation.
---

# Agentic SDLC Orchestrator Skill

You are the implementing agent inside a governed cycle. The \`agentic\` CLI structures and
enforces; you write code and tests; the verifier decides what is DONE from executed evidence.

## Protocol

1. **Structure the request** (never skip: it allocates ids, records decisions and gates risk):
   \`\`\`bash
   agentic prompt "<the user request>"
   \`\`\`
   Read the printed status. If it is \`HUMAN_GATE\`, stop and tell the user which gate blocks it.
   If it is \`AWAITING_AGENT\`, continue.

2. **Read your work orders**: \`.agentic/execution/inbox/INDEX.md\` gives the wave order, and
   \`.agentic/execution/inbox/<TASK-ID>.md\` is a self-contained prompt pack with the acceptance
   criteria, the binding ADRs, the ownership boundaries and the assumptions in force.

3. **Inspect reality before changing it**: find the real handlers, tests and configs involved.
   Contradicting evidence in the codebase overrides any assumption in the pack - report it.

4. **Check the shared technique for this step**: the prompt pack has a
   "Skills To Use" section, and \`agentic skills stage implement --installed\` lists what
   is available here. Use the team's mapped skill instead of improvising; if it is not
   installed, use the native path and say so.

5. **Implement with ${label}**:
   - RED: write the failing test that encodes each \`AC-###.#\`; run the suite and keep the output.
   - GREEN: minimum implementation to pass.
   - REFACTOR: remove duplication, keep types strict.
   - Only touch paths listed as WRITE. One atomic commit per task.

6. **Report each task**:
   \`\`\`bash
   agentic report <TASK-ID> --status completed --files "<changed files>" --tests "<test files>" --commit <sha>
   \`\`\`
   Blocked instead? \`agentic report <TASK-ID> --status blocked --note "<why>"\`.

7. **Close the cycle**:
   \`\`\`bash
   agentic verify
   \`\`\`
   This runs the real suite, verifies each acceptance criterion, writes the as-built spec and
   updates the requirement matrix. \`BLOCKED\` means closure was refused - never report success.

8. **Report to the user**: what changed, which ADRs applied, the evidence id with its counters,
   and anything still open (assumptions, gates, blocked tasks).

## Absolute Rules

- Never claim tests pass without the executed output.
- Never mark a requirement DONE yourself; only \`agentic verify\` closes work.
- Never write outside your task's WRITE paths.
- Never turn an unanswered probe into a silent decision.
- Never let a skill mint an identifier or declare work done: ids come from the registry,
  closure comes from \`agentic verify\`.
`;
}

export interface SlashCommand {
  file: string;
  content: string;
}

/** Claude Code slash commands. */
export function renderSlashCommands(options: RulesTemplateOptions): SlashCommand[] {
  const label = processLabel(options.processEngine);

  return [
    {
      file: 'agentic.md',
      content: `# /agentic - Governed Delivery

Deliver \`$*\` through the Agentic SDLC cycle. The CLI structures and enforces; you implement.

## Protocol

1. **Structure and dispatch**:
   \`\`\`bash
   agentic prompt "$*"
   \`\`\`
   - Status \`HUMAN_GATE\`: stop, report the pending gate, ask the user to run \`agentic gate list\`.
   - Status \`AWAITING_AGENT\`: continue below.

2. **Read the work orders**: \`.agentic/execution/inbox/INDEX.md\`, then each
   \`.agentic/execution/inbox/<TASK-ID>.md\` (acceptance criteria, ADRs, ownership, assumptions).

3. **Observe reality**: locate the real code, tests and config for \`$*\`. Identify the project's
   test command. Reality overrides any assumption in the pack.

4. **Implement with ${label}** - per task, in wave order:
   - RED: failing test encoding every \`AC-###.#\`; run the suite, keep the output.
   - GREEN: minimum implementation.
   - REFACTOR: clean up, keep types strict.
   - Stay inside the task's WRITE paths. One atomic commit per task.

5. **Report each task**:
   \`\`\`bash
   agentic report <TASK-ID> --status completed --files "<changed>" --tests "<tests>" --commit <sha>
   \`\`\`

6. **Close with evidence**:
   \`\`\`bash
   agentic verify
   \`\`\`

7. **Summarize**: changes, ADRs applied, evidence id and counters, open assumptions or gates.

Never declare success on a \`BLOCKED\`, \`FAIL\` or \`REMEDIATING\` outcome.
`,
    },
    {
      file: 'agentic-grill.md',
      content: `# /agentic-grill - Deterministic Probing And Decision Recording

> Named \`/agentic-grill\` on purpose: \`/grill-me\` belongs to the \`mattpocock/skills\`
> pack and conducts the live interview. This command produces the probe set and
> records the ADR. Use them together: probes here, conversation there.

Interrogate \`$*\` before any code is written.

1. Run the probes:
   \`\`\`bash
   agentic grill "$*"
   \`\`\`

2. Read the report. Every probe marked **ASSUMED DEFAULT** is an open question, not a decision.

3. Put the real answers to the user as concrete options with trade-offs. If \`/grill-me\`
   (from \`mattpocock/skills\`) is installed, use it to conduct that interview. Collect the
   choices into an answers file:
   \`\`\`json
   { "GRILL-001": "...", "GRILL-003": "..." }
   \`\`\`

4. Ratify the decisions (this promotes the ADR from PROPOSED to ACCEPTED):
   \`\`\`bash
   agentic grill "$*" --answers answers.json
   \`\`\`

5. Only then deliver:
   \`\`\`bash
   agentic prompt "$*" --answers answers.json
   \`\`\`
`,
    },
    {
      file: 'agentic-verify.md',
      content: `# /agentic-verify - Close The Cycle With Real Evidence

1. Check what is still awaiting a report:
   \`\`\`bash
   agentic status
   \`\`\`

2. Report any task you have finished but not yet reported:
   \`\`\`bash
   agentic report <TASK-ID> --status completed --commit <sha>
   \`\`\`

3. Collect evidence, verify and close:
   \`\`\`bash
   agentic verify
   \`\`\`

Interpret the outcome honestly:
- \`COMPLETE\` - requirements closed against evidence; report the evidence id.
- \`FAIL\` / \`REMEDIATING\` - the suite or an acceptance criterion failed. Fix and re-verify.
- \`BLOCKED\` - closure refused (no executable evidence, or missing acceptance criteria). Say so.
`,
    },
    {
      file: 'agentic-gate.md',
      content: `# /agentic-gate - Human Gate Decisions

1. List what is blocking:
   \`\`\`bash
   agentic gate list
   \`\`\`

2. For each gate, present the risk to the user in plain language: what it protects, what the
   run intends to do, and what happens if it is approved. Do **not** decide on their behalf.

3. Record their decision:
   \`\`\`bash
   agentic gate approve <GATE-ID> --note "<rationale>"
   agentic gate reject  <GATE-ID> --note "<rationale>"
   \`\`\`

4. Continue the run:
   \`\`\`bash
   agentic run
   \`\`\`
`,
    },
    {
      file: 'agentic-next.md',
      content: `# /agentic-next - What To Do Now

\`\`\`bash
agentic next
\`\`\`

It resolves the single next step from the real state: initialize, migrate stale artifacts,
decide a pending gate, implement an awaiting task, verify, or start the next phase.

Relay the answer as it is, then do it:
- **implement** - open the prompt pack it names and follow it (TDD, owned paths only).
- **decide_gate** / **migrate** / **update_cli** - these need a human; explain and stop.
- **verify** / **advance_milestone** - safe to run; \`agentic next --run\` executes them.
`,
    },
    {
      file: 'agentic-milestone.md',
      content: `# /agentic-milestone - Roadmap

\`\`\`bash
agentic milestone status     # phases and requirements closed with evidence
agentic milestone list       # every milestone
agentic milestone advance    # close what can honestly be closed
agentic milestone new "<title>"   # opens the new_milestone human gate
\`\`\`

A phase closes only when all its requirements are closed against an evidence record.
If \`advance\` reports "Still open", read the reason literally: something claims to be done
without proof. Never edit \`roadmap.yaml\` to make it pass.
`,
    },
    {
      file: 'agentic-skills.md',
      content: `# /agentic-skills - Shared Techniques Per Stage

\`\`\`bash
agentic skills                              # packs configured, and what is installed here
agentic skills stage implement --installed  # what to use while implementing
agentic skills stage review                 # what the team uses to review
agentic skills install mattpocock           # print the install command (--run to execute)
\`\`\`

The mapping lives in \`.agentic/orchestrator/skills.yaml\`. Use the mapped skill for the
stage you are in rather than improvising, and tell the user when a mapped skill is
missing on this machine instead of silently diverging from the team standard.

Never let a skill substitute for the framework's guarantees: identifiers come from the
registry and closure comes from \`agentic verify\`.
`,
    },
    {
      file: 'agentic-team.md',
      content: `# /agentic-team - Team Coordination

\`\`\`bash
agentic team who                      # identity and every active claim
agentic team claim <PHASE|TASK>       # claim work so teammates do not collide
agentic team release <PHASE|TASK>     # release it when done
agentic team init                     # (re)declare the shared/local artifact split
\`\`\`

Before starting work on a phase, check \`agentic team who\`. If a teammate holds it, coordinate
instead of forcing: \`--force\` takes over a lease and is recorded in the audit stream.
`,
    },
    {
      file: 'agentic-run.md',
      content: `# /agentic-run - Run Or Resume The Cycle

\`\`\`bash
agentic run
\`\`\`

Resumes a run parked in \`AWAITING_AGENT\` by default. Useful flags:
\`--phase <id>\`, \`--dry-run\`, \`--no-resume\`, \`--observe-tests\`, \`--force\`.
Report the resulting status and the listed next actions verbatim.
`,
    },
    {
      file: 'agentic-doctor.md',
      content: `# /agentic-doctor - Readiness Diagnostics

\`\`\`bash
agentic doctor
\`\`\`

Pay attention to these checks in particular:
- **Evidence capability** - can this project produce test evidence at all?
- **Closure evidence** - is any requirement marked DONE without usable evidence?
- **Audit hash chain** - has the audit stream been edited?
- **Human gates** / **Work leases** - what is blocked, and who holds what?

Relay failures with their exact details; do not summarize them away.
`,
    },
    {
      file: 'agentic-status.md',
      content: `# /agentic-status - Cycle Dashboard

\`\`\`bash
agentic status
\`\`\`

Report the state, the requirement/task counters, the evidence line, pending gates, active claims
and the printed next action. A test status of "not measured" is unknown - never call it green.
`,
    },
  ];
}
