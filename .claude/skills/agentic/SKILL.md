---
name: agentic
description: Deliver any task, feature, bugfix or refactoring through the Agentic SDLC cycle - BMAD refinement, Grill-Me probing, ADR decisions, Spec Kit contracts, DAG dispatch, strict TDD, 4-layer review, evidence-gated verification and as-built documentation.
---

# Agentic SDLC Orchestrator Skill

You are the implementing agent inside a governed cycle. The `agentic` CLI structures and
enforces; you write code and tests; the verifier decides what is DONE from executed evidence.

## Protocol

1. **Structure the request** (never skip: it allocates ids, records decisions and gates risk):
   ```bash
   agentic prompt "<the user request>"
   ```
   Read the printed status. If it is `HUMAN_GATE`, stop and tell the user which gate blocks it.
   If it is `AWAITING_AGENT`, continue.

2. **Read your work orders**: `.agentic/execution/inbox/INDEX.md` gives the wave order, and
   `.agentic/execution/inbox/<TASK-ID>.md` is a self-contained prompt pack with the acceptance
   criteria, the binding ADRs, the ownership boundaries and the assumptions in force.

3. **Inspect reality before changing it**: find the real handlers, tests and configs involved.
   Contradicting evidence in the codebase overrides any assumption in the pack - report it.

4. **Check the shared technique for this step**: the prompt pack has a
   "Skills To Use" section, and `agentic skills stage implement --installed` lists what
   is available here. Use the team's mapped skill instead of improvising; if it is not
   installed, use the native path and say so.

5. **Implement with SUPERPOWERS (strict TDD and systematic debugging)**:
   - RED: write the failing test that encodes each `AC-###.#`; run the suite and keep the output.
   - GREEN: minimum implementation to pass.
   - REFACTOR: remove duplication, keep types strict.
   - Only touch paths listed as WRITE. One atomic commit per task.

6. **Report each task**:
   ```bash
   agentic report <TASK-ID> --status completed --files "<changed files>" --tests "<test files>" --commit <sha>
   ```
   Blocked instead? `agentic report <TASK-ID> --status blocked --note "<why>"`.

7. **Close the cycle**:
   ```bash
   agentic verify
   ```
   This runs the real suite, verifies each acceptance criterion, writes the as-built spec and
   updates the requirement matrix. `BLOCKED` means closure was refused - never report success.

8. **Report to the user**: what changed, which ADRs applied, the evidence id with its counters,
   and anything still open (assumptions, gates, blocked tasks).

## Absolute Rules

- Never claim tests pass without the executed output.
- Never mark a requirement DONE yourself; only `agentic verify` closes work.
- Never write outside your task's WRITE paths.
- Never turn an unanswered probe into a silent decision.
- Never let a skill mint an identifier or declare work done: ids come from the registry,
  closure comes from `agentic verify`.
