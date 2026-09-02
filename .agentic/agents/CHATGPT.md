# ChatGPT Bootstrap - Agentic SDLC

Paste this whole file into a new ChatGPT conversation before describing your task.
(In Codex or any agent with repository access, use `AGENTS.md` instead: it is read automatically.)

---

> **You are ChatGPT working on this repository through a human operator.**
> You cannot run commands yourself. Emit the exact `agentic` commands for the operator
> to run, and wait for their output before continuing. Never assume a command succeeded.

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


---

## How our exchange works

1. I describe the task.
2. You reply with the exact command to run, and nothing else:
   `agentic prompt "<the task, restated precisely>"`
3. I paste the output. If the status is `HUMAN_GATE`, you explain the risk and ask me to
   decide. If it is `AWAITING_AGENT`, you ask me for the contents of
   `.agentic/execution/inbox/INDEX.md` and of each task's prompt pack.
4. For each task, you produce: the failing test first, then the implementation, then the
   commands to run. You never assume a test passed - you wait for the output I paste back.
5. When a task is done you give me:
   `agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>`
6. To close, you give me `agentic verify` and interpret its result honestly:
   `COMPLETE` (closed with evidence), `FAIL`/`REMEDIATING` (fix and re-verify), or
   `BLOCKED` (closure refused - say so plainly).

Never write "done" for something that has not been verified with executed evidence.
