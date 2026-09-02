import path from 'path';
import { BmadBriefing } from '../types/bmad.js';
import { GrillMeQuestion, GrillMeResult } from '../types/decision.js';

export interface GrillMeOptions {
  interactive?: boolean;
  /** Human answers keyed by probe id (GRILL-001, ...). */
  userAnswers?: Record<string, string>;
  /** Identity credited for the answers, for ADR authorship. */
  answeredBy?: string;
}

export class GrillMeEngine {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  /**
   * Runs the Grill-Me clarification and adversarial interrogation workflow on a prompt / BMAD briefing.
   */
  public grill(prompt: string, bmad?: BmadBriefing, options: GrillMeOptions = {}): GrillMeResult {
    const trimmed = prompt.trim();
    const domain = bmad ? this.inferDomainFromBriefing(bmad) : this.inferDomain(trimmed);

    const probes = this.generateProbes(trimmed, domain, bmad, options.userAnswers, options.answeredBy);

    // A probe answered by the engine's own default is an ASSUMPTION, not a decision.
    // Reporting defaults as "resolved decisions" is what turns adversarial probing
    // into theatre, so the two are kept strictly apart from here on.
    const unresolved_items: string[] = probes
      .filter((p) => p.assumed)
      .map((p) => `[${p.category.toUpperCase()}] ${p.question} (unanswered - default applied)`);

    const assumptions: string[] = probes
      .filter((p) => p.assumed)
      .map((p) => `${p.question} -> ${p.resolved_answer}`);

    const result: GrillMeResult = {
      raw_prompt: trimmed,
      interrogation_summary: this.generateSummary(trimmed, probes),
      probes,
      unresolved_items,
      assumptions,
      resolved_at: new Date().toISOString(),
      interactive: !!options.interactive,
      fully_resolved: probes.every((p) => !p.assumed),
    };

    return result;
  }

  /** Probes with no human answer yet, for interactive or file-driven answering. */
  public openQuestions(result: GrillMeResult): GrillMeQuestion[] {
    return result.probes.filter((p) => p.assumed);
  }

  public formatGrillReport(result: GrillMeResult): string {
    const lines: string[] = [
      `=============================================================`,
      `>>> GRILL-ME ADVERSARIAL PROBING REPORT`,
      `Prompt: "${result.raw_prompt}"`,
      `Probes: ${result.probes.length} | Human-answered: ${result.probes.filter((p) => !p.assumed).length} | Assumed defaults: ${result.probes.filter((p) => p.assumed).length}`,
      `=============================================================`,
      ``,
    ];

    for (const [idx, p] of result.probes.entries()) {
      lines.push(`[Q${idx + 1}] (${p.category.toUpperCase()}) ${p.question}`);
      lines.push(`     Context: ${p.context}`);
      lines.push(
        `  -> ${p.assumed ? 'ASSUMED DEFAULT (needs confirmation)' : `DECISION by ${p.answered_by || 'human'}`}: ${p.resolved_answer}`
      );
      lines.push(`     Rationale: ${p.rationale}`);
      lines.push(``);
    }

    if (result.unresolved_items.length > 0) {
      lines.push(`! ${result.unresolved_items.length} question(s) unanswered. Answer them to turn assumptions into decisions:`);
      for (const u of result.unresolved_items) {
        lines.push(`  - ${u}`);
      }
      lines.push(``);
      lines.push(`  Answer with: agentic grill "<prompt>" --answers answers.json`);
      lines.push(`  answers.json shape: { "GRILL-001": "...", "GRILL-003": "..." }`);
      lines.push(``);
    } else {
      lines.push(`+ Every probe was answered by a human: decisions are eligible for ACCEPTED ADR status.`);
      lines.push(``);
    }

    lines.push(`=============================================================`);
    return lines.join('\n');
  }

