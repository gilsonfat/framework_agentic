# Arquitetura

Como o framework é construído e **onde cada invariante é imposto no código**. Para o que ele é e como usar, veja o [README](../README.md); para o protocolo que todo agente segue, veja [AGENTS.md](../AGENTS.md).

---

## A separação que sustenta tudo

```
             estrutura, especifica,          escreve código           decide o que
             barra risco, audita              e testes                 está PRONTO
        ┌──────────────────────────┐   ┌──────────────────────┐   ┌──────────────────┐
        │      CLI `agentic`       │──▶│   agente de código   │──▶│    Verifier      │
        │   (determinística)       │   │ (Claude, Gemini...)  │   │ (só com evidência)│
        └──────────────────────────┘   └──────────────────────┘   └──────────────────┘
                    │                             │                        │
              prompt packs                 agentic report            requirement-matrix
```

Nenhuma das três caixas faz o trabalho da outra. A CLI **não escreve código** — quando ela fingia escrever, o framework fabricava a evidência que seu próprio invariante exigia. O agente **não fecha requisito**. O verificador **não implementa**.

---

## Mapa dos módulos

### Fronteiras (quem fala com o mundo)

| Módulo | Responsabilidade |
| :--- | :--- |
| `cli/cli-runner.ts` | Superfície de comandos; funil único de erro (`runCli`) e guardas de inicialização |
| `cli/errors.ts` | `CliError` (mensagem acionável) vs. bug do framework (stack sob `AGENTIC_DEBUG`) |
| `core/agent-bridge.ts` | **A fronteira de execução**: compila tarefa → prompt pack, recebe resultado reportado |
| `core/agent-integrations.ts` | Escreve as instruções que cada produto de IA lê (8 produtos) |
| `core/scaffolder.ts` / `setup-orchestrator.ts` | Criação da arquitetura `.agentic/` e do setup completo |

### Observação e estado

| Módulo | Responsabilidade |
| :--- | :--- |
| `core/observer.ts` | Mede o repositório real. Status de teste não medido é `pending`, **nunca** `pass` |
| `core/evidence-collector.ts` | **Único** autorizado a afirmar que testes passaram: executa, conta, hasheia a saída |
| `core/reconciler.ts` | Declarado × observado; `syncDeclaredState` aplica o observado sobre o declarado |
| `core/artifact-schema.ts` / `migrator.ts` / `artifact-validator.ts` | Versão dos artefatos, migração honesta e validação contra os JSON Schemas |

### Refinamento e decisão

| Módulo | Responsabilidade |
| :--- | :--- |
| `core/bmad-engine.ts` | Briefing estruturado (Business, Modeling, Architecture, Delivery) |
| `core/grill-me-engine.ts` | Sondagem adversarial; separa **decisão** de **suposição** |
| `core/decision-recorder.ts` | ADRs sequenciais; `PROPOSED` enquanto houver suposição |
| `core/spec-engine.ts` | Contrato Spec Kit (`SPEC/REQ/AC`, Given-When-Then) |
| `core/id-registry.ts` | IDs sequenciais, sem colisão, auto-recuperáveis por varredura de disco |

### Governança

| Módulo | Responsabilidade |
| :--- | :--- |
| `core/policy-engine.ts` | Classifica a mudança e aplica `policies.yaml` (spec, TDD, commit atômico) |
| `core/gate-keeper.ts` | Human gates com *fingerprint* — aprovação sobrevive ao próximo run |
| `core/verifier.ts` | Fecha requisito **só** contra evidência executada; `BLOCKED` quando recusa |
| `core/team.ts` | Identidade, leases de fase/tarefa, split compartilhado × local |
| `core/audit-logger.ts` | Cadeia SHA-256 append-only; distingue adulteração de escrita concorrente |

### Orquestração

| Módulo | Responsabilidade |
| :--- | :--- |
| `core/orchestrator.ts` | O ciclo de 12 etapas; coordena e impõe, nunca executa |
| `core/task-compiler.ts` | DAG por Kahn, ciclos e conflito de escrita |
| `core/worktree-manager.ts` | Checkout isolado por tarefa em onda paralela |
| `core/milestone-manager.ts` | Roadmap: fase fecha quando seus requisitos fecham com evidência |
| `core/next-action.ts` | **Única** fonte da resposta "o que fazer agora" |
| `core/skill-registry.ts` | Skills mapeadas por estágio, recomendadas só quando instaladas |

---

## Onde cada invariante vive

