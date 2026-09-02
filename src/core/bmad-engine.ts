import fs from 'fs';
import path from 'path';
import { BmadBriefing } from '../types/bmad.js';

export interface BmadEnhanceOptions {
  domain?: string;
  projectContext?: {
    projectName?: string;
    hasDatabase?: boolean;
    hasAuth?: boolean;
    framework?: string;
  };
}

export class BmadEngine {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * Enhances any raw user prompt into a structured BMAD Briefing (Business, Modeling, Architecture, Delivery).
   */
  public enhancePrompt(rawPrompt: string, options: BmadEnhanceOptions = {}): BmadBriefing {
    const trimmed = rawPrompt.trim();
    if (!trimmed) {
      throw new Error('BMAD prompt instruction cannot be empty.');
    }

    const domain = options.domain || this.inferDomain(trimmed);
    const title = this.generateTitle(trimmed);
    const business = this.deriveBusiness(trimmed, domain);
    const modeling = this.deriveModeling(trimmed, domain);
    const architecture = this.deriveArchitecture(trimmed, domain);
    const delivery = this.deriveDelivery(trimmed, domain);

    const enhancedPrompt = this.formatEnhancedPromptText({
      title,
      rawPrompt: trimmed,
      business,
      modeling,
      architecture,
      delivery,
    });

    const briefing: BmadBriefing = {
      raw_prompt: trimmed,
      enhanced_prompt: enhancedPrompt,
      title,
      business,
      modeling,
      architecture,
      delivery,
      metadata: {
        engine: 'bmad-method',
        version: '1.2.0',
        generated_at: new Date().toISOString(),
      },
    };

    return briefing;
  }

  /**
   * Persists the BMAD Briefing to the .agentic/prompts directory.
   */
  public saveBriefing(briefing: BmadBriefing, runId?: string): string {
    const promptsDir = path.join(this.projectRoot, '.agentic', 'prompts');
    if (!fs.existsSync(promptsDir)) {
      fs.mkdirSync(promptsDir, { recursive: true });
    }

    const slug = briefing.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 40);
    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = runId
      ? `BMAD-${runId}-${slug}.md`
      : `BMAD-${timestamp}-${slug}.md`;

    const filePath = path.join(promptsDir, filename);
    const markdown = this.renderMarkdownBriefing(briefing);
    fs.writeFileSync(filePath, markdown, 'utf8');

