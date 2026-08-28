import { RoutingConfig, ProvidersConfig, DomainRouting } from '../types/config.js';
import { ConfigLoader } from './config-loader.js';

export class RoutingEngine {
  private routingConfig: RoutingConfig;
  private providersConfig: ProvidersConfig;

  constructor(configLoader?: ConfigLoader) {
    const loader = configLoader || new ConfigLoader();
    this.routingConfig = loader.loadRoutingConfig();
    this.providersConfig = loader.loadProvidersConfig();
  }

  public getDomainRouting(domain: string): DomainRouting {
    const routing = this.routingConfig.routing[domain.toLowerCase()];
    if (routing) {
      return routing;
    }
    return {
      preferred_agent: 'general-engineer',
      skills: ['general'],
      mode: 'standard',
    };
  }

  public resolveExecutionProvider(): { engine: string; isFallback: boolean } {
    const execProvider = this.providersConfig.providers.execution;
    if (execProvider && execProvider.engine) {
      return {
        engine: execProvider.engine,
        isFallback: false,
      };
    }
    return {
      engine: execProvider?.fallback || 'native-agent',
      isFallback: true,
    };
  }

  public resolveVerificationProvider(): { engine: string; freshContext: boolean } {
    const verProvider = this.providersConfig.providers.verification;
    return {
      engine: verProvider?.engine || 'tlc-spec-driven',
      freshContext: Boolean(verProvider?.fresh_context),
    };
  }
}
