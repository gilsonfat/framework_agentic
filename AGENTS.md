> **You are running in Google Antigravity.**
> Workflows (type `/` in the agent chat): `/agentic`, `/agentic-verify`, `/agentic-grill`,
> `/agentic-status`. The `agentic` skill in `.agents/skills/agentic/SKILL.md` carries the
> full protocol and is loaded automatically for engineering tasks.

# AGENTIC SDLC ORCHESTRATOR - WORKSPACE INSTRUCTIONS

> **MANDATORY FOR EVERY AI ASSISTANT AND CODING AGENT** (Claude Code, Antigravity/Gemini, Codex, Cursor, humans included).
> This repository is governed by the Agentic SDLC Orchestrator: BMAD refinement, Grill-Me probing,
> ADR decisions, Spec Kit contracts, strict TDD, and **evidence-gated closure**.

---

## 0. Lost? One Command

```bash
agentic next
```

It reads the real state and prints the single next step: initialize, migrate, decide a
gate, implement a task, verify, or start the next phase. Every other section of this
document explains *why* that step is what it is.

---

## 1. How Work Enters This Repository

The framework separates three responsibilities and never blurs them:

| Responsibility | Owner | Never done by |
| :--- | :--- | :--- |
| Structuring, specifying, gating, auditing | `agentic` CLI (deterministic) | the agent |
| Writing code and tests | you, the coding agent | the CLI |
| Deciding something is DONE | the verifier, from executed test output | either of the above |

So a task runs in **two phases**:

```bash
# Phase 1 - structure and dispatch (produces prompt packs, no code)
agentic prompt "<instruction>"

# ... you implement each pack in .agentic/execution/inbox/ with strict TDD ...
agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>

# Phase 2 - close with real evidence (runs the suite, verifies, writes as-built)
agentic verify
```

A run that has been dispatched sits in state `AWAITING_AGENT`. That is normal and it is
**not** a failure: it means the framework is waiting for implementation. Nothing is marked
DONE until `agentic verify` collects an evidence record from a real test execution.

---

## 2. Non-Negotiable Rules

1. **Observed state beats declared state.** Inspect the repo (git status, tests, migrations,
   schemas) before believing any document, including these instructions.
2. **A test status you did not measure is unknown, never green.** `pending` means not measured.
3. **No requirement is DONE without executed evidence.** `implemented && tested && verified`,
   backed by an evidence record id.
4. **An assumption is not a decision.** Unanswered Grill-Me probes are carried as explicit
   assumptions and keep the ADR in `PROPOSED`. Answer them (`--answers file.json`) to ratify.
5. **Specify before implementing.** Stable ids from the registry: `REQ-###`, `SPEC-###`,
   `AC-###.#`, `ADR-###`, `TASK-###`. Never invent an id by hand.
6. **Strict TDD.** RED (failing test that encodes each AC) -> GREEN (minimum code) -> REFACTOR.
   Never weaken, skip or delete a test to reach green. The prompt pack states whether TDD is
   `required` for this change kind; if it is, `agentic report` **rejects** a completed task
   with no `--tests`, and an atomic `--commit` that resolves in git is mandatory.
7. **Respect ownership.** A task prompt pack lists WRITE / READ-ONLY / FORBIDDEN paths.
   Touching anything outside WRITE invalidates the task: report `blocked` instead.
8. **Human gates block.** Security, authentication, destructive migrations, XL complexity and
   exhausted remediation stop the run until a human decides (`agentic gate approve <id>`).
9. **Documentation comes from reality.** As-built specs are generated from the diff and the
   evidence, never written aspirationally.
10. **A state you cannot read is not a state.** If `agentic status` reports LEGACY or
   UNREADABLE, the artifacts came from another build: run `agentic migrate --apply` (or
   update the CLI) before trusting anything it says.

---

## 3. The 12-Step Cycle

1. **OBSERVE** - real git/test/migration state (`agentic observe --tests` measures the suite).
2. **RECONCILE** - declared vs observed; `--sync` rewrites the declaration from reality.
3. **REFINE & PROBE** - BMAD briefing, Grill-Me probes, ADRs in `.agentic/specs/decisions/`.
4. **PLAN & SPECIFY** - work package plus Spec Kit contract in `.agentic/specs/planned/`.
5. **HUMAN GATES** - evaluated before any dispatch; pending gates stop the run.
6. **COMPILE DAG** - Kahn ordering, cycle detection, write-conflict detection.
7. **DISPATCH** - one prompt pack per task in `.agentic/execution/inbox/`, in wave order. Tasks
   sharing a wave get their own git worktree; work inside it, never in the main checkout.
8. **IMPLEMENT (SUPERPOWERS (strict TDD and systematic debugging))** - the agent's job: TDD, owned paths only, one atomic commit per task.
9. **REPORT** - `agentic report <TASK-ID> --status completed|blocked`.
10. **REVIEW** - L1 self, L2 suite regression, L3 acceptance criteria, L4 security (read-only).
11. **VERIFY** - fresh verifier over executed evidence. FAIL -> remediation (max 3, then a gate).
12. **AS-BUILT & STATE** - as-built spec, requirement matrix, declared state re-synced, and
   any phase whose requirements are all evidence-backed is closed on the roadmap.