    return filePath;
  }

  private inferDomain(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes('banco') || lower.includes('database') || lower.includes('migration') || lower.includes('sql') || lower.includes('tabela')) {
      return 'database';
    }
    if (lower.includes('auth') || lower.includes('jwt') || lower.includes('login') || lower.includes('token') || lower.includes('seguran') || lower.includes('security')) {
      return 'security';
    }
    if (lower.includes('tela') || lower.includes('ui') || lower.includes('layout') || lower.includes('frontend') || lower.includes('component') || lower.includes('css')) {
      return 'frontend';
    }
    if (lower.includes('teste') || lower.includes('test') || lower.includes('e2e') || lower.includes('coverage')) {
      return 'testing';
    }
    if (lower.includes('pagamento') || lower.includes('stripe') || lower.includes('webhook') || lower.includes('pix') || lower.includes('checkout')) {
      return 'billing';
    }
    return 'backend';
  }

  private generateTitle(prompt: string): string {
    const clean = prompt
      .replace(/^(por favor|crie|criar|adicione|adicionar|implemente|implementar|fazer|ajustar)\s+/i, '')
      .trim();
    if (clean.length > 50) {
      return clean.slice(0, 47) + '...';
    }
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  private deriveBusiness(prompt: string, domain: string) {
    const lower = prompt.toLowerCase();
    const objective = `Implement robust, production-ready solution for: "${prompt}" ensuring high reliability, testability, and zero regressions.`;
    const stakeholders = ['Product Owner', 'Development Team', 'Security/Compliance Lead', 'QA Verifier'];
    const valueProposition = `Delivers verifiable business capability for ${domain} with explicit contract enforcement and deterministic test verification.`;

    const scope_in = [
      `Core feature implementation matching the intent: ${prompt}`,
      `Automated unit, contract, and integration test coverage (TDD)`,
      `Strict error handling and input validation`,
    ];

    const scope_out = [
      `Unrelated architectural refactoring outside the feature boundary`,
      `Manual configuration steps not covered by automated tests`,
      `Deprecated patterns or unverified third-party libraries`,
    ];

    const business_rules = [
      `Must adhere to strict TDD: Red -> Green -> Refactor`,
      `No requirement is DONE without executable test evidence`,
      `Zero plain-text secrets; all credentials and tokens must be injected safely`,
    ];

    if (domain === 'security' || lower.includes('auth')) {
      business_rules.push('Tokens must have bounded TTL and cryptographically signed headers');
      business_rules.push('Revoked or malformed tokens must immediately return 401 Unauthorized with standard error payload');
    }

    if (domain === 'billing' || lower.includes('webhook') || lower.includes('pagamento')) {
      business_rules.push('Webhook processing must be strictly idempotent using idempotency keys / event IDs');
      business_rules.push('Payload signatures (HMAC / webhook secret) must be validated before processing');
    }

    return { objective, stakeholders, value_proposition: valueProposition, scope_in, scope_out, business_rules };
  }

  private deriveModeling(prompt: string, domain: string) {
    const lower = prompt.toLowerCase();
    const domain_entities: string[] = [];
    const state_models: string[] = [];
    const lifecycle_events: string[] = [];
    const data_contracts: string[] = [];

    if (domain === 'security' || lower.includes('auth')) {
      domain_entities.push('User', 'Session', 'AuthToken', 'RefreshTokenPayload', 'AccessControlContext');
      state_models.push('SessionState: INITIALIZING -> ACTIVE -> EXPIRED -> REVOKED');
      lifecycle_events.push('UserAuthenticatedEvent', 'TokenRefreshedEvent', 'SessionRevokedEvent', 'AuthFailedEvent');
      data_contracts.push('TokenPayloadSchema { userId, role, exp, iat, jti }', 'AuthResponseSchema { accessToken, refreshToken, expiresIn }');
    } else if (domain === 'billing' || lower.includes('pagamento')) {
      domain_entities.push('PaymentOrder', 'TransactionRecord', 'WebhookEvent', 'CustomerAccount');
      state_models.push('PaymentState: PENDING -> PROCESSING -> SUCCEEDED | FAILED | REFUNDED');
      lifecycle_events.push('PaymentInitiatedEvent', 'WebhookReceivedEvent', 'PaymentConfirmedEvent', 'PaymentFailedEvent');
      data_contracts.push('WebhookPayloadSchema { id, type, created, data: { object } }', 'PaymentIntentResponseSchema { status, clientSecret, amount }');
    } else if (domain === 'frontend' || lower.includes('ui')) {
      domain_entities.push('UIComponentProps', 'ViewState', 'UserAction', 'ThemeContext');
      state_models.push('UIState: IDLE -> LOADING -> SUCCESS -> ERROR');
      lifecycle_events.push('ActionTriggeredEvent', 'StateUpdatedEvent', 'RenderCompletedEvent');
      data_contracts.push('ComponentPropsContract { id, data, onAction, disabled }');
    } else {
      domain_entities.push('PrimaryEntity', 'CommandPayload', 'QueryFilter', 'DomainResult');
      state_models.push('EntityLifecycle: DRAFT -> ACTIVE -> ARCHIVED');
      lifecycle_events.push('EntityCreatedEvent', 'EntityUpdatedEvent', 'EntityProcessedEvent');
      data_contracts.push('CommandRequestSchema { id, payload, timestamp }', 'StandardResultEnvelope { success, data, error }');
    }

    return { domain_entities, state_models, lifecycle_events, data_contracts };
  }

  private deriveArchitecture(prompt: string, domain: string) {
    const patterns = ['Layered Architecture', 'Ports & Adapters (Hexagonal)', 'Contract-First API Design'];
    const components = ['Service Handler', 'Validation Middleware', 'Domain Repository / Gateway', 'Automated Test Harness'];
    const integration_points = ['HTTP / REST Layer', 'Database / Storage', 'Event Dispatcher'];
    const security_boundaries = [
      'Strict input schema validation via Zod / Ajv',
      'Contextual error suppression (never leak stack traces or internals to clients)',
      'Secure header hygiene and least-privilege boundary execution',
    ];
    const performance_nfrs = [
      'P95 latency under 150ms for synchronous request flows',
      'Deterministic execution with zero resource / connection leaks',
      'Memory consumption bounded and GC friendly',
    ];

    return {
      style: 'Modular Service / Clean Architecture',
      patterns,
      components,
      integration_points,
      security_boundaries,
      performance_nfrs,
    };
  }

  private deriveDelivery(prompt: string, domain: string) {
    const slices = [
      'Slice 1: Automated Unit & Contract Test Suite (RED baseline)',
      'Slice 2: Domain Logic & Core Implementation (GREEN validation)',
      'Slice 3: Edge Case, Security, and Error Resilience (REFACTOR & Hardening)',
      'Slice 4: Integration Verification and As-Built Spec Generation',
    ];
    const testability_strategy = 'Strict Test-Driven Development (TDD). Executable test suite validates every acceptance criterion with 100% assertion evidence.';
    const key_risks = [
      'Unchecked boundary inputs causing runtime crashes',
      'State drift between declared spec and real codebase',
      'Unhandled asynchronous rejections or timeout cascades',
    ];

    return { slices, testability_strategy, key_risks };
  }

  private formatEnhancedPromptText(briefing: {
    title: string;
    rawPrompt: string;
    business: { objective: string; scope_in: string[]; scope_out: string[]; business_rules: string[] };
    modeling: { domain_entities: string[]; state_models: string[]; data_contracts: string[] };
    architecture: { patterns: string[]; security_boundaries: string[]; performance_nfrs: string[] };
    delivery: { slices: string[]; testability_strategy: string };
  }): string {
    return [
      `### [BMAD ENHANCED BRIEFING] ${briefing.title}`,
      ``,
      `**Original Goal**: ${briefing.rawPrompt}`,
      ``,
      `#### 1. Business & Scope`,
      `- Objective: ${briefing.business.objective}`,
      `- Scope In: ${briefing.business.scope_in.join(', ')}`,
      `- Scope Out: ${briefing.business.scope_out.join(', ')}`,
      `- Core Rules: ${briefing.business.business_rules.join('; ')}`,
      ``,
      `#### 2. Domain Modeling`,
      `- Entities: ${briefing.modeling.domain_entities.join(', ')}`,
      `- State Models: ${briefing.modeling.state_models.join(', ')}`,
      `- Data Contracts: ${briefing.modeling.data_contracts.join(', ')}`,
      ``,
      `#### 3. Architecture & Security`,
      `- Patterns: ${briefing.architecture.patterns.join(', ')}`,
      `- Security Boundaries: ${briefing.architecture.security_boundaries.join('; ')}`,
      `- Performance NFRs: ${briefing.architecture.performance_nfrs.join('; ')}`,
      ``,
      `#### 4. Delivery Strategy`,
      `- Incremental Slices: ${briefing.delivery.slices.join(' -> ')}`,
      `- Test Strategy: ${briefing.delivery.testability_strategy}`,
    ].join('\n');
  }

  private renderMarkdownBriefing(briefing: BmadBriefing): string {
    return `# BMAD Briefing: ${briefing.title}

> **Framework**: BMAD (Business, Modeling, Architecture, Delivery)  
> **Engine**: ${briefing.metadata.engine} v${briefing.metadata.version}  
> **Generated At**: ${briefing.metadata.generated_at}  

---

## 1. Business Requirements & Intent
- **Raw User Request**: \`${briefing.raw_prompt}\`
- **Objective**: ${briefing.business.objective}
- **Value Proposition**: ${briefing.business.value_proposition}
- **Stakeholders**: ${briefing.business.stakeholders.join(', ')}

### Scope Boundaries
#### In-Scope:
${briefing.business.scope_in.map((s) => `- ${s}`).join('\n')}

#### Out-of-Scope:
${briefing.business.scope_out.map((s) => `- ${s}`).join('\n')}

### Non-Negotiable Business Rules:
${briefing.business.business_rules.map((r) => `- ${r}`).join('\n')}

---

## 2. Domain & Data Modeling
### Domain Entities
${briefing.modeling.domain_entities.map((e) => `- \`${e}\``).join('\n')}

### State Models & Transitions
${briefing.modeling.state_models.map((sm) => `- ${sm}`).join('\n')}

### Lifecycle Events
${briefing.modeling.lifecycle_events.map((ev) => `- \`${ev}\``).join('\n')}

### Data Contracts & Schemas
${briefing.modeling.data_contracts.map((c) => `- ${c}`).join('\n')}

---

## 3. Architecture & Guardrails
- **Architecture Style**: ${briefing.architecture.style}
- **Patterns**: ${briefing.architecture.patterns.join(', ')}
- **Components**: ${briefing.architecture.components.join(', ')}
- **Integration Points**: ${briefing.architecture.integration_points.join(', ')}

### Security Boundaries:
${briefing.architecture.security_boundaries.map((b) => `- ${b}`).join('\n')}

### Performance & NFRs:
${briefing.architecture.performance_nfrs.map((n) => `- ${n}`).join('\n')}

---

## 4. Delivery & Testability
### Execution Slices:
${briefing.delivery.slices.map((sl) => `- ${sl}`).join('\n')}

### Testability Strategy:
${briefing.delivery.testability_strategy}

### Key Risks & Mitigations:
${briefing.delivery.key_risks.map((k) => `- ${k}`).join('\n')}
`;
  }
}
