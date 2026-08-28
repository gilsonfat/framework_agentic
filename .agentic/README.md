# Agentic SDLC Directory

This directory contains the runtime state, configuration, artifacts, schemas, templates, prompts, and audit records for the **Agentic SDLC Orchestrator**.

## Directory Layout

- `orchestrator/`: Core configuration files (`workflow.yaml`, `state-machine.yaml`, `policies.yaml`, `routing.yaml`, `providers.yaml`, `gates.yaml`, `complexity.yaml`) and JSON schemas.
- `state/`: Real observed state, declared project state, reconciled state, and historic snapshots.
- `planning/`: Bounded work packages (`current-work-package.yaml`) and planning history.
- `specs/`: Planned and as-built specifications (`planned/`, `as-built/`, `index.yaml`).
- `tasks/`: Compiled Task DAG (`dag.json`), current task contracts, and historical execution DAGs.
- `execution/`: Active run descriptor (`current-run.json`), worker logs, and detailed run bundles.
- `verification/`: Independent verification reports, evidence logs, and the requirement closure matrix (`requirement-matrix.json`).
- `reconciliation/`: Reconciliation diffs, rules, and verification reports.
- `prompts/`: Standardized role prompts for Orchestrator, Observer, Reconciler, Task Compiler, Worker, Reviewer, Verifier, and As-Built generator.
- `templates/`: Structured YAML/Markdown templates for work packages, tasks, remediation, and verification.
- `audit/`: Append-only event stream (`events.jsonl`).
- `adapters/`: Runtime-specific adapters (Claude Code, Antigravity, Generic).
