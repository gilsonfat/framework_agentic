import fs from 'fs';
import path from 'path';
import { BmadBriefing } from '../types/bmad.js';
import { GrillMeResult, DecisionRecord } from '../types/decision.js';
import { IdRegistry } from './id-registry.js';

export class DecisionRecorder {
  private projectRoot: string;
  private idRegistry: IdRegistry;

  constructor(projectRoot: string = process.cwd(), idRegistry?: IdRegistry) {
    this.projectRoot = path.resolve(projectRoot);
    this.idRegistry = idRegistry || new IdRegistry(this.projectRoot);
  }

  /**
   * Transforms Grill-Me interrogations and BMAD briefings into formal Architectural Decision Records (ADRs).
   */
  public recordDecisions(
    runId: string,
    grillResult: GrillMeResult,
    bmad?: BmadBriefing,
    reqId?: string
  ): DecisionRecord[] {
    const decisionsDir = path.join(this.projectRoot, '.agentic', 'specs', 'decisions');
    if (!fs.existsSync(decisionsDir)) {
      fs.mkdirSync(decisionsDir, { recursive: true });
    }

    const records: DecisionRecord[] = [];
    const dateStr = new Date().toISOString().slice(0, 10);
    const targetReq = reqId || 'REQ-001';

    // 1. Core Architecture ADR.
    // Ids come from the sequential registry: random numbers collide across
    // developers and runs, which silently corrupts the decision ledger.
    const primaryAdrId = this.idRegistry.allocate('ADR', {
      runId,
      title: bmad ? bmad.title : grillResult.raw_prompt,
    });
    const primaryTitle = bmad ? `Architecture Decision: ${bmad.title}` : `Architecture Decision for ${grillResult.raw_prompt}`;

    const tradeOffs = grillResult.probes.map(
      (p) =>
        `[${p.category.toUpperCase()}]${p.assumed ? ' (ASSUMED)' : ''} ${p.question} -> ${p.resolved_answer}`
    );

    // An ADR whose trade-offs are all engine defaults has not been decided by
    // anyone: it stays PROPOSED until a human answers the open probes.
    const adrStatus: DecisionRecord['status'] = grillResult.fully_resolved ? 'ACCEPTED' : 'PROPOSED';

    const primaryRecord: DecisionRecord = {
      id: primaryAdrId,
      title: primaryTitle,
      status: adrStatus,
      date: dateStr,
      context: `Requirement context derived from prompt: "${grillResult.raw_prompt}". ${bmad ? bmad.business.objective : ''}`,
      decision: `Adopt ${bmad ? bmad.architecture.style : 'Layered Clean Architecture'} with explicit contract validation, isolated domain services, and strict TDD verification.`,
      alternatives_considered: [
        {
          option: 'Direct monolithic in-handler implementation without layer separation',
          pros: ['Faster initial code creation'],
          cons: ['Zero unit testability, tight coupling, hard to maintain and verify'],
        },
        {
          option: 'Full microservice extraction with distributed event bus',
          pros: ['High horizontal isolation'],
          cons: ['Excessive operational overhead and network latency for single domain scope'],
        },
      ],
      consequences: {
        positive: [
          'High testability and 100% automated verification capability',
          'Clear security and validation boundaries',
          'Decoupled business logic ready for extension',
        ],
        negative: [
          'Requires structured interfaces and schema contracts upfront',
        ],
        risks: [
          'Developers must adhere to layer boundaries and not bypass schemas',
          ...(grillResult.unresolved_items.length > 0
            ? [
                `${grillResult.unresolved_items.length} probe(s) were answered by engine defaults and are still unconfirmed assumptions.`,
              ]
            : []),
        ],
      },
      trade_offs: tradeOffs,
      verification_criteria: [
        'Automated test suite validates all contract inputs and outputs',
        'No plain-text credentials or unsecured endpoints exposed',
        'Verification report passes with 0 failures before requirement is marked DONE',
      ],
      linked_requirements: [targetReq],
    };

    records.push(primaryRecord);

    // Persist ADR markdown file
    this.saveAdrFile(primaryRecord, runId);

    // Update Decision Ledger Index
    this.updateDecisionLedger(records);

    return records;
  }

  private saveAdrFile(record: DecisionRecord, runId: string): string {
    const decisionsDir = path.join(this.projectRoot, '.agentic', 'specs', 'decisions');
    const slug = record.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 45);
    const filename = `${record.id}-${slug}.md`;
    const filePath = path.join(decisionsDir, filename);

    const markdown = `# ${record.id}: ${record.title}

> **Status**: ${record.status}  
> **Date**: ${record.date}  
> **Linked Requirements**: ${record.linked_requirements.join(', ')}  
> **Run ID**: ${runId}  

---

## Context
${record.context}

---

## Decision
${record.decision}

---

## Architectural Probes & Trade-Off Resolutions (Grill-Me)
${record.trade_offs.map((t) => `- ${t}`).join('\n')}

---

## Alternatives Considered
${record.alternatives_considered
  .map(
    (alt) => `### Option: ${alt.option}
- **Pros**: ${alt.pros.join(', ')}
- **Cons**: ${alt.cons.join(', ')}`
  )
  .join('\n\n')}

---

## Consequences
### Positive:
${record.consequences.positive.map((p) => `- ${p}`).join('\n')}

### Negative:
${record.consequences.negative.map((n) => `- ${n}`).join('\n')}

### Risks & Mitigations:
${record.consequences.risks.map((r) => `- ${r}`).join('\n')}

---

## Verification Criteria
${record.verification_criteria.map((v) => `- [ ] ${v}`).join('\n')}
`;

    fs.writeFileSync(filePath, markdown, 'utf8');
    return filePath;
  }

  private updateDecisionLedger(newRecords: DecisionRecord[]): void {
    const ledgerPath = path.join(this.projectRoot, '.agentic', 'specs', 'decisions', 'decision-ledger.json');
    let ledger: Record<string, DecisionRecord> = {};

    if (fs.existsSync(ledgerPath)) {
      try {
        ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
      } catch {
        ledger = {};
      }
    }

    for (const rec of newRecords) {
      ledger[rec.id] = rec;
    }

    fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2), 'utf8');
  }
}
