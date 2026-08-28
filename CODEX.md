# AGENTIC SDLC ORCHESTRATOR — OPENAI CODEX / CHATGPT INSTRUCTIONS

> **INSTRUCTION FOR OPENAI CODEX, CHATGPT, AND CUSTOM GPTS**:
> This workspace is governed by the **Agentic SDLC Orchestrator**.
> For every user prompt, feature request, bugfix, or refactor, execute the 12-step cyclic pipeline:

```text
OBSERVE -> RECONCILE -> PLAN (GSD) -> SPECIFY (TLC) -> COMPILE DAG -> ORCHESTRATE -> IMPLEMENT (TDD) -> REVIEW -> VERIFY (FRESH VERIFIER) -> REMEDIATE -> AS-BUILT SPEC -> UPDATE STATE
```

## Non-Negotiable Invariants
1. **Observed State > Declared State**: Real code, tests, and Git status override any documentation.
2. **No DONE Without Evidence**: Never mark requirements complete without test execution proof.
3. **Spec Before Implementation**: Always reference formal IDs (`REQ-###`, `AC-###.#`, `TASK-###`).
4. **TDD Required**: Write failing tests before implementation.
5. **Fresh Verifier**: Independent verification before state closure.
6. **Documentation From Reality**: Generate As-Built specifications from git diff and test output.

## CLI Execution
When terminal access is available, run:
```bash
agentic prompt "<user instruction>"
```
Or view status:
```bash
agentic status
agentic doctor
```
