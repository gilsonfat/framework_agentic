# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

## [1.2.1] - 2026-09-02

Correções encontradas ao testar adoção em **projeto já em andamento**.

### Corrigido

- **Produto de IA ficava sem governança e a CLI dizia o contrário.** Num repositório com
  `AGENTS.md` próprio, o arquivo era preservado (correto) mas o protocolo nunca era
  instalado — e `agentic agents` reportava `[wired]` mesmo assim. Agora o protocolo é
  **anexado** dentro de marcadores (`BEGIN/END AGENTIC SDLC PROTOCOL`), preservando as
  regras da casa, e o estado `partial` existe para o caso em que o arquivo existe sem o
  protocolo. `doctor` avisa em **Ungoverned AI products**.
- **Segunda sincronização apagava as regras do time.** Depois do primeiro append o arquivo
  "parecia nosso" e era reescrito por inteiro. A detecção de propriedade passou a
  distinguir *arquivo gerado pelo framework* de *arquivo do projeto com um bloco nosso*.
- **`ROADMAP.md` existente era ignorado.** O ingestor só olhava `.planning/`; agora procura
  também na raiz e em `docs/`, e os itens viram fases no roadmap.

### Alterado

- Item marcado `[x]` no roadmap legado é importado como **`planned` + `declared_complete`**,
  nunca como concluído: um checkbox é declaração, não evidência. `agentic milestone status`
  mostra `~ declared done by the previous roadmap; no evidence here yet`.
- Fases importadas usam um espaço de ids próprio (`P-L01`) que não colide com os `P-###`
  alocados pelo registro.
- `vitest.config.ts`: timeout de 30s — os testes de integração criam projetos reais, rodam
  git e sobem processos; 5s estourava sob paralelismo mesmo com tudo certo.

## [1.2.0] - 2026-09-02

### Removido

- **Motor BMAD** (`bmad-engine.ts`, `types/bmad.ts`, provider `bmad`, briefings em
  `.agentic/prompts/BMAD-*.md`). O briefing era gerado por heurística de palavra-chave:
  saía praticamente o mesmo texto para qualquer pedido, e o que dele chegava ao ciclo era
  título, escopo em prosa (descartado pelo filtro de globs) e três riscos fixos. Remover
  eliminou ~600 linhas de template sem custar nenhum invariante.

### Alterado

- O título do work package e do contrato agora vem do próprio pedido (`deriveTitle`).
- `scope.include` carrega **apenas** padrões de caminho reais — antes vinha misturado com
  prosa que o compilador já descartava.
- Os riscos do work package passam a ser exatamente as sondagens sem resposta humana.
- `GrillMeEngine.grill(prompt, options)` e `DecisionRecorder.recordDecisions(runId, grill, options)`
  perderam o parâmetro de briefing.
- O Spec Kit continua gerando `SPEC/REQ/AC` e segue sustentando `policies.spec_required` e a
  exigência de critério de aceite na verificação.

## [1.1.0] - 2026-09-02

Reconstrução do núcleo. A versão 1.0.0 tinha a arquitetura certa e uma falha fatal: o orquestrador **fabricava a evidência** que seu próprio invariante exigia (`testOutput: 'PASS (mocked worker execution)'`), e o observer reportava `tests: pass` sem executar nada. Esta versão fecha esse buraco e amarra as pontas em volta dele.

### Adicionado

**Evidência e verificação**
- `EvidenceCollector`: único componente autorizado a afirmar que testes passaram — executa o comando, captura exit code, faz parsing de vitest/jest/pytest/go/cargo/node:test e guarda o SHA-256 da saída completa.
- Status `BLOCKED` na verificação: recusa de fechamento não é aprovação nem falha.
- `agentic evidence`, `agentic verify`.

