import fs from 'fs';
import path from 'path';
import { BmadBriefing } from '../types/bmad.js';
import { DecisionRecord } from '../types/decision.js';
import { GitHubSpecKitDocument, SpecKitRequirement } from '../types/spec-kit.js';

export interface TLCRequirement {
  id: string;
  title: string;
  description: string;
  acceptance_criteria: string[];
}

export interface TLCSpecification {
  id: string;
  title: string;
  milestone: string;
  phase: string;
  requirements: TLCRequirement[];
}

export interface GenerateSpecKitOptions {
  reqId: string;
  phaseId: string;
  milestone?: string;
  promptText?: string;
  bmad?: BmadBriefing;
  decisions?: DecisionRecord[];
}

export class SpecEngine {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public validateRequirementId(id: string): boolean {
    return /^REQ-[0-9A-Za-z_-]+$/.test(id);
  }

  public validateAcceptanceCriteriaId(id: string): boolean {
    return /^AC-[0-9A-Za-z_-]+(\.[0-9]+)?$/.test(id);
  }

  public listPlannedSpecs(): string[] {
    const plannedDir = path.join(this.projectRoot, '.agentic', 'specs', 'planned');
    if (!fs.existsSync(plannedDir)) {
      return [];
    }
    return fs.readdirSync(plannedDir).filter((f) => f.endsWith('.md') || f.endsWith('.yaml') || f.endsWith('.json'));
  }

  public savePlannedSpec(specName: string, content: string): string {
    const plannedDir = path.join(this.projectRoot, '.agentic', 'specs', 'planned');
    if (!fs.existsSync(plannedDir)) {
      fs.mkdirSync(plannedDir, { recursive: true });
    }
    const filename = specName.endsWith('.md') ? specName : `${specName}.md`;
    const fullPath = path.join(plannedDir, filename);
    fs.writeFileSync(fullPath, content, 'utf8');
    return fullPath;
  }

  /**
   * Generates a GitHub Spec Kit compliant formal specification document.
   */
  public generateGitHubSpecKit(options: GenerateSpecKitOptions): GitHubSpecKitDocument {
    const reqNum = options.reqId.replace('REQ-', '');
    const title = options.bmad ? options.bmad.title : options.promptText || `Specification ${options.reqId}`;
    const milestone = options.milestone || 'M01';
    const phase = options.phaseId || `P-${reqNum}`;
    const dateStr = new Date().toISOString();

    const rawPrompt = options.bmad ? options.bmad.raw_prompt : options.promptText || title;
    const decisionsRefs = (options.decisions || []).map((d) => d.id);

    const specReq: SpecKitRequirement = {
      id: options.reqId,
      title,
      statement: `As a developer/consumer, I require "${rawPrompt}" so that the system provides verified and secure functionality.`,
      acceptance_criteria: [
        {
          id: `AC-${reqNum}.1`,
          description: `Primary feature capability executing successfully: ${rawPrompt}`,
          executable_check: `Automated test suite executes happy-path scenario with valid assertion proof`,
        },
        {
          id: `AC-${reqNum}.2`,
          description: `Strict input validation and boundary rejection on malformed inputs`,
          executable_check: `Input validator returns HTTP 400 Bad Request on missing/invalid parameters`,
        },
        {
          id: `AC-${reqNum}.3`,
          description: `Error containment and standard error envelopes on unexpected internal failures`,
          executable_check: `Unexpected errors caught gracefully returning standard structured error payload`,
        },
      ],
      scenarios: [
        {
          id: `SCENARIO-${reqNum}-01`,
          name: 'Happy Path Execution',
          given: 'The system is initialized and dependencies are healthy',
          when: `A valid request for "${rawPrompt}" is submitted`,
          then: 'The operation completes successfully with expected status code and valid payload structure',
          edge_cases: ['Idempotent repeated requests do not cause state corruption'],
        },
        {
          id: `SCENARIO-${reqNum}-02`,
          name: 'Invalid Payload Rejection',
          given: 'An incoming request contains missing required fields or invalid types',
          when: 'The request is processed by validation boundaries',
          then: 'The request is rejected immediately with 400 Bad Request and descriptive validation errors',
        },
      ],
      dependencies: [],
      decision_refs: decisionsRefs,
    };

    const doc: GitHubSpecKitDocument = {
      spec_id: `SPEC-${reqNum}`,
      title,
      version: '1.0.0',
      status: 'PLANNED',
      milestone,
      phase,
      overview: {
        problem_statement: options.bmad ? options.bmad.business.objective : `Fulfill requirement: ${rawPrompt}`,
        target_outcomes: [
          'High testability with 100% automated assertion evidence',
          'Production-grade error handling and security boundaries',
          'Zero unverified code changes or state drift',
        ],
        user_stories: [
          `Story 1: Enable ${title} capability with full test coverage`,
        ],
        boundaries: {
          in_scope: options.bmad ? options.bmad.business.scope_in : [`Implementation of ${rawPrompt}`, 'Automated TDD tests'],
          out_of_scope: options.bmad ? options.bmad.business.scope_out : ['Unrelated refactorings outside feature boundary'],
        },
      },
      contracts: {
        inputs: [
          { name: 'payload', type: 'object | RequestPayload', required: true, description: 'Validated request body or parameters' },
        ],
        outputs: [
          { name: 'result', type: 'object | StandardResultEnvelope', description: 'Standard success envelope containing response data' },
        ],
        error_envelopes: [
          { code: 'BAD_REQUEST', message: 'Input payload failed schema validation', recovery: 'Fix request parameters and retry' },
          { code: 'UNAUTHORIZED', message: 'Missing or invalid authentication token', recovery: 'Provide valid credentials or refresh token' },
          { code: 'INTERNAL_ERROR', message: 'Unexpected server-side error', recovery: 'Check audit logs and retry' },
        ],
      },
      requirements: [specReq],
      non_functional_requirements: {
        security: options.bmad ? options.bmad.architecture.security_boundaries : ['Strict input sanitization', 'Zero plain-text secrets in code'],
        performance: options.bmad ? options.bmad.architecture.performance_nfrs : ['P95 response time < 150ms'],
        reliability: ['Deterministic unit test execution with zero intermittent flakes'],
      },
      decisions_log: decisionsRefs,
      bmad_reference: options.bmad
        ? {
            briefing_title: options.bmad.title,
            engine: options.bmad.metadata.engine,
          }
        : undefined,
      created_at: dateStr,
    };

    return doc;
  }

