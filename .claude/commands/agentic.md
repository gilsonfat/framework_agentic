# /agentic Slash Command

Execute the complete **Agentic SDLC Orchestration Cycle** for the user's prompt:

```bash
agentic prompt "$*"
```

Or execute the 12-step pipeline:
1. Observe repository state (`git status`, tests, schemas).
2. Reconcile observed state with declared state (`Observed State > Declared State`).
3. Plan milestone/phase work package with GSD.
4. Specify contracts (`REQ-###`, `AC-###.#`) with TLC Spec-Driven.
5. Compile DAG without cycles or write conflicts.
6. Orchestrate with Ruflo (XS/S single agent, M small parallel, L/XL swarm).
7. Implement with Superpowers TDD (Red-Green-Refactor) and systematic debugging.
8. Review (4 layers including security read-only).
9. Verify with TLC Fresh Context Verifier (no requirement closed without evidence).
10. Remediate on failure (up to 3 attempts).
11. Generate As-Built specification.
12. Update declared state and re-observe.