  private generateProbes(
    prompt: string,
    domain: string,
    bmad?: BmadBriefing,
    userAnswers: Record<string, string> = {},
    answeredBy?: string
  ): GrillMeQuestion[] {
    const lower = prompt.toLowerCase();
    const probes: GrillMeQuestion[] = [];

    // Probe 1: Boundary & Input Validation (Ambiguity)
    probes.push({
      id: 'GRILL-001',
      category: 'ambiguity',
      question: 'How should malformed, empty, or unexpected input payloads be handled?',
      context: 'Client requests may send corrupted types, missing required keys, or huge payloads.',
      options: [
        'Strict schema validation rejecting with 400 Bad Request and structured error envelope',
        'Lenient fallback with default values',
        'Silent drop of invalid attributes',
      ],
      recommended_option: 'Strict schema validation rejecting with 400 Bad Request and structured error envelope',
      ...this.answer('GRILL-001', userAnswers, answeredBy, 'Strict validation: all inputs validated via runtime schema validator (Zod/Ajv); reject malformed payloads immediately with HTTP 400 and code BAD_REQUEST.'),
      rationale: 'Prevents corrupted data from entering the domain layer and avoids injection vulnerabilities.',
    });

    // Probe 2: Error Handling & Failure Modes
    probes.push({
      id: 'GRILL-002',
      category: 'failure_mode',
      question: 'What is the failure strategy if downstream dependencies (database, external API, disk) fail or timeout?',
      context: 'Network partitions, downstream 500 errors, or connection pool exhaustion can cause cascade failures.',
      options: [
        'Fail fast with standard error envelope and bounded retry for idempotent operations',
        'Block indefinitely waiting for response',
        'Fallback to stale in-memory cache without notification',
      ],
      recommended_option: 'Fail fast with standard error envelope and bounded retry for idempotent operations',
      ...this.answer('GRILL-002', userAnswers, answeredBy, 'Fail fast with deterministic error envelope (HTTP 502/503/500) and structured logging; wrap external network calls with timeout boundaries.'),
      rationale: 'Protects application uptime, prevents hanging worker threads, and provides clear diagnostic trace.',
    });

    // Probe 3: Domain-specific Trade-offs (Security / Billing / Frontend / Database / General)
    if (domain === 'security' || lower.includes('auth') || lower.includes('jwt')) {
      probes.push({
        id: 'GRILL-003',
        category: 'trade_off',
        question: 'What is the token expiration, signing mechanism, and revocation strategy?',
        context: 'Long-lived tokens increase stolen credential exposure; purely stateless JWTs cannot be revoked instantly without a blacklist/store.',
        options: [
          'Short-lived Access Token (15m) + Long-lived Refresh Token (7d) stored securely with rotation',
          'Single long-lived JWT without refresh cycle',
          'Server-side session in database with cookie cookies',
        ],
        recommended_option: 'Short-lived Access Token (15m) + Long-lived Refresh Token (7d) stored securely with rotation',
        ...this.answer('GRILL-003', userAnswers, answeredBy, 'Dual token architecture: 15-minute Access Token signed with HMAC-SHA256 / RSA + single-use Refresh Token with automatic reuse detection and revocation.'),
        rationale: 'Industry gold standard for balancing stateless scalability with immediate breach containment.',
      });

      probes.push({
        id: 'GRILL-004',
        category: 'security',
        question: 'How are sensitive credentials, password hashes, and secrets protected at rest and in transit?',
        context: 'Plain-text passwords or exposed environment secrets in git cause fatal compliance breaches.',
        options: [
          'Argon2id/Bcrypt hashing for credentials, environment variable injection for secrets, HTTPS enforcement',
          'Base64 encoded tokens in config files',
        ],
        recommended_option: 'Argon2id/Bcrypt hashing for credentials, environment variable injection for secrets, HTTPS enforcement',
        ...this.answer('GRILL-004', userAnswers, answeredBy, 'Zero plain-text secrets; passwords hashed with Bcrypt/Argon2 with work factor >= 10; secrets strictly loaded via environment variables.'),
        rationale: 'Guarantees compliance and zero accidental secret leaks in repositories or logs.',
      });
    } else if (domain === 'billing' || lower.includes('webhook') || lower.includes('pagamento')) {
      probes.push({
        id: 'GRILL-003',
        category: 'trade_off',
        question: 'How is webhook idempotency and duplicate delivery guaranteed?',
        context: 'Payment gateways like Stripe deliver webhooks at-least-once; retries will process duplicate transactions if not deduplicated.',
        options: [
          'Idempotency key / Event ID storage with atomic check-and-insert in database',
          'Process blindly and hope for single delivery',
        ],
        recommended_option: 'Idempotency key / Event ID storage with atomic check-and-insert in database',
        ...this.answer('GRILL-003', userAnswers, answeredBy, 'Strict idempotency ledger: record event ID upon arrival in database; if already processed, return HTTP 200 immediately without reprocessing.'),
        rationale: 'Prevents double-charging, double-fulfillment, or duplicate ledger entries.',
      });
    } else if (domain === 'database' || lower.includes('migration') || lower.includes('tabela')) {
      probes.push({
        id: 'GRILL-003',
        category: 'trade_off',
        question: 'Is the database schema migration zero-downtime and backward-compatible?',
        context: 'Adding non-nullable columns without defaults or renaming columns breaks running instances before new code is deployed.',
        options: [
          'Expand-and-contract migration (nullable first / default values, separate deployment step)',
          'Hard table recreate / drop column',
        ],
        recommended_option: 'Expand-and-contract migration (nullable first / default values, separate deployment step)',
        ...this.answer('GRILL-003', userAnswers, answeredBy, 'Zero-downtime expand-and-contract migration: new columns added with default or nullable; no destructive drops in feature release.'),
        rationale: 'Prevents database deadlocks and deployment downtime.',
      });
    } else {
      probes.push({
        id: 'GRILL-003',
        category: 'trade_off',
        question: 'What architectural separation and module boundary is chosen for this implementation?',
        context: 'Tightly coupled code mixed in route handlers is hard to test and maintain.',
        options: [
          'Domain Service + Interface/Contract Separation + Clean Handler',
          'All logic directly inside single handler function',
        ],
        recommended_option: 'Domain Service + Interface/Contract Separation + Clean Handler',
        ...this.answer('GRILL-003', userAnswers, answeredBy, 'Layered Domain Architecture: Controller/Handler -> Service Layer -> Repository/Gateway, covered by unit tests with mocked I/O.'),
        rationale: 'Enables 100% automated testability and decoupled refactoring.',
      });
    }

    // Probe 4: Verification & Testability Criterion
    probes.push({
      id: 'GRILL-005',
      category: 'performance',
      question: 'What is the precise automated test criterion for marking this requirement DONE?',
      context: 'Subjective declarations of "done" without automated test proof fail the SDLC verifier.',
      options: [
        'Automated suite covering happy path, 4xx input errors, 5xx dependency failure, and contract schema',
        'Manual curl testing only',
      ],
      recommended_option: 'Automated suite covering happy path, 4xx input errors, 5xx dependency failure, and contract schema',
      ...this.answer('GRILL-005', userAnswers, answeredBy, 'Comprehensive automated test suite: unit tests for domain logic + contract integration test validating status codes, headers, and payloads.'),
      rationale: 'Ensures 100% compliance with Agentic SDLC Verification policy (No Done Without Evidence).',
    });

    return probes;
  }