  /**
   * Renders a GitHub Spec Kit specification as standardized Markdown.
   */
  public renderGitHubSpecKitMarkdown(doc: GitHubSpecKitDocument): string {
    return `# GitHub Spec Kit: ${doc.title} (${doc.spec_id})

> **Specification Standard**: GitHub Spec Kit (Spec-Driven Development / SDD)  
> **Milestone**: ${doc.milestone} | **Phase**: ${doc.phase}  
> **Status**: ${doc.status} | **Version**: ${doc.version}  
> **Created At**: ${doc.created_at}  
${doc.bmad_reference ? `> **BMAD Reference**: ${doc.bmad_reference.briefing_title} (${doc.bmad_reference.engine})\n` : ''}
${doc.decisions_log.length > 0 ? `> **Linked ADR Decisions**: ${doc.decisions_log.join(', ')}\n` : ''}

---

## 1. Overview & Objectives
### Problem Statement
${doc.overview.problem_statement}

### Target Outcomes
${doc.overview.target_outcomes.map((t) => `- ${t}`).join('\n')}

### User Stories
${doc.overview.user_stories.map((u) => `- ${u}`).join('\n')}

### Scope Boundaries
#### In-Scope:
${doc.overview.boundaries.in_scope.map((s) => `- ${s}`).join('\n')}

#### Out-of-Scope:
${doc.overview.boundaries.out_of_scope.map((s) => `- ${s}`).join('\n')}

---

## 2. Interface Contracts
### Input Parameters:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
${doc.contracts.inputs.map((i) => `| \`${i.name}\` | \`${i.type}\` | ${i.required ? 'Yes' : 'No'} | ${i.description} |`).join('\n')}

### Output Envelopes:
| Field | Type | Description |
|-------|------|-------------|
${doc.contracts.outputs.map((o) => `| \`${o.name}\` | \`${o.type}\` | ${o.description} |`).join('\n')}

### Error Envelopes:
| Code | Message | Recovery Action |
|------|---------|-----------------|
${doc.contracts.error_envelopes.map((e) => `| \`${e.code}\` | ${e.message} | ${e.recovery} |`).join('\n')}

---

## 3. Requirements & Acceptance Matrix
${doc.requirements
  .map(
    (req) => `### Requirement: ${req.id} — ${req.title}
**Statement**: ${req.statement}

#### Acceptance Criteria Matrix:
| ID | Criterion | Executable Test Check |
|----|-----------|------------------------|
${req.acceptance_criteria.map((ac) => `| \`${ac.id}\` | ${ac.description} | ${ac.executable_check} |`).join('\n')}

#### Scenario Trees (Given-When-Then):
${req.scenarios
  .map(
    (sc) => `##### Scenario ${sc.id}: ${sc.name}
- **Given**: ${sc.given}
- **When**: ${sc.when}
- **Then**: ${sc.then}
${sc.edge_cases ? `- **Edge Cases**: ${sc.edge_cases.join('; ')}` : ''}`
  )
  .join('\n\n')}
`
  )
  .join('\n')}

---

## 4. Non-Functional Requirements (NFRs)
### Security Boundaries:
${doc.non_functional_requirements.security.map((s) => `- ${s}`).join('\n')}

### Performance NFRs:
${doc.non_functional_requirements.performance.map((p) => `- ${p}`).join('\n')}

### Reliability:
${doc.non_functional_requirements.reliability.map((r) => `- ${r}`).join('\n')}
`;
  }

  /**
   * Saves a GitHub Spec Kit specification file to .agentic/specs/planned/.
   */
  public saveGitHubSpecKit(doc: GitHubSpecKitDocument): string {
    const markdown = this.renderGitHubSpecKitMarkdown(doc);
    return this.savePlannedSpec(doc.spec_id, markdown);
  }
}
