import { describe, it, expect } from 'vitest';
import { ComplexityEngine } from '../src/core/complexity-engine.js';
import { RoutingEngine } from '../src/core/routing-engine.js';

describe('Complexity & Routing Engine', () => {
  const complexityEngine = new ComplexityEngine();
  const routingEngine = new RoutingEngine();

  it('should assess XS/S tasks as single agent without swarm', () => {
    const xsResult = complexityEngine.assess({
      estimatedFiles: 2,
      domainsCount: 1,
    });
    expect(xsResult.level).toBe('XS');
    expect(xsResult.useSwarm).toBe(false);
    expect(xsResult.strategy).toBe('single');

    const sResult = complexityEngine.assess({
      estimatedFiles: 4,
      domainsCount: 1,
    });
    expect(sResult.level).toBe('S');
    expect(sResult.useSwarm).toBe(false);
  });

  it('should assess L/XL tasks as swarm', () => {
    const lResult = complexityEngine.assess({
      estimatedFiles: 25,
      domainsCount: 4,
    });
    expect(lResult.level).toBe('L');
    expect(lResult.useSwarm).toBe(true);
    expect(lResult.strategy).toBe('swarm');
  });

  it('should elevate complexity when security or migrations are present', () => {
    const elevated = complexityEngine.assess({
      estimatedFiles: 2,
      domainsCount: 1,
      hasDatabaseMigration: true,
      hasSecurityImpact: true,
    });
    expect(elevated.level).toBe('M');
    expect(elevated.factors.length).toBe(2);
  });

  it('should route domain to preferred agent and skills', () => {
    const dbRouting = routingEngine.getDomainRouting('database');
    expect(dbRouting.preferred_agent).toBe('database-engineer');
    expect(dbRouting.skills).toContain('migrations');

    const secRouting = routingEngine.getDomainRouting('security');
    expect(secRouting.mode).toBe('readonly');
  });

  it('should fallback execution provider when optional engine is missing', () => {
    const provider = routingEngine.resolveExecutionProvider();
    expect(provider.engine).toBeDefined();
  });
});
