> # SUPERSEDED - ARCHIVED FOR HISTORY
>
> This is the original master guide (v1). It describes the framework **as it was
> designed before the evidence refactor**, and several of its instructions are now
> wrong in ways that matter:
>
> - it predates `AWAITING_AGENT`, `agentic report` and `agentic verify`: in v1 the
>   orchestrator "executed" tasks itself and synthesized their test results;
> - it predates evidence-gated closure, human gates that actually block, the team
>   layer, the skill packs, artifact versioning and the policy engine.
>
> **Do not follow this document.** The current, accurate sources are:
>
> - [`README.md`](../../README.md) - what the framework is and how to use it
> - [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) - how it is built and where each invariant is enforced
> - [`AGENTS.md`](../../AGENTS.md) - the protocol every AI agent must follow
>
> It is kept because it records the original intent and the reasoning behind the
> 12-step cycle, which the current design still honours.

---

# Agentic SDLC Orchestrator
## Guia Mestre de Instalação, Bootstrap e Implementação

> Documento de instruções para entregar a um agente de desenvolvimento como **Claude Code**, **Antigravity**, **Codex**, **Gemini CLI** ou equivalente, com o objetivo de construir um fluxo agentic cíclico, auditável e orientado a estado.

---

# 0. OBJETIVO DESTE DOCUMENTO

Construa neste repositório um **Agentic SDLC Orchestrator** que coordene continuamente:

1. observação do estado real do projeto;
2. reconciliação entre documentação e código;
3. planejamento do próximo trabalho;
4. especificação formal;
5. decomposição em tasks e dependências;
6. criação de swarm de agentes quando necessário;
7. implementação isolada e disciplinada;
8. revisão e validação;
9. remediação automática de falhas;
10. atualização do estado;
11. geração de especificação **as-built**;
12. reinício do ciclo com o novo estado observado.

O fluxo conceitual deve ser:

```text
OBSERVE
   ↓
RECONCILE
   ↓
PLAN — GSD
   ↓
SPECIFY — TLC
   ↓
COMPILE TASK DAG
   ↓
ORCHESTRATE — RUFLO
   ↓
IMPLEMENT — SUPERPOWERS + DOMAIN SKILLS
   ↓
REVIEW
   ↓
VERIFY — TLC FRESH VERIFIER
   ↓
REMEDIATE ↺
   ↓
RECONCILE
   ↓
GENERATE AS-BUILT SPEC
   ↓
UPDATE STATE
   ↓
OBSERVE ↺
```

O operador humano não deve precisar lembrar qual ferramenta executar em cada etapa.

A interface desejada deve convergir para comandos simples como:

```text
/orchestrate
```

ou:

```text
/agentic-run
```

ou:

```text
/agentic-run phase 07
```

---

# 1. PRINCÍPIOS NÃO NEGOCIÁVEIS

Implemente o sistema obedecendo aos seguintes princípios.

## 1.1 Observed State > Declared State

O estado observado no código, Git, testes, migrations, schemas e contratos tem precedência sobre arquivos declarativos.

Se:

```text
STATE.md:
TASK-014 = DONE
```

mas os testes ou implementação demonstrarem que a task está incompleta:

```text
observed:
TASK-014 = PARTIAL
```

o orquestrador deve corrigir o estado.

---

## 1.2 No DONE Without Evidence

Nenhuma requirement, task, phase ou milestone pode ser marcada como `DONE` apenas porque um agente declarou que terminou.

Deve existir evidência:

```text
implementation
+
tests
+
verification
+
traceability
```

---

## 1.3 Spec Before Implementation

Trabalho de feature não trivial deve possuir contrato de comportamento antes de implementação.

Cada requisito relevante deve possuir ID estável.

Exemplo:

```text
REQ-017
O sistema DEVE impedir duplicidade de execução
para a mesma empresa, template e competência.
```

---

## 1.4 Test From Spec, Not From Implementation

Testes devem derivar dos critérios de aceitação e comportamento definido na spec.

Nunca escrever testes apenas para refletir a estrutura atual da implementação.

---

## 1.5 Author != Verifier

O agente que implementou uma alteração não pode ser o único responsável por verificar se ela está correta.

A verificação final deve ocorrer em **fresh context** sempre que o runtime permitir.

---

## 1.6 Smallest Useful Swarm

Não criar swarm por padrão.

Usar:

```text
XS → 1 agente
S  → 1 agente
M  → 2–3 agentes
L  → swarm
XL → múltiplos work packages / swarms
```

O custo de coordenação deve ser proporcional ao benefício de paralelismo.

---

## 1.7 Isolated Ownership

Cada agente deve receber:

- tarefa;
- requirements;
- acceptance criteria;
- arquivos permitidos;
- arquivos read-only;
- dependências;
- ownership;
- output esperado.

Evitar vários agentes editando a mesma região sem coordenação.

---

## 1.8 Documentation From Reality

Após implementação:

```text
software real
    ↓
inspect
    ↓
reconcile
    ↓
as-built documentation
```

Não assumir que a spec planejada continua descrevendo exatamente o sistema final.

---

## 1.9 Idempotent Orchestration

Executar novamente o orquestrador não deve duplicar tasks, requirements ou registros.

O sistema deve reconhecer:

- run existente;
- task já concluída;
- verifier já executado;
- requirement já fechado;
- migration já aplicada;
- spec já existente.

---

## 1.10 Auditability

Toda execução deve possuir um identificador:

```text
RUN-YYYY-MM-DD-NNNN
```

Exemplo:

```text
RUN-2026-08-27-0042
```

Todas as decisões importantes devem ser rastreáveis até o run.

---

# 2. RESPONSABILIDADE DE CADA FRAMEWORK

Não misture responsabilidades.

```text
GSD
→ project / milestone / phase / project context

TLC Spec-Driven
→ specification / design / tasks / acceptance criteria / verification

Ruflo
→ swarm / agents / routing / parallel execution / shared execution layer

Superpowers
→ process discipline inside each worker

Domain Skills / ECC opcional
→ stack-specific or domain-specific engineering knowledge

Custom Orchestrator
→ state machine / gates / routing / contracts / reconciliation
```

Perguntas que cada camada responde:

```text
GSD:
"O que devemos fazer agora?"

TLC:
"O que significa estar correto?"

Ruflo:
"Quem deve executar o quê e em qual ordem?"

Superpowers:
"Como cada agente deve trabalhar?"

Domain Skills:
"Qual conhecimento técnico especializado esse agente precisa?"

Orchestrator:
"Em qual estado estamos e qual transição é permitida?"
```

