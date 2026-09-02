# Agentic SDLC - Mandatory Workflow

This repository is governed by the Agentic SDLC Orchestrator. Every feature, bugfix or
refactor goes through the `agentic` CLI. You write the code; the CLI structures the work
and decides what is DONE.

## Two-phase flow

```bash
agentic prompt "<the request>"     # 1. structures + specifies + gates + dispatches
# implement each pack in .agentic/execution/inbox/ with strict TDD
agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>
agentic verify                     # 2. runs the suite, verifies, closes with evidence
```

A run in state `AWAITING_AGENT` is waiting for you to implement, not broken.

## Rules you cannot break

1. Read the task's prompt pack in `.agentic/execution/inbox/<TASK-ID>.md` before coding:
   it holds the acceptance criteria, the binding ADRs and your WRITE/READ-ONLY/FORBIDDEN paths.
2. Only touch paths listed as WRITE. Otherwise report `blocked` and explain.
3. Strict TDD (Superpowers): failing test first, minimum code, then refactor. Never weaken,
   skip or delete a test to reach green.
4. Never claim tests pass without the executed output. Never mark a requirement DONE:
   only `agentic verify` closes work, from a real test run.
5. Identifiers (`REQ-###`, `SPEC-###`, `AC-###.#`, `ADR-###`) come from the registry.
   Never invent one.
6. `HUMAN_GATE` means a human must decide (`agentic gate list`). Stop and report it.
7. Before driving a phase, check `agentic team who`; claim it with `agentic team claim <phase>`.
8. Use the team's mapped skill for the step: `agentic skills stage <stage> --installed`.

## Orientation

`agentic status` (where the cycle is) - `agentic doctor` (readiness) - full protocol in `AGENTS.md`.
