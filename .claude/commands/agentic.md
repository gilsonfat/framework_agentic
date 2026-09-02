# /agentic - Governed Delivery

Deliver `$*` through the Agentic SDLC cycle. The CLI structures and enforces; you implement.

## Protocol

1. **Structure and dispatch**:
   ```bash
   agentic prompt "$*"
   ```
   - Status `HUMAN_GATE`: stop, report the pending gate, ask the user to run `agentic gate list`.
   - Status `AWAITING_AGENT`: continue below.

2. **Read the work orders**: `.agentic/execution/inbox/INDEX.md`, then each
   `.agentic/execution/inbox/<TASK-ID>.md` (acceptance criteria, ADRs, ownership, assumptions).

3. **Observe reality**: locate the real code, tests and config for `$*`. Identify the project's
   test command. Reality overrides any assumption in the pack.

4. **Implement with SUPERPOWERS (strict TDD and systematic debugging)** - per task, in wave order:
   - RED: failing test encoding every `AC-###.#`; run the suite, keep the output.
   - GREEN: minimum implementation.
   - REFACTOR: clean up, keep types strict.
   - Stay inside the task's WRITE paths. One atomic commit per task.

5. **Report each task**:
   ```bash
   agentic report <TASK-ID> --status completed --files "<changed>" --tests "<tests>" --commit <sha>
   ```

6. **Close with evidence**:
   ```bash
   agentic verify
   ```

7. **Summarize**: changes, ADRs applied, evidence id and counters, open assumptions or gates.

Never declare success on a `BLOCKED`, `FAIL` or `REMEDIATING` outcome.
