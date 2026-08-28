# AGENTIC SDLC ORCHESTRATOR — WORKSPACE INSTRUCTIONS

> **MANDATORY INSTRUCTION FOR ALL AI ASSISTANTS & CODING AGENTS (Antigravity, Gemini, Claude Code, Codex, etc.)**:
> This repository is governed by the **Agentic SDLC Orchestrator**. 
> Whenever the user requests any task, feature, bugfix, or refactoring in this repository, you **MUST ALWAYS** execute it through the orchestrated Agentic SDLC cycle.

---

## The Non-Negotiable 12-Step Cycle

Every prompt or modification must follow this pipeline:

1. **OBSERVE**: Inspect real repository state (Git branch, status, tests, migrations, schemas).
2. **RECONCILE**: Compare declared state vs observed state (**Observed State > Declared State**).
3. **PLAN (GSD)**: Frame the work into a bounded milestone, phase, and work package.
4. **SPECIFY (TLC)**: Write formal specification contracts with stable IDs (`REQ-###`, `AC-###.#`).
5. **COMPILE DAG**: Build dependency graph, check for cycles (Kahn's algorithm) and write conflicts.
6. **ORCHESTRATE (RUFLO)**: Select execution strategy based on complexity (XS/S: Single agent; M: Parallel; L/XL: Swarm).
7. **IMPLEMENT (SUPERPOWERS)**: Apply strict **TDD** (RED -> GREEN -> REFACTOR) and **Systematic Debugging**. Never edit forbidden files.
8. **REVIEW**: Execute 4-layer review (L1 Worker, L2 Integration build/test, L3 Independent correctness, L4 Security Read-Only).
9. **VERIFY (TLC FRESH VERIFIER)**: Independent verification. **No requirement is DONE without executable evidence** (`implemented && tested && verified`).
10. **REMEDIATE**: If verification fails, generate a `RemediationPackage` and repeat (up to 3 attempts before escalating to Human Gate).
11. **AS-BUILT SPEC**: Extract verified as-built documentation from real Git diff and test evidence.
12. **UPDATE STATE**: Update requirement matrix and declared roadmap, then re-observe.

---

## Command Quick Reference

- `agentic setup` : Automated full setup (Git, scaffolding, provider check, rules, initial observe).
- `agentic prompt "<instruction>"` (alias `agentic do "<instruction>"`) : Auto-orchestrate any prompt instruction through the 12-step SDLC cycle.
- `agentic status` : View the current milestone, phase, requirements, and test status.
- `agentic doctor` : Verify framework health and readiness.
- `agentic run [--phase <id>]` : Run the cyclic delivery loop.
- `agentic resume` : Resume interrupted executions from checkpoint safely.