---

# 3. PRÉ-REQUISITOS

Antes de modificar o projeto, validar:

```bash
node --version
npm --version
git --version
```

Recomendado:

- Node.js 20+
- npm recente
- Git
- repositório Git inicializado
- working tree conhecido
- runtime agentic disponível

Validar:

```bash
git status
git branch --show-current
git log -5 --oneline
```

Não sobrescrever configurações existentes sem antes criar backup ou verificar compatibilidade.

---

# 4. INSTALAÇÃO DO GSD

O GSD será usado principalmente para:

- PROJECT;
- REQUIREMENTS;
- ROADMAP;
- milestones;
- phases;
- planning;
- progress;
- project state.

## 4.1 Instalação interativa

```bash
npx get-shit-done-cc@latest
```

Escolher:

- runtime correspondente;
- preferencialmente instalação **local ao projeto** para projetos que serão distribuídos.

## 4.2 Claude Code

```bash
npx get-shit-done-cc --claude --local
```

## 4.3 Antigravity

```bash
npx get-shit-done-cc --antigravity --local
```

## 4.4 Instalação global, se explicitamente desejada

Claude:

```bash
npx get-shit-done-cc --claude --global
```

Antigravity:

```bash
npx get-shit-done-cc --antigravity --global
```

## 4.5 Verificação

No runtime, executar a ajuda GSD disponível para aquela instalação.

Se necessário, consultar os comandos instalados localmente antes de presumir nomenclatura.

## 4.6 Regra

Não modificar arquivos gerenciados internamente pelo GSD apenas para integrar o orquestrador.

Criar adaptadores externos.

---

# 5. INSTALAÇÃO DO TLC SPEC-DRIVEN

O TLC será o motor formal de specification e verification.

## 5.1 Instalação interativa

```bash
npx @tech-leads-club/agent-skills
```

Selecionar:

```text
tlc-spec-driven
```

e o runtime apropriado.

## 5.2 CLI direta

Se `agent-skills` estiver instalado globalmente:

```bash
agent-skills install -s tlc-spec-driven
```

Ou instalar globalmente primeiro:

```bash
npm install -g @tech-leads-club/agent-skills
agent-skills install -s tlc-spec-driven
```

## 5.3 Atualização

```bash
agent-skills update -s tlc-spec-driven
```

ou:

```bash
agent-skills update
```

## 5.4 MCP opcional

Para runtimes MCP-compatible:

```json
{
  "mcpServers": {
    "agent-skills": {
      "command": "npx",
      "args": ["-y", "@tech-leads-club/agent-skills-mcp"]
    }
  }
}
```

Para Claude Code, alternativamente:

```bash
claude mcp add agent-skills -- npx -y @tech-leads-club/agent-skills-mcp
```

## 5.5 Regra de integração

TLC será usado para:

```text
SPECIFY
DESIGN
TASKS
EXECUTE-CONTRACT
VERIFY
```

O orquestrador não deve reimplementar a metodologia TLC.

Ele deve consumir seus artefatos e outputs.

---

# 6. INSTALAÇÃO DO RUFLO

Ruflo será o execution engine para trabalho multiagente.

Para este projeto use a instalação **full**, não apenas plugins lite, pois precisamos de:

- swarm;
- MCP;
- hooks;
- agents;
- routing;
- execution orchestration.

## 6.1 Instalação multiplataforma

```bash
npx ruflo@latest init wizard
```

Ou:

```bash
npx ruflo@latest init
```

## 6.2 Instalação global opcional

```bash
npm install -g ruflo@latest
```

## 6.3 MCP para Claude Code

```bash
claude mcp add ruflo -- npx ruflo@latest mcp start
```

## 6.4 Diagnóstico

```bash
npx ruflo@latest doctor
```

## 6.5 Regra

Não usar swarm se:

- tasks são sequenciais;
- alteração é pequena;
- vários agentes disputariam os mesmos arquivos;
- custo de merge > benefício de paralelismo.

---

# 7. INSTALAÇÃO DO SUPERPOWERS

Superpowers será a política de processo aplicada dentro de cada worker.

Skills particularmente relevantes:

```text
brainstorming
writing-plans
test-driven-development
systematic-debugging
using-git-worktrees
requesting-code-review
receiving-code-review
verification-before-completion
dispatching-parallel-agents
subagent-driven-development
```

## 7.1 Claude Code

No Claude Code:

```text
/plugin install superpowers@claude-plugins-official
```

Ou pelo marketplace próprio:

```text
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

## 7.2 Antigravity

```bash
agy plugin install https://github.com/obra/superpowers
```

Reinstalar o mesmo plugin posteriormente atualiza a instalação.

## 7.3 Regra

Superpowers não deve substituir TLC.

Separação:

```text
Superpowers brainstorming
→ discovery / design reasoning

TLC
→ formal specification + traceability

Superpowers TDD/debug/review
→ worker implementation discipline

TLC Verifier
→ requirement closure
```

---

# 8. DOMAIN SKILLS / ECC — OPCIONAL

Não instalar uma coleção enorme sem necessidade.

Usar somente skills especializadas que tragam valor concreto ao stack.

Exemplos:

```text
TypeScript
Next.js
PostgreSQL
Supabase
Drizzle
security
performance
accessibility
testing
```

Regra:

```text
Superpowers = PROCESS SKILLS
Domain Skills = TECHNICAL KNOWLEDGE
```

O orquestrador deve permitir adicionar/remover esses providers sem alterar a state machine.

---

# 9. ESTRUTURA DE DIRETÓRIOS A CRIAR

Criar:

```text
.agentic/
│
├── README.md
│
├── orchestrator/
│   ├── workflow.yaml
│   ├── state-machine.yaml
│   ├── policies.yaml
│   ├── routing.yaml
│   ├── providers.yaml
│   ├── gates.yaml
│   ├── complexity.yaml
│   └── schemas/
│       ├── observed-state.schema.json
│       ├── work-package.schema.json
│       ├── task.schema.json
│       ├── run.schema.json
│       ├── verification.schema.json
│       └── requirement-closure.schema.json
│
├── state/
│   ├── observed-state.json
│   ├── declared-state.json
│   ├── reconciled-state.json
│   ├── diff.json
│   └── history/
│
├── planning/
│   ├── current-work-package.yaml
│   └── history/
│
├── specs/
│   ├── planned/
│   ├── as-built/
│   └── index.yaml
│
├── tasks/
│   ├── dag.json
│   ├── current/
│   └── history/
│
├── execution/
│   ├── current-run.json
│   ├── work-packages/
│   ├── agents/
│   └── runs/
│
├── verification/
│   ├── current/
│   ├── reports/
│   ├── evidence/
│   └── requirement-matrix.json
│
├── reconciliation/
│   ├── reports/
│   └── rules.yaml
│
├── prompts/
│   ├── orchestrator.md
│   ├── observer.md
│   ├── reconciler.md
│   ├── task-compiler.md
│   ├── worker.md
│   ├── reviewer.md
│   ├── verifier.md
│   └── as-built.md
│
├── templates/
│   ├── work-package.yaml
│   ├── task.yaml
│   ├── remediation-package.yaml
│   ├── verification-report.md
│   └── as-built-spec.md
│
└── audit/
    ├── events.jsonl
    └── README.md
