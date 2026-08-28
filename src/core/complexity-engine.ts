import { ComplexityLevel, ComplexityConfig } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';

export interface ComplexityAssessmentInput {
  estimatedFiles: number;
  domainsCount: number;
  hasDatabaseMigration?: boolean;
  hasSecurityImpact?: boolean;
  hasBreakingChanges?: boolean;
}

export interface ComplexityResult {
  level: ComplexityLevel;
  strategy: string;
  useSwarm: boolean;
  factors: string[];
}

export class ComplexityEngine {
  private config: ComplexityConfig;

  constructor(configLoader?: ConfigLoader) {
    const loader = configLoader || new ConfigLoader();
    this.config = loader.loadComplexityConfig();
  }

  public assess(input: ComplexityAssessmentInput): ComplexityResult {
    const factors: string[] = [];
    let level: ComplexityLevel = 'S';

    if (input.estimatedFiles <= 2 && input.domainsCount <= 1) {
      level = 'XS';
    } else if (input.estimatedFiles <= 5 && input.domainsCount <= 1) {
      level = 'S';
    } else if (input.estimatedFiles <= 15 || input.domainsCount <= 3) {
      level = 'M';
    } else if (input.estimatedFiles <= 40 || input.domainsCount <= 5) {
      level = 'L';
    } else {
      level = 'XL';
    }

    if (input.hasDatabaseMigration) {
      factors.push('Database migration present (elevating risk)');
      if (level === 'XS') level = 'S';
    }

    if (input.hasSecurityImpact) {
      factors.push('Security/Auth impact detected');
      if (level === 'XS' || level === 'S') level = 'M';
    }

    if (input.hasBreakingChanges) {
      factors.push('Public API breaking changes detected');
      if (level === 'M') level = 'L';
    }

    const levelConfig = this.config.levels[level];
    const useSwarm = typeof levelConfig.swarm === 'boolean' ? levelConfig.swarm : levelConfig.swarm === 'true';

    return {
      level,
      strategy: levelConfig.agent_strategy,
      useSwarm,
      factors,
    };
  }
}