  /**
   * Returns the answer fields for a probe, distinguishing a human answer from an
   * engine default. This is the difference between a decision and an assumption.
   */
  private answer(
    probeId: string,
    userAnswers: Record<string, string>,
    answeredBy: string | undefined,
    fallback: string
  ): Pick<GrillMeQuestion, 'resolved_answer' | 'assumed' | 'answered_by'> {
    const provided = userAnswers[probeId];
    if (provided && provided.trim().length > 0) {
      return { resolved_answer: provided.trim(), assumed: false, answered_by: answeredBy || 'human' };
    }
    return { resolved_answer: fallback, assumed: true };
  }

  private generateSummary(prompt: string, probes: GrillMeQuestion[]): string {
    const answered = probes.filter((p) => !p.assumed).length;
    const assumed = probes.length - answered;
    return `Interrogated "${prompt}" across ${probes.length} dimensions (input validation, failure modes, domain trade-offs, security, testability). ${answered} answered by a human; ${assumed} running on engine defaults that remain unconfirmed assumptions.`;
  }

  private inferDomainFromBriefing(bmad: BmadBriefing): string {
    const title = (bmad.title + ' ' + bmad.raw_prompt).toLowerCase();
    if (title.includes('auth') || title.includes('jwt') || title.includes('token') || title.includes('security')) {
      return 'security';
    }
    if (title.includes('pagamento') || title.includes('billing') || title.includes('stripe') || title.includes('webhook')) {
      return 'billing';
    }
    if (title.includes('database') || title.includes('banco') || title.includes('migration')) {
      return 'database';
    }
    if (title.includes('ui') || title.includes('frontend') || title.includes('tela') || title.includes('component')) {
      return 'frontend';
    }
    return 'backend';
  }

  private inferDomain(prompt: string): string {
    const lower = prompt.toLowerCase();
    if (lower.includes('auth') || lower.includes('jwt') || lower.includes('login') || lower.includes('token') || lower.includes('seguran')) {
      return 'security';
    }
    if (lower.includes('pagamento') || lower.includes('stripe') || lower.includes('webhook')) {
      return 'billing';
    }
    if (lower.includes('banco') || lower.includes('database') || lower.includes('sql') || lower.includes('tabela')) {
      return 'database';
    }
    if (lower.includes('ui') || lower.includes('tela') || lower.includes('frontend') || lower.includes('component')) {
      return 'frontend';
    }
    return 'backend';
  }
}
