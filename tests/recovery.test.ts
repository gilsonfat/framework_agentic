import { describe, it, expect } from 'vitest';
import { RecoveryEngine } from '../src/core/recovery.js';

describe('RecoveryEngine', () => {
  const recovery = new RecoveryEngine();

  it('should inspect current run and generate safe recovery plan', () => {
    const plan = recovery.planRecovery();
    expect(plan).toBeDefined();
    expect(typeof plan.canResume).toBe('boolean');
    expect(plan.reason).toBeDefined();
  });
});