**Fronteira de execução**
- `AgentBridge`: compila cada tarefa em um *prompt pack* autocontido (critérios de aceite, ADRs vinculantes, limites WRITE/READ-ONLY/FORBIDDEN, skills do estágio, obrigações de política).
- Estado `AWAITING_AGENT` e o fluxo de duas fases (`prompt` → implementação → `report` → `verify`).
- Modo `command` para entregar tarefas a uma CLI de agente.

**Governança**
- `GateKeeper`: human gates que realmente barram, com *fingerprint* — a aprovação sobrevive ao próximo run.
- `PolicyEngine`: classifica a mudança e aplica `spec_required`, `tdd`, `git.atomic_commit_per_task`, `worktree.parallel_agents`, `loop.reobserve_after_success`, `documentation.generate_as_built`.
- `agentic report --force` registra exceção de política na auditoria (`POLICY_OVERRIDDEN`).

**Equipe**
- `TeamCoordinator`: identidade por `git user.email`, leases de fase/tarefa com TTL, split declarado entre verdade compartilhada e artefato local (`.agentic/.gitignore`, `merge=union`).
- Cadeia de hash SHA-256 na auditoria, com distinção entre adulteração e escrita concorrente.

**Identidade e roadmap**
- `IdRegistry`: IDs sequenciais, sem colisão, recuperáveis por varredura de disco.
- `MilestoneManager` + `.agentic/planning/roadmap.yaml`: fase fecha quando seus requisitos fecham **com evidência**; milestone fecha quando todas as fases fecham.
- `agentic milestone status|list|new|activate|advance`.

**Integrações**
- 8 produtos de IA conectados ao mesmo protocolo: Claude Code, Antigravity, Gemini CLI, Codex, ChatGPT, Cursor, Copilot, Windsurf.
- `agentic agents list|sync`; `.claude/settings.json` mesclado (allowlist + hook de SessionStart).
- Pacote de skills `mattpocock/skills` mapeado por estágio do ciclo (`agentic skills`).

**Robustez**
- `schema_version` em todo artefato + `agentic migrate` (dry run por padrão).
- Validação dos artefatos contra os JSON Schemas que já eram publicados e nunca eram usados.
- `agentic next`: fonte única da resposta "o que fazer agora".
- Worktree git por tarefa em onda paralela (`agentic worktree list|clean`).
- Decomposição de épico em fatias (`agentic prompt --split ... --parallel`).
- CI (`.github/workflows/ci.yml`): build/test em Node 20 e 22, auto-verificação e smoke de instalação.

### Corrigido

- Orquestrador não simula mais execução nem sintetiza resultados de teste.
- `Observer` não reporta `pass` sem medir; status não medido é `pending`.
- IDs deixaram de ser aleatórios (`REQ-${random}`), que colidiam entre pessoas e runs.
- Human gates deixaram de ser calculados e ignorados.
- Orçamento de remediação persiste por requisito (antes, um run novo zerava o limite de 3 tentativas).
- Etapa 12 volta a convergir: o estado declarado é reescrito a partir do observado.
- `Doctor` deixou de aprovar providers com `return true` fixo; passou a checar integridade, evidência e fechamentos sem lastro.
- `Scaffolder` não vaza mais specs, ADRs e estado deste repositório para projetos novos.
- Ownership da tarefa segue o escopo do work package (antes era sempre `src/**` — em monorepo, o repositório inteiro).
- Erros da CLI viraram mensagens acionáveis com exit code correto, em vez de stack trace do Node.
- ADRs nascem `PROPOSED` quando as sondagens continuam sem resposta humana.

### Movido

- `AGENTIC_SDLC_ORCHESTRATOR_MASTER_GUIDE.md` → `docs/archive/master-guide-v1.md`, com aviso de documento superado. A referência viva passa a ser `README.md` + `docs/ARCHITECTURE.md` + `AGENTS.md`.

## [1.0.0]

Versão inicial: ciclo de 12 etapas, máquina de estados em YAML, compilador de DAG, engines de briefing/Grill-Me/Spec Kit e scaffolding `.agentic/`.