```

Não mover arquivos internos de frameworks externos para dentro de `.agentic/`.

`.agentic/` pertence ao orquestrador customizado.

---

# 10. ARQUIVO providers.yaml

Criar `.agentic/orchestrator/providers.yaml`.

Conteúdo inicial:

```yaml
version: 1

providers:
  project_planner:
    engine: gsd
    required: true

  specification:
    engine: tlc-spec-driven
    required: true

  execution:
    engine: ruflo
    required: false
    fallback: native-agent

  process:
    engine: superpowers
    required: true

  verification:
    engine: tlc-spec-driven
    fresh_context: true
    required: true

  domain_skills:
    engine: optional
    auto_select: true
```

---

# 11. ARQUIVO workflow.yaml

Criar `.agentic/orchestrator/workflow.yaml`.

```yaml
version: 1

workflow:
  name: agentic-sdlc-loop
  mode: cyclic

  stages:
    - observe
    - reconcile
    - plan
    - specify
    - compile
    - execute
    - review
    - verify
    - reconcile_implementation
    - as_built
    - update_state
    - loop

  failure_transitions:
    verify:
      failure: remediate

    review:
      critical_failure: remediate

    reconcile:
      inconsistency: repair_state

  terminal_conditions:
    - no_pending_work
    - human_stop
    - unrecoverable_failure
    - gate_requires_human
```

---

# 12. STATE MACHINE

Criar `.agentic/orchestrator/state-machine.yaml`.

```yaml
version: 1

states:

  IDLE:
    next:
      - OBSERVING

  OBSERVING:
    success: RECONCILING
    failure: BLOCKED

  RECONCILING:
    success: PLANNING
    needs_state_repair: STATE_REPAIR
    failure: BLOCKED

  STATE_REPAIR:
    success: PLANNING
    failure: HUMAN_GATE

  PLANNING:
    success: SPECIFYING
    no_work: COMPLETE
    failure: BLOCKED

  SPECIFYING:
    success: SPEC_READY
    needs_human: HUMAN_GATE
    failure: BLOCKED

  SPEC_READY:
    next:
      - COMPILING

  COMPILING:
    success: EXECUTION_READY
    failure: BLOCKED

  EXECUTION_READY:
    next:
      - EXECUTING

  EXECUTING:
    success: REVIEWING
    partial_failure: REMEDIATING
    failure: BLOCKED

  REVIEWING:
    success: VERIFYING
    findings: REMEDIATING
    critical: HUMAN_GATE

  VERIFYING:
    success: RECONCILING_IMPLEMENTATION
    failure: REMEDIATING

  REMEDIATING:
    success: VERIFYING
    repeated_failure: HUMAN_GATE
    failure: BLOCKED

  RECONCILING_IMPLEMENTATION:
    success: AS_BUILT
    failure: BLOCKED

  AS_BUILT:
    success: UPDATING_STATE
    failure: BLOCKED

  UPDATING_STATE:
    success: OBSERVING
    no_more_work: COMPLETE

  HUMAN_GATE:
    approved: previous_or_configured_state
    rejected: STOPPED

  BLOCKED:
    resolved: OBSERVING
    aborted: STOPPED

  COMPLETE:
    terminal: true

  STOPPED:
    terminal: true
```

---

# 13. POLICIES

Criar `.agentic/orchestrator/policies.yaml`.

```yaml
version: 1

policies:

  evidence_required_for_done: true

  author_must_differ_from_verifier: true

  spec_required:
    feature: true
    architecture_change: true
    database_change: true
    bugfix_small: false
    documentation_only: false

  tdd:
    feature: required
    bugfix: required
    refactor: required
    generated_code: optional
    config_only: optional

  worktree:
    parallel_agents: required
    single_agent: optional

  git:
    atomic_commit_per_task: true
    force_push: forbidden
    rewrite_shared_history: forbidden

  security:
    destructive_database_change: human_gate
    authentication_change: human_gate
    authorization_change: human_gate
    secrets_change: human_gate

  documentation:
    generate_as_built: true
    update_after_verified_only: true

  loop:
    maximum_automatic_remediation_attempts: 3
    reobserve_after_success: true
```

---

# 14. COMPLEXITY CLASSIFICATION

Criar `.agentic/orchestrator/complexity.yaml`.

```yaml
version: 1

levels:

  XS:
    files_estimate: 1-2
    domains: 1
    agent_strategy: single
    swarm: false

  S:
    files_estimate: 3-5
    domains: 1
    agent_strategy: single
    swarm: false

  M:
    files_estimate: 5-15
    domains: 2-3
    agent_strategy: parallel-small
    swarm: optional

  L:
    files_estimate: 15-40
    domains: 3-5
    agent_strategy: swarm
    swarm: true

  XL:
    files_estimate: 40+
    domains: 5+
    agent_strategy: decompose-work-packages
    swarm: true
```

Não classificar apenas por número de arquivos.

Considerar:

- domains;
- coupling;
- database changes;
- public APIs;
- security impact;
- migration risk;
- test surface;
- parallelizability.

---

# 15. HUMAN GATES

Criar `.agentic/orchestrator/gates.yaml`.

```yaml
version: 1

human_gates:

  new_milestone:
    required: true

  architecture_change:
    required: true

  destructive_database_change:
    required: true

  authentication_change:
    required: true

  authorization_change:
    required: true

  public_api_breaking_change:
    required: true

  dependency_major_upgrade:
    required: true

  normal_feature:
    required: false

  non_destructive_migration:
    required: false

  bugfix:
    required: false

  remediation:
    required: false

  repeated_remediation_failure:
    required: true
