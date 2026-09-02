import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { ConfigLoader } from './config-loader.js';
import { versionOf } from './artifact-schema.js';

export interface ArtifactValidation {
  artifact: string;
  schema: string;
  present: boolean;
  valid: boolean;
  version: number;
  errors: string[];
}

const ARTIFACTS: Array<{ file: string; schema: string; format: 'json' | 'yaml' }> = [
  { file: '.agentic/execution/current-run.json', schema: 'run', format: 'json' },
  { file: '.agentic/state/observed-state.json', schema: 'observed-state', format: 'json' },
  { file: '.agentic/planning/current-work-package.yaml', schema: 'work-package', format: 'yaml' },
  { file: '.agentic/verification/requirement-matrix.json', schema: 'requirement-closure', format: 'json' },
];

/**
 * Validates the artifacts on disk against the JSON Schemas the framework ships.
 *
 * The schemas existed from the start but nothing ever called them, so they could
 * drift from reality unnoticed - which is how the run status enum ended up
 * missing `AWAITING_AGENT` and the run id pattern rejected ids the CLI itself
 * produces. Running them turns the schemas into a real contract.
 */
export class ArtifactValidator {
  private projectRoot: string;
  private configLoader: ConfigLoader;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
  }

  public validateAll(): ArtifactValidation[] {
    return ARTIFACTS.map((entry) => this.validateOne(entry));
  }

  /** Only the artifacts that exist and failed validation. */
  public failures(): ArtifactValidation[] {
    return this.validateAll().filter((result) => result.present && !result.valid);
  }

  private validateOne(entry: { file: string; schema: string; format: 'json' | 'yaml' }): ArtifactValidation {
    const full = path.join(this.projectRoot, entry.file);

    if (!fs.existsSync(full)) {
      return { artifact: entry.file, schema: entry.schema, present: false, valid: true, version: 0, errors: [] };
    }

    let data: unknown;
    try {
      const raw = fs.readFileSync(full, 'utf8');
      data = entry.format === 'yaml' ? YAML.parse(raw) : JSON.parse(raw);
    } catch (error) {
      return {
        artifact: entry.file,
        schema: entry.schema,
        present: true,
        valid: false,
        version: 0,
        errors: [`unparseable: ${error instanceof Error ? error.message : String(error)}`],
      };
    }

    try {
      const result = this.configLoader.validateJson(entry.schema, data);
      return {
        artifact: entry.file,
        schema: entry.schema,
        present: true,
        valid: result.valid,
        version: versionOf(data),
        errors: result.errors || [],
      };
    } catch (error) {
      // Missing schema file: reported as a configuration problem, not as an
      // invalid artifact.
      return {
        artifact: entry.file,
        schema: entry.schema,
        present: true,
        valid: true,
        version: versionOf(data),
        errors: [`schema unavailable: ${error instanceof Error ? error.message : String(error)}`],
      };
    }
  }
}