| Invariante | Imposição | Como falha |
| :--- | :--- | :--- |
| Observado > Declarado | `Observer.observeTests` só reporta `pass` com evidência | `pending` = não medido |
| Nada PRONTO sem evidência | `Verifier.verify` + `EvidenceCollector.isClosable` | `BLOCKED` (nem pass, nem fail) |
| Suposição ≠ decisão | `GrillMeEngine.answer` marca `assumed` | ADR fica `PROPOSED` |
| Spec antes da implementação | `PolicyEngine.checkSpecRequirement` | run vai a `BLOCKED` |
| TDD estrito | `PolicyEngine.checkTaskReport` no `agentic report` | report recusado |
| Commit atômico por tarefa | idem, com `git rev-parse` do sha | report recusado |
| Autor ≠ verificador | `Verifier` (`fresh_context` satisfaz; `local` exige identidade distinta) | finding bloqueante |
| Human gates barram | `GateKeeper.evaluate` antes do despacho | `HUMAN_GATE` |
| Ownership isolado | `deriveTaskNodes` a partir de `scope.include` + worktrees | pack declara WRITE/FORBIDDEN |
| Documentação da realidade | `AsBuiltGenerator` a partir do diff e da evidência | só gera com verificação `PASS` |
| Loop idempotente | orçamento de remediação por requisito, persistido | 3 tentativas → gate |
| Auditabilidade | `AuditLogger` com `prev_hash`/`hash` | `agentic audit verify` acusa |

---

## Ciclo de estados

```
IDLE → OBSERVING → RECONCILING → PLANNING → SPECIFYING ──┬─▶ HUMAN_GATE (gate pendente)
                                                          │   BLOCKED    (política/lease)
                                                          ▼
                                    COMPILING → EXECUTION_READY → EXECUTING
                                                          │
                                                          ▼
                                                  AWAITING_AGENT ◀── agente implementa
                                                          │
                                              agentic verify
                                                          ▼
                                    REVIEWING → VERIFYING ──┬─▶ REMEDIATING (máx. 3 → gate)
                                                            │   HUMAN_GATE (BLOCKED: sem evidência)
                                                            ▼
                            RECONCILING_IMPLEMENTATION → AS_BUILT → UPDATING_STATE → COMPLETE
```

`AWAITING_AGENT` **não é falha**: é o framework esperando implementação. Transições vêm de `state-machine.yaml`, não de código.

---

## Artefatos

| Caminho | Conteúdo | Compartilhado? |
| :--- | :--- | :--- |
| `orchestrator/` | workflow, state machine, policies, gates, routing, providers, complexity, evidence, skills + schemas | sim |
| `planning/roadmap.yaml` | milestones e fases | sim |
| `planning/current-work-package.yaml` | pacote ativo (com `slices` e `change_kind`) | sim |
| `specs/planned/` `specs/decisions/` `specs/as-built/` | contratos, ADRs, as-built | sim |
| `registry/ids.json` | alocação sequencial de identificadores | sim (`merge=union`) |
| `gates/` | solicitações e decisões de human gate | sim |
| `verification/requirement-matrix.json` | matriz de fechamento | sim |
| `audit/events.jsonl` | cadeia de hash append-only | sim (`merge=union`) |
| `state/observed-state.json` | verdade medida deste checkout | **local** |
| `execution/inbox/` `results/` `runs/` | prompt packs, reports, runs | **local** |
| `verification/evidence/` | registros de execução de teste | **local** |
| `team/leases/` `worktrees/` | reivindicações e checkouts isolados | **local** |

Todo artefato carrega `schema_version`. Ver [versionamento no README](../README.md#versionamento-dos-artefatos).

---

## Decisões de design que valem registrar

**Por que o motor não usa LLM.** A CLI é determinística de propósito: as garantias (evidência, gates, IDs, auditoria) precisam ser reproduzíveis e testáveis. A inteligência mora no agente, que recebe um contrato explícito.

**Por que `BLOCKED` não é `FAIL`.** Recusar fechamento por falta de evidência é diferente de ter evidência de falha. Fundir os dois esconderia o caso mais perigoso: o que ninguém mediu.

**Por que a decomposição não é automática.** Dividir um épico é decisão de projeto. O framework compila a divisão declarada (`--split`) e serializa o que colide; inventar fatias seria repetir o erro do BMAD template.

**Por que a limpeza de worktree preserva branches.** Podem conter trabalho não mesclado; apagar commit alheio para arrumar a casa contradiz o resto do framework.
