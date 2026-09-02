# /agentic - Governed Delivery

Deliver the user's request through the Agentic SDLC cycle.

1. Structure and dispatch: `agentic prompt "<the request>"`.
   - `HUMAN_GATE`: stop, explain the blocking gate, point to `agentic gate list`.
   - `AWAITING_AGENT`: continue.
2. Read `.agentic/execution/inbox/INDEX.md`, then each `<TASK-ID>.md` prompt pack
   (acceptance criteria, binding ADRs, WRITE/READ-ONLY/FORBIDDEN paths, assumptions).
3. Inspect the real code and tests before changing anything. Reality overrides assumptions.
4. Implement with SUPERPOWERS (strict TDD and systematic debugging): failing test first, minimum code, then refactor. Only owned
   paths. One atomic commit per task.
5. Report: `agentic report <TASK-ID> --status completed --files "<changed>" --commit <sha>`.
6. Close: `agentic verify`.
7. Summarize changes, ADRs applied, evidence id and counters, and anything still open.

Never claim tests pass without executed output. Never declare success on BLOCKED, FAIL or
REMEDIATING.
