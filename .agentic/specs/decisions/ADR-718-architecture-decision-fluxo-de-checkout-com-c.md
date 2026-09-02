# ADR-718: Architecture Decision: Fluxo de checkout com cartão de crédito

> **Status**: ACCEPTED  
> **Date**: 2026-09-02  
> **Linked Requirements**: REQ-611  
> **Run ID**: RUN-2026-09-02-611  

---

## Context
Requirement context derived from prompt: "Implementar fluxo de checkout com cartão de crédito". Implement robust, production-ready solution for: "Implementar fluxo de checkout com cartão de crédito" ensuring high reliability, testability, and zero regressions.

---

## Decision
Adopt Modular Service / Clean Architecture with explicit contract validation, isolated domain services, and strict TDD verification.

---

## Architectural Probes & Trade-Off Resolutions (Grill-Me)
- [AMBIGUITY] How should malformed, empty, or unexpected input payloads be handled? -> Strict validation: all inputs validated via runtime schema validator (Zod/Ajv); reject malformed payloads immediately with HTTP 400 and code BAD_REQUEST.
- [FAILURE_MODE] What is the failure strategy if downstream dependencies (database, external API, disk) fail or timeout? -> Fail fast with deterministic error envelope (HTTP 502/503/500) and structured logging; wrap external network calls with timeout boundaries.
- [TRADE_OFF] What architectural separation and module boundary is chosen for this implementation? -> Layered Domain Architecture: Controller/Handler -> Service Layer -> Repository/Gateway, covered by unit tests with mocked I/O.
- [PERFORMANCE] What is the precise automated test criterion for marking this requirement DONE? -> Comprehensive automated test suite: unit tests for domain logic + contract integration test validating status codes, headers, and payloads.

---

## Alternatives Considered
### Option: Direct monolithic in-handler implementation without layer separation
- **Pros**: Faster initial code creation
- **Cons**: Zero unit testability, tight coupling, hard to maintain and verify

### Option: Full microservice extraction with distributed event bus
- **Pros**: High horizontal isolation
- **Cons**: Excessive operational overhead and network latency for single domain scope

---

## Consequences
### Positive:
- High testability and 100% automated verification capability
- Clear security and validation boundaries
- Decoupled business logic ready for extension

### Negative:
- Requires structured interfaces and schema contracts upfront

### Risks & Mitigations:
- Developers must adhere to layer boundaries and not bypass schemas

---

## Verification Criteria
- [ ] Automated test suite validates all contract inputs and outputs
- [ ] No plain-text credentials or unsecured endpoints exposed
- [ ] Verification report passes with 0 failures before requirement is marked DONE