```

O operador deve poder alterar essas políticas.

---

# 16. OBSERVER

Criar `.agentic/prompts/observer.md`.

O Observer deve:

1. ler Git;
2. detectar branch;
3. detectar commit;
4. detectar working tree sujo;
5. mapear stack;
6. detectar scripts de test/build/lint/typecheck;
7. mapear migrations;
8. encontrar arquivos de estado GSD/TLC;
9. inspecionar specs;
10. identificar testes falhando;
11. identificar divergências evidentes.

Output obrigatório:

```json
{
  "run_id": "RUN-...",
  "git": {},
  "project": {},
  "tests": {},
  "requirements": {},
  "tasks": {},
  "specs": {},
  "risks": [],
  "blockers": [],
  "timestamp": ""
}
```

Salvar em:

```text
.agentic/state/observed-state.json
```

e copiar snapshot para:

```text
.agentic/state/history/<run-id>-observed.json
```

---

# 17. RECONCILER

Criar `.agentic/prompts/reconciler.md`.

Comparar:

```text
declared state
vs
observed state
```

Produzir:

```text
MATCH
PARTIAL
MISMATCH
UNKNOWN
```

para:

- requirements;
- tasks;
- tests;
- migrations;
- features;
- phases.

Exemplo:

```yaml
REQ-017:
  declared: done
  observed: partial
  result: mismatch
  evidence:
    - test failure
    - missing uniqueness constraint
```

Nunca corrigir código apenas para fazer documentação parecer correta.

Primeiro corrigir o estado declarado.

---

# 18. WORK PACKAGE

Criar `.agentic/templates/work-package.yaml`.

```yaml
run_id: ""

milestone: ""
phase: ""

goal: ""

scope:
  include: []
  exclude: []

requirements: []

dependencies: []

risks: []

blockers: []

complexity: ""

expected_domains: []

human_gate_required: false
```

GSD deve fornecer ou ajudar a determinar esse pacote.

---

# 19. TLC SPEC CONTRACT

O orquestrador deve exigir que cada work package relevante produza:

```text
spec
design — quando necessário
tasks
acceptance criteria
validation contract
```

IDs devem ser persistentes.

Convenções:

```text
REQ-###
AC-###.#
TASK-###
VER-###
RUN-###
```

Uma task deve referenciar requirements.

Exemplo:

```yaml
id: TASK-023

title: Prevent duplicate competence

requirements:
  - REQ-017

acceptance_criteria:
  - AC-017.1
  - AC-017.2
  - AC-017.3

dependencies:
  - TASK-021

domain: backend