---

## 4. Working As A Team

- **Claim before you drive a phase**: `agentic team claim P-012 --note "checkout"`. The
  orchestrator refuses to run a phase claimed by someone else (`--force` takes over deliberately).
- **See who holds what**: `agentic team who`.
- **Shared vs local artifacts**: specs, decisions, planning, gates, registry and the requirement
  matrix are committed team truth. Observed state, runs, evidence, inbox, results and leases are
  machine-local (see `.agentic/.gitignore`).
- **The audit stream merges by union** (`.gitattributes`) and is a SHA-256 hash chain:
  `agentic audit verify` detects edits and deletions.
- **Identity matters**: every event, lease, gate decision and closure records `git config user.email`.

---

## 5. The Roadmap (milestones and phases)

`.agentic/planning/roadmap.yaml` is shared team truth: which milestone is active, which
phases belong to it, and which requirements each phase carries. Every run registers its
phase there automatically.

- A **phase closes** when every requirement it carries is closed **against an evidence
  record**. A closure with no usable evidence blocks the phase instead of advancing it.
- A **milestone closes** when all its phases are complete; the next planned one is activated.
- Opening a milestone goes through the `new_milestone` human gate: it stays `planned` until
  someone approves it.

```bash
agentic milestone status     # progress measured against evidence
agentic milestone advance    # close what can honestly be closed
```

Never edit the roadmap to mark something done. If a phase will not close, the reason is in
`agentic milestone status` and it is always the same kind of reason: something claims to be
done without proof.

---

## 6. Skill Packs (shared techniques)

The framework maps external skills to stages of the cycle in
`.agentic/orchestrator/skills.yaml`, so everyone applies the same technique at the
same step. `agentic skills` shows what is mapped and what is actually installed here.

Currently mapped (`mattpocock/skills`):

| Stage | Skill | Use it to |
| :--- | :--- | :--- |
| refine | `/grill-with-docs`, `/domain-modeling` | deepen the BMAD briefing and the terminology |
| probe | `/grill-me`, `/grilling` | run the live interview over the open probes |
| specify | `/to-spec` | enrich the generated SPEC (registry ids stay authoritative) |
| architect | `/codebase-design`, `/improve-codebase-architecture` | module boundaries and refactoring opportunities |
| compile | `/to-tickets` | decompose a work package (the task DAG stays authoritative) |
| implement | `/implement`, `/tdd` | the red-green-refactor loop itself |
| review | `/code-review` | review layers L1 and L3 |
| remediate | `/diagnosing-bugs` | systematic debugging when a test will not go green |
| merge | `/resolving-merge-conflicts` | resolve conflicts by intent |
| handoff | `/handoff` | compact the session before a context reset |

Install it with `agentic skills install mattpocock` (add `--run` to execute), then run
`/setup-matt-pocock-skills` once per repository.

Two boundaries never move, whichever skill you use:

- **Identifiers** come from the registry (`REQ-###`, `SPEC-###`, `AC-###.#`, `ADR-###`).
  A skill may enrich a spec; it may not mint an id.
- **Evidence** comes from `agentic verify`. A skill reporting "tests pass" is not evidence.

Note on naming: `/grill-me` is the pack's interview skill. The framework's own
deterministic probe list plus ADR recording is `/agentic-grill` (CLI: `agentic grill`).
They compose: the CLI produces the question set, the skill conducts the conversation.

---

## 7. Command Reference

| Command | Purpose |
| :--- | :--- |
| `agentic prompt "<x>"` (`do`) | Structure an instruction and dispatch prompt packs |
| `agentic report <TASK> --status <s>` | Report a task outcome back to the orchestrator |
| `agentic verify` | Collect evidence, verify, generate as-built, update state |
| `agentic run [--phase P-012]` | Run or resume the cycle |
| `agentic grill "<x>" [--answers f.json]` | Adversarial probing and ADR recording |
| `agentic spec "<x>"` | Spec Kit contract only |
| `agentic evidence [--show]` | Execute the suite and record evidence |
| `agentic gate list \| approve <id> \| reject <id>` | Human gate decisions |
| `agentic team init \| who \| claim <scope> \| release <scope>` | Team coordination |
| `agentic skills [list \| stage <s> \| install <pack>]` | Skill packs mapped per stage, and their real availability |
| `agentic audit verify \| tail` | Audit stream integrity and history |
| `agentic observe [--tests]` / `agentic reconcile [--sync]` | State inspection and repair |
| `agentic migrate [--apply]` | Bring `.agentic` artifacts to the current schema version |
| `agentic prompt "<x>" --split "<a>" --split "<b>" [--parallel]` | Decompose an epic into slices, each with its own REQ, spec and task |
| `agentic worktree list \| clean` | Isolated checkouts created for parallel waves |
| `agentic next` | What to do now, resolved from the real state |
| `agentic milestone status \| list \| new \| activate \| advance` | Roadmap: phases and milestones |
| `agentic status` / `agentic doctor` / `agentic ids` | Dashboard, diagnostics, identifiers |
| `agentic resume [--apply]` | Inspect and resume an interrupted run |
