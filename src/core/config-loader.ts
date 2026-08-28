import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import AjvPackage from 'ajv';
import addFormatsPackage from 'ajv-formats';
import {
  WorkflowConfig,
  StateMachineConfig,
  PoliciesConfig,
  ComplexityConfig,
  GatesConfig,
  RoutingConfig,
  ProvidersConfig,
} from '../types/config.js';

// Handle ESM/CJS interop for Ajv and addFormats
const AjvClass = (AjvPackage as unknown as { default?: typeof AjvPackage }).default || AjvPackage;
const addFormats = (addFormatsPackage as unknown as { default?: typeof addFormatsPackage }).default || addFormatsPackage;

export class ConfigLoader {
  private ajv: any;
  private baseDir: string;
  private schemaDir: string;
  private orchestratorDir: string;

  constructor(projectRoot: string = process.cwd()) {
    this.baseDir = path.resolve(projectRoot, '.agentic');
    this.orchestratorDir = path.join(this.baseDir, 'orchestrator');
    this.schemaDir = path.join(this.orchestratorDir, 'schemas');
    this.ajv = new (AjvClass as any)({ allErrors: true, strict: false });
    (addFormats as any)(this.ajv);
  }

  public getBaseDir(): string {
    return this.baseDir;
  }

  public loadYaml<T>(filename: string): T {
    const fullPath = path.join(this.orchestratorDir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Configuration file not found: ${fullPath}`);
    }
    const content = fs.readFileSync(fullPath, 'utf8');
    return YAML.parse(content) as T;
  }

  public loadJsonSchema(schemaName: string): object {
    const filename = schemaName.endsWith('.schema.json')
      ? schemaName
      : `${schemaName}.schema.json`;
    const fullPath = path.join(this.schemaDir, filename);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`JSON Schema not found: ${fullPath}`);
    }
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  }

  public validateJson(schemaName: string, data: unknown): { valid: boolean; errors?: string[] } {
    const schema = this.loadJsonSchema(schemaName);
    const validate = this.ajv.compile(schema);
    const valid = validate(data);
    if (!valid && validate.errors) {
      const errors = validate.errors.map(
        (e: { instancePath?: string; message?: string }) => `${e.instancePath || 'root'}: ${e.message || 'Validation error'}`
      );
      return { valid: false, errors };
    }
    return { valid: true };
  }

  public loadWorkflowConfig(): WorkflowConfig {
    return this.loadYaml<WorkflowConfig>('workflow.yaml');
  }

  public loadStateMachineConfig(): StateMachineConfig {
    return this.loadYaml<StateMachineConfig>('state-machine.yaml');
  }

  public loadPoliciesConfig(): PoliciesConfig {
    return this.loadYaml<PoliciesConfig>('policies.yaml');
  }

  public loadComplexityConfig(): ComplexityConfig {
    return this.loadYaml<ComplexityConfig>('complexity.yaml');
  }

  public loadGatesConfig(): GatesConfig {
    return this.loadYaml<GatesConfig>('gates.yaml');
  }

  public loadRoutingConfig(): RoutingConfig {
    return this.loadYaml<RoutingConfig>('routing.yaml');
  }

  public loadProvidersConfig(): ProvidersConfig {
    return this.loadYaml<ProvidersConfig>('providers.yaml');
  }
}