files:
  allowed:
    - src/modules/operations/**
  readonly:
    - src/db/**

verification:
  - unit
  - integration
```

---

# 20. TASK COMPILER

Criar `.agentic/prompts/task-compiler.md`.

Responsabilidades:

1. consumir tasks TLC;
2. resolver dependências;
3. produzir DAG;
4. detectar ciclos;
5. agrupar tarefas paralelizáveis;
6. determinar ownership;
7. selecionar agentes;
8. decidir swarm vs single-agent;
9. definir ordem de integração.

Salvar:

```text
.agentic/tasks/dag.json
```

Formato mínimo:

```json
{
  "nodes": [],
  "edges": [],
  "parallel_groups": [],
  "critical_path": [],
  "conflicts": []
}
```

Se houver ciclo não justificável:

```text
BLOCK EXECUTION
```

e voltar para planejamento/spec.

---

# 21. AGENT OWNERSHIP

Cada worker deve receber um contrato.

Criar `.agentic/templates/task.yaml`.

```yaml
id: TASK-000

role: ""

objective: ""

requirements: []

acceptance_criteria: []

dependencies: []

ownership:
  write: []
  readonly: []
  forbidden: []

process:
  tdd: true
  systematic_debugging: true
  verification_before_completion: true

output:
  implementation_report: true
  tests: true
  commit: true

completion:
  tests_must_pass: true
  no_self_declared_done: true
```

---

# 22. WORKER PROMPT

Criar `.agentic/prompts/worker.md`.

Conteúdo conceitual obrigatório:

```text
You are a worker in an orchestrated SDLC.

You do NOT own the project plan.
You do NOT redefine requirements.
You do NOT broaden scope.

Your authority is limited to the assigned TASK.

Before coding:
- read task
- read referenced requirements
- read acceptance criteria
- inspect dependencies
- inspect ownership boundaries

Use Superpowers process skills when available.

For feature/bug/refactor:
- use TDD
- observe RED
- implement minimum GREEN
- refactor while green

If unexpected behavior occurs:
- use systematic debugging
- identify root cause
- add regression coverage

Do not edit forbidden files.

Do not declare completion without executable evidence.

Return:
- files changed
- tests created/changed
- commands executed
- test results
- commit
- unresolved risks
```

---

# 23. SWARM CREATION

O Ruflo swarm deve ser gerado a partir do DAG.

Não utilizar uma lista fixa de agentes.

Exemplo:

```text
Coordinator

├── Database Agent
│   └── TASK-021
│
├── Backend Agent
│   ├── TASK-022
│   └── TASK-023
│
├── Frontend Agent
│   └── TASK-024
│
└── Test Agent
    └── TASK-025
```

Se Frontend depende de API:

```text
Backend → Frontend
```

Não iniciar ambos como independentes sem contrato estável.

---

# 24. WORKTREES

Quando houver agentes paralelos, preferir worktrees isolados.

Estrutura conceitual:

```text
main

├── wt/TASK-021-db
├── wt/TASK-022-backend
├── wt/TASK-024-frontend
└── wt/TASK-025-tests
```

Utilizar a skill `using-git-worktrees` do Superpowers quando disponível.

Antes de criar worktree:

- verificar branch;
- verificar path;
- verificar conflito;
- verificar ignore;
- não destruir worktrees existentes.

---

# 25. REVIEW PIPELINE

Validação deve ocorrer em camadas.

```text
L1 Worker Validation
        ↓
L2 Integration Validation
        ↓
L3 Independent Review
        ↓
L4 TLC Requirement Verification
```

## L1

Worker:

- unit tests;
- lint;
- typecheck;
- task-local verification.

## L2

Após integração:

- build;
- integration;
- database;
- API;
- E2E quando aplicável.

## L3

Reviewer independente:

- correctness;
- security;
- architecture;
- regression risk;
- scope creep;
- performance quando relevante.

## L4

TLC fresh verifier:

- spec-anchored;
- requirement closure;
- acceptance criteria;
- evidence.

---

# 26. SECURITY REVIEW

Security reviewer deve preferencialmente ser:

```text
READ ALL
WRITE NONE
```

Ele gera findings.

Não corrige diretamente a implementação a menos que o orquestrador crie uma remediation task separada.

Categorias mínimas:

```text
auth
authorization
injection
secrets
data exposure
unsafe deserialization
dependency risk
database permissions
file access
SSRF
XSS/CSRF quando aplicável
```

---

# 27. REQUIREMENT CLOSURE MATRIX

Criar/atualizar:

```text
.agentic/verification/requirement-matrix.json
```

Modelo:

```json
{
  "REQ-017": {
    "implemented": true,
    "tested": true,
    "verified": true,
    "tasks": ["TASK-022", "TASK-025"],
    "files": [],
    "tests": [],
    "commits": [],
    "verification": "VER-0034"
  }
}
```

Uma requirement só pode ser fechada se:

```text
implemented
AND tested
AND verified
```

---

# 28. REMEDIATION LOOP

Falha do verifier não deve gerar prompt genérico "fix it".

Criar remediation package.

Template:

```yaml
run_id: ""

verification_id: ""

requirement: ""

expected: ""

observed: ""

evidence: []

affected_tasks: []

suspected_areas: []

severity: ""

attempt: 1
```

Fluxo:

```text
FAIL
 ↓
Remediation Package
 ↓
Debug Worker
 ↓
Systematic Debugging
 ↓
Regression Test
 ↓
Fix
 ↓
Review
 ↓
Verifier
```

Após N tentativas configuradas:

```text
HUMAN_GATE
```

---

# 29. RECONCILE IMPLEMENTATION

Após PASS, inspecionar novamente o repositório.

Comparar:

```text
baseline commit
...
result commit
```

Mapear:

- arquivos criados;
- arquivos removidos;
- arquivos alterados;
- migrations;
- schemas;
- public APIs;
- routes;
- components;
- dependencies;
- tests;
- config.

Gerar:

```text
.agentic/reconciliation/reports/<run-id>.md
```

---

# 30. AS-BUILT SPEC

Criar `.agentic/templates/as-built-spec.md`.

Template:

```markdown
# As-Built Specification

## Metadata

- Run:
- Milestone:
- Phase:
- Baseline commit:
- Result commit:
- Verification:

## Implemented Requirements

## Architecture Changes

## Data Model

## APIs / Contracts

## UI / Components

## Background Jobs / Schedulers

## Security Decisions

## Tests

## Configuration

## Files of Interest

## Deviations From Planned Spec

## Known Limitations

## Follow-up Work

## Traceability

| Requirement | Task | Files | Tests | Commit | Verification |
|---|---|---|---|---|---|
```

Salvar cada resultado em:

```text
.agentic/specs/as-built/<feature-or-phase>/<run-id>.md
```

---

# 31. UPDATE STATE

Somente depois de:

```text
review pass
+
verifier pass
+
reconciliation
+
as-built
```

atualizar estado de GSD/TLC/orquestrador.

Registrar:

```yaml
phase:
  status: complete

requirements:
  verified: 14
  total: 14

run:
  id: RUN-...
  verification: VER-...

result_commit: ""
```

Depois:

```text
OBSERVE AGAIN
```

Não pular direto para próxima phase.

---

# 32. RUN MODEL

Criar `.agentic/orchestrator/schemas/run.schema.json`.

Cada run deve registrar:

```text
run id
started at
finished at
baseline commit
result commit
initial observed state
work package
spec
tasks
DAG
agents
worktrees
commits
tests
review
verification
remediations
reconciliation
as-built
resulting state
```

Salvar runtime data em:

```text
.agentic/execution/runs/<run-id>/
```

Estrutura:

```text
RUN-.../
├── run.json
├── observed-before.json
├── work-package.yaml
├── spec-ref.json
├── dag.json
├── agents.json
├── execution-report.md
├── review-report.md
├── verification-report.md
├── reconciliation.md
├── as-built.md
└── observed-after.json
```

---

# 33. AUDIT LOG

Criar:

```text
.agentic/audit/events.jsonl
```

Um evento por linha.

Exemplo:

```json
{"time":"...","run":"RUN-...","type":"STATE_TRANSITION","from":"VERIFYING","to":"REMEDIATING"}
{"time":"...","run":"RUN-...","type":"TASK_COMPLETED","task":"TASK-022","commit":"abc123"}
{"time":"...","run":"RUN-...","type":"VERIFICATION_FAILED","requirement":"REQ-017"}
```

Eventos mínimos:

```text
RUN_STARTED
STATE_TRANSITION
WORK_PACKAGE_CREATED
SPEC_READY
TASK_STARTED
TASK_COMPLETED
TASK_FAILED
REVIEW_FINDING
VERIFICATION_STARTED
VERIFICATION_PASSED
VERIFICATION_FAILED
REMEDIATION_STARTED
REMEDIATION_COMPLETED
AS_BUILT_GENERATED
STATE_UPDATED
RUN_COMPLETED
RUN_BLOCKED
```

---

# 34. ROUTING

Criar `.agentic/orchestrator/routing.yaml`.

```yaml
version: 1

routing:

  database:
    preferred_agent: database-engineer
    skills:
      - database
      - migrations

  backend:
    preferred_agent: backend-engineer
    skills:
      - api
      - typescript

  frontend:
    preferred_agent: frontend-engineer
    skills:
      - frontend
      - accessibility

  testing:
    preferred_agent: test-engineer
    skills:
      - testing

  security:
    preferred_agent: security-reviewer
    mode: readonly

  architecture:
    preferred_agent: architect
    human_gate_if_breaking: true
```

O runtime deve adaptar os nomes reais de agentes/skills disponíveis.

Nunca inventar nome de ferramenta sem verificar que existe.

---

# 35. ORCHESTRATOR MASTER PROMPT

Criar `.agentic/prompts/orchestrator.md`.

Use o seguinte contrato:

```text
ROLE
You are the Agentic SDLC Orchestrator for this repository.

PRIMARY RESPONSIBILITY
Maintain a truthful, verified and cyclic software delivery state.

YOU DO NOT:
- implement arbitrary feature code directly unless execution strategy is single-agent and explicitly routes execution to you;
- redefine requirements silently;
- mark work complete without evidence;
- trust stale state over repository evidence;
- create unnecessary swarms;
- skip independent verification.

EVERY RUN:

1. Generate RUN_ID.
2. Capture baseline Git state.
3. OBSERVE repository.
4. RECONCILE observed state with declared project/spec state.
5. Determine bounded next work package using project planning context.
6. Apply human gates.
7. Invoke specification engine.
8. Validate specification readiness.
9. Compile tasks into DAG.
10. Classify complexity.
11. Select execution strategy.
12. Create isolated workers/worktrees when parallel.
13. Dispatch implementation.
14. Collect worker evidence.
15. Integrate.
16. Run integration validation.
17. Run independent review.
18. Invoke fresh verifier.
19. On failure create remediation package and loop.
20. On success inspect actual implementation.
21. Generate reconciliation report.
22. Generate AS-BUILT spec.
23. Update declared state.
24. Capture resulting observed state.
25. Determine whether another cycle is allowed.
26. Repeat or stop.

SOURCE OF TRUTH PRIORITY:
1. executable evidence
2. repository state
3. verified as-built
4. planned spec
5. declared project state
6. agent statements

A TASK IS DONE ONLY WHEN:
- implementation exists;
- task-required tests pass;
- integration is not broken;
- evidence is recorded.

A REQUIREMENT IS CLOSED ONLY WHEN:
- implemented;
- tested;
- independently verified.

A PHASE IS COMPLETE ONLY WHEN:
- required requirements are closed;
- no blocking verification findings exist;
- as-built exists;
- state was reconciled.

STOP AND REQUEST HUMAN DECISION FOR:
- destructive database operations;
- architecture-breaking changes;
- auth/authz policy changes;
- major public API breaking changes;
- unresolved requirement ambiguity;
- repeated remediation failure;
- configuration-defined human gates.
```

---

# 36. COMANDOS DE ALTO NÍVEL

Criar comandos equivalentes, de acordo com o runtime.

Desejados:

```text
/agentic-status
/agentic-observe
/agentic-plan
/agentic-run
/agentic-run phase <id>
/agentic-verify
/agentic-reconcile
/agentic-resume
/agentic-stop
```

## /agentic-status

Exibir:

```text
Current milestone
Current phase
Current orchestrator state
Current run
Pending requirements
Pending tasks
Failed tests
Open verification findings
Human gates
Last result commit
```

## /agentic-run

Executa loop completo até:

```text
successful cycle
human gate
unrecoverable blocker
configured stop condition
```

Não executar loops infinitos.

---

# 37. BOOTSTRAP EM PROJETO EXISTENTE

Para brownfield, antes de qualquer feature:

```text
1. inspect repository
2. map architecture
3. identify stack
4. identify modules
5. identify tests
6. identify database
7. identify existing documentation
8. identify current feature state
9. generate initial observed-state
10. reconcile existing planning docs
```

Nunca criar nova arquitetura em paralelo ignorando padrões atuais.

---

# 38. BOOTSTRAP EM PROJETO NOVO

Para greenfield:

```text
1. GSD project definition
2. requirements
3. roadmap
4. first milestone
5. first bounded phase
6. Superpowers brainstorming/design as applicable
7. TLC formal spec
8. implementation loop
```

Não tentar especificar todo o produto em detalhe antes da primeira phase.

---

# 39. BASELINE COMMANDS

O Observer deve descobrir scripts reais no `package.json` ou ferramenta equivalente.

Não presumir comandos.

Exemplos possíveis:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Armazenar os comandos detectados no observed state.

Se não existirem:

```text
status = unavailable
```

Não criar teste/build fictício apenas para preencher relatório.

---

# 40. GIT POLICY

Antes de cada run:

```bash
git status
git branch --show-current
git rev-parse HEAD
```

Registrar baseline.

Depois:

```bash
git rev-parse HEAD
git diff <baseline>...HEAD
```

Não:

```text
force push
reset --hard
clean -fd
```

sem autorização explícita.

Commits devem ser pequenos e ligados a TASK IDs quando possível.

Exemplo:

```text
feat(operations): enforce competence uniqueness [TASK-022]
```

---

# 41. CONFLICT POLICY

Se dois agentes precisam editar os mesmos arquivos:

```text
DO NOT parallelize blindly
```

Opções:

1. tornar dependência sequencial;
2. separar interface/contract primeiro;
3. dividir ownership;
4. criar integration task.

O Task Compiler deve reportar:

```text
write conflicts
```

antes de iniciar swarm.

---

# 42. SPEC DRIFT

Durante implementação, se o agente descobrir que a spec está errada:

```text
STOP relevant task
```

Registrar:

```text
SPEC_DRIFT
```

Não alterar requirement silenciosamente.

Fluxo:

```text
worker finding
   ↓
orchestrator
   ↓
spec decision
   ↓
human gate if material
   ↓
spec revision
   ↓
task DAG recompilation
```

---

# 43. ARCHITECTURAL DECISIONS

Decisões significativas devem ser registradas.

Criar opcionalmente:

```text
.agentic/decisions/
```

Formato:

```text
ADR-0001.md
```

O as-built deve referenciar ADRs relevantes.

---

# 44. DEFINITION OF DONE

## Task Done

```text
implementation exists
tests required by task pass
worker verification passes
commit recorded
evidence recorded
```

## Requirement Done

```text
all required tasks complete
acceptance criteria covered
tests pass
fresh verifier passes
closure matrix updated
```

## Phase Done

```text
mandatory requirements verified
integration healthy
security critical findings resolved
reconciliation complete
as-built generated
project state updated
```

---

# 45. RECOVERY

Se o runtime morrer no meio da execução:

Ao reiniciar:

```text
1. load current-run.json
2. inspect Git
3. inspect worktrees
4. inspect task evidence
5. reconcile actual progress
6. do not repeat completed task blindly
7. continue from safe state
```

Criar comando:

```text
/agentic-resume
```

---

# 46. STOP CONDITIONS

O loop deve parar quando:

```text
no pending work
human approval required
unresolved blocker
repeated remediation limit reached
repository unsafe/dirty in ambiguous state
provider unavailable
verification infrastructure broken
explicit user stop
```

Não continuar autonomamente quando não houver base segura.

---

# 47. INITIALIZATION SCRIPT

Criar um script de bootstrap adequado ao stack do repositório.

Exemplo desejado:

```text
scripts/agentic-init.*
```

Responsabilidades:

```text
create directories
create missing default config
validate JSON/YAML
verify provider installations when possible
detect runtime
detect git
detect scripts
initialize audit log
initialize state files
```

O script deve ser idempotente.

Não sobrescrever configuração customizada existente sem flag explícita.

---

# 48. DOCTOR COMMAND

Criar:

```text
/agentic-doctor
```

Validar:

```text
[ ] Git
[ ] GSD
[ ] TLC
[ ] Ruflo
[ ] Superpowers
[ ] state files
[ ] config schemas
[ ] audit log
[ ] test command
[ ] build command
[ ] worktree support
[ ] fresh verifier support
```

Output exemplo:

```text
Agentic SDLC Doctor

GSD                 PASS
TLC                 PASS
Ruflo                PASS
Superpowers          PASS
Git                  PASS
Test command         PASS
Build command        PASS
Observed state       PASS
Requirement matrix  PASS

READY
```

---

# 49. STATUS DASHBOARD EM TERMINAL

`/agentic-status` deve produzir algo conciso:

```text
Agentic SDLC

Run          RUN-2026-08-27-0042
State        VERIFYING

Milestone    M03
Phase        P07

Requirements
14 / 18 verified

Tasks
21 / 24 complete

Tests
215 pass
3 fail

Review
1 medium
0 critical

Next
Remediate REQ-017
```

---

# 50. PRIMEIRA EXECUÇÃO APÓS INSTALAÇÃO

Não implementar feature imediatamente.

Executar:

```text
1. doctor
2. observe
3. initialize declared state
4. reconcile
5. present report
```

Produzir:

```text
.agentic/state/observed-state.json
.agentic/state/reconciled-state.json
.agentic/reconciliation/reports/INITIAL.md
```

Depois determinar o primeiro work package.

---

# 51. IMPLEMENTAÇÃO INCREMENTAL RECOMENDADA

Não tente construir todo o orquestrador em uma alteração gigante.

## Phase A — Foundation

Criar:

```text
directories
schemas
configs
observer
audit
status
doctor
```

## Phase B — Planning & Spec

Integrar:

```text
GSD
TLC
work package
task compiler
DAG
```

## Phase C — Execution

Integrar:

```text
Ruflo
worker contract
Superpowers
worktrees
```

## Phase D — Verification

Implementar:

```text
review
fresh verifier
requirement closure
remediation
```

## Phase E — Reconciliation

Implementar:

```text
post-run observer
as-built
state update
resume/recovery
```

Cada phase deve ser validada antes da próxima.

---

# 52. CRITÉRIOS DE ACEITAÇÃO DO ORQUESTRADOR

A implementação só é aceitável quando demonstrar:

## AC-ORCH-001

Pode observar um projeto sem alterar código.

## AC-ORCH-002

Detecta divergência entre declared e observed state.

## AC-ORCH-003

Produz bounded work package.

## AC-ORCH-004

Consegue consumir/generar spec formal.

## AC-ORCH-005

Gera DAG sem ciclos para tasks válidas.

## AC-ORCH-006

Detecta write conflicts.

## AC-ORCH-007

Seleciona single-agent para tarefa pequena.

## AC-ORCH-008

Seleciona swarm para trabalho paralelizável complexo.

## AC-ORCH-009

Registra evidência de execução.

## AC-ORCH-010

Não fecha requirement sem verification.

## AC-ORCH-011

Falha de verifier cria remediation package.

## AC-ORCH-012

Após sucesso gera as-built.

## AC-ORCH-013

Atualiza estado.

## AC-ORCH-014

Reobserva projeto após state update.

## AC-ORCH-015

Consegue retomar run interrompido.

## AC-ORCH-016

Human gates bloqueiam operações configuradas.

## AC-ORCH-017

Audit log permite reconstruir transições do run.

---

# 53. TESTES OBRIGATÓRIOS

Criar testes do próprio orquestrador para:

```text
state transitions
invalid transition rejection
DAG cycle detection
write-conflict detection
complexity routing
human gates
requirement closure
remediation limit
resume
idempotency
schema validation
audit emission
as-built generation
```

---

# 54. O QUE NÃO FAZER

Não:

- transformar todo problema em swarm;
- deixar Ruflo definir requirements;
- deixar GSD verificar código sozinho;
- deixar worker alterar spec;
- deixar verifier implementar fix;
- deixar security reviewer modificar código silenciosamente;
- duplicar workflow GSD/TLC;
- instalar dezenas de skills sem necessidade;
- sobrescrever CLAUDE.md/AGENTS.md/GEMINI.md sem inspeção;
- marcar task como done por texto de agente;
- esconder falhas para avançar state;
- remover testes para obter green;
- atualizar documentação antes de verificar implementação.

---

# 55. COMPATIBILIDADE COM CLAUDE CODE E ANTIGRAVITY

O core do sistema deve ser agent-agnostic.

Usar adaptadores.

Estrutura opcional:

```text
.agentic/adapters/
├── claude/
├── antigravity/
├── codex/
└── generic/
```

Cada adapter é responsável apenas por:

```text
command registration
skill invocation
subagent invocation
MCP invocation
fresh-context strategy
```

A lógica de state machine nunca deve depender diretamente de sintaxe exclusiva de um runtime.

---

# 56. CLAUDE CODE ADAPTER

Criar comandos locais quando apropriado para:

```text
agentic-run
agentic-status
agentic-doctor
agentic-resume
```

Respeitar estrutura já existente em `.claude/`.

Não deletar commands/skills existentes.

Detectar instalações GSD/Ruflo/Superpowers antes de criar aliases.

---

# 57. ANTIGRAVITY ADAPTER

Respeitar instalação local Antigravity e diretórios já presentes.

Não presumir paths se a instalação existente indicar outros.

Preferir capabilities/skills locais detectadas.

Criar comandos/skills compatíveis apenas depois de inspecionar as convenções presentes no projeto.

---

# 58. PROVIDER FALLBACKS

O orquestrador não deve ficar inutilizável se Ruflo estiver ausente.

Exemplo:

```yaml
execution:
  preferred: ruflo
  fallback:
    - native-subagents
    - sequential-agent
```

Mas:

```text
TLC verification required
```

não deve ser silenciosamente substituído por autoavaliação do autor.

Se fresh verifier não estiver disponível:

```text
BLOCK or require human gate
```

conforme policy.

---

# 59. FINAL DELIVERY EXPECTED FROM THE IMPLEMENTING AGENT

Ao terminar o bootstrap, entregar:

```text
1. lista de frameworks detectados/instalados
2. árvore de arquivos criada
3. comandos disponíveis
4. arquitetura do orquestrador
5. state machine
6. provider map
7. human gates
8. testes executados
9. doctor output
10. primeira observação do projeto
11. limitações conhecidas
12. próximos passos
```

Não declarar sucesso sem executar verificações possíveis.

---

# 60. MASTER EXECUTION REQUEST

A instrução abaixo pode ser entregue diretamente ao agente implementador.

---

## PROMPT PARA CLAUDE CODE / ANTIGRAVITY

Você deve transformar este repositório em um projeto habilitado para um **Agentic SDLC Orchestrator cíclico**.

Antes de modificar qualquer arquivo:

1. leia este documento inteiro;
2. inspecione o repositório;
3. detecte runtime e configurações existentes;
4. detecte GSD, TLC Spec-Driven, Ruflo e Superpowers;
5. valide Git e Node;
6. não sobrescreva arquivos de configuração existentes sem necessidade;
7. apresente/registre o design conforme as regras de processo disponíveis.

Objetivo final:

```text
OBSERVE
→ RECONCILE
→ PLAN
→ SPECIFY
→ COMPILE
→ ORCHESTRATE
→ IMPLEMENT
→ REVIEW
→ VERIFY
→ REMEDIATE IF NEEDED
→ RECONCILE IMPLEMENTATION
→ AS-BUILT
→ UPDATE STATE
→ OBSERVE AGAIN
```

Implemente o orquestrador como uma camada própria e desacoplada dos frameworks.

Use:

```text
GSD
= project planning

TLC
= formal specification + independent verification

Ruflo
= optional multi-agent execution engine

Superpowers
= worker execution discipline

custom .agentic/
= state, routing, gates, reconciliation and audit
```

Comece pela Foundation.

Não tente implementar todo o sistema em um único commit.

Adote TDD para a lógica do orquestrador.

Crie primeiro testes para:

```text
state machine
DAG
routing
human gates
requirement closure
```

Depois implemente o mínimo para fazê-los passar.

Mantenha os módulos pequenos e substituíveis.

Não acople o core a Claude Code ou Antigravity.

Crie adapters.

Ao final de cada etapa:

```text
test
typecheck
lint
build
```

conforme disponível no projeto.

Execute `/agentic-doctor` ou equivalente antes de declarar bootstrap concluído.

Depois execute apenas:

```text
OBSERVE
RECONCILE
```

no projeto real e apresente o primeiro relatório.

Não avance automaticamente para implementação de features existentes até que o bootstrap tenha sido validado.

---

# 61. REFERÊNCIAS DE INSTALAÇÃO

Fontes oficiais/repositórios consultados para este guia:

- GSD — `gsd-build/get-shit-done`
- TLC / Agent Skills — `tech-leads-club/agent-skills`
- Ruflo — `ruvnet/ruflo`
- Superpowers — `obra/superpowers`

Como esses projetos evoluem rapidamente, antes de executar comandos destrutivos ou adaptar arquivos internos, consulte a documentação instalada ou README atual do respectivo projeto.

---

# 62. RESULTADO ARQUITETURAL FINAL

```text
┌──────────────────────────────────────────────┐
│          AGENTIC SDLC ORCHESTRATOR           │
│ State • Gates • Routing • Audit • Recovery  │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
               OBSERVE / RECONCILE
                      │
                      ▼
┌──────────────────────────────────────────────┐
│                    GSD                       │
│        Project • Milestone • Phase          │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│            SUPERPOWERS DISCOVERY             │
│        Brainstorming / Design Process        │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
┌──────────────────────────────────────────────┐
│              TLC SPEC-DRIVEN                 │
│ Requirements • Design • Tasks • Acceptance  │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
                 TASK COMPILER
                      │
                     DAG
                      │
                      ▼
┌──────────────────────────────────────────────┐
│                   RUFLO                      │
│       Routing • Swarm • Parallelism         │
└─────────────────────┬────────────────────────┘
                      │
            ┌─────────┼─────────┐
            ▼         ▼         ▼
         Worker     Worker    Worker
            │         │         │
            └─────────┼─────────┘
                      ▼
┌──────────────────────────────────────────────┐
│                SUPERPOWERS                   │
│ TDD • Debug • Worktrees • Review • Verify  │
└─────────────────────┬────────────────────────┘
                      │
                      ▼
                INTEGRATION
                      │
                      ▼
                SECURITY REVIEW
                      │
                      ▼
┌──────────────────────────────────────────────┐
│              TLC FRESH VERIFIER              │
│    Requirement Closure • Evidence Check     │
└─────────────────────┬────────────────────────┘
                      │
                 ┌────┴────┐
                 ▼         ▼
               PASS       FAIL
                 │         │
                 │         └── REMEDIATION ──┐
                 │                           │
                 ▼                           │
        RECONCILE IMPLEMENTATION             │
                 │                           │
                 ▼                           │
              AS-BUILT                       │
                 │                           │
                 ▼                           │
            UPDATE STATE                     │
                 │                           │
                 └────── OBSERVE AGAIN ◄─────┘
```

---

# 63. DEFINITION OF SUCCESS

O sistema está pronto quando o operador puder entrar em um projeto e executar algo equivalente a:

```text
/agentic-run
```

e o sistema, sem depender de memória humana sobre o processo:

```text
verifica onde está
→ reconcilia
→ escolhe o próximo trabalho
→ especifica
→ cria tasks
→ decide se precisa swarm
→ implementa
→ revisa
→ verifica
→ corrige quando falha
→ descreve o que realmente construiu
→ atualiza estado
→ começa novo ciclo
```

com rastreabilidade suficiente para responder a qualquer momento:

```text
O que estava planejado?
O que foi implementado?
Qual requisito originou esta alteração?
Qual task a executou?
Qual agente trabalhou nela?
Quais arquivos mudaram?
Qual teste comprova o comportamento?
Qual commit introduziu a alteração?
Quem verificou?
Qual foi o resultado?
Qual é o estado real agora?
```

Esse é o contrato final do Agentic SDLC Orchestrator.
