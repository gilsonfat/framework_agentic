import fs from 'fs';
import path from 'path';
import YAML from 'yaml';
import { WorkPackage } from '../types/task.js';
import { ConfigLoader } from './config-loader.js';
import { stampVersion } from './artifact-schema.js';

export class Planner {
  private projectRoot: string;
  private configLoader: ConfigLoader;

  constructor(projectRoot: string = process.cwd(), configLoader?: ConfigLoader) {
    this.projectRoot = path.resolve(projectRoot);
    this.configLoader = configLoader || new ConfigLoader(this.projectRoot);
  }

  public getCurrentWorkPackage(): WorkPackage {
    const pkgFile = path.join(this.projectRoot, '.agentic', 'planning', 'current-work-package.yaml');
    if (fs.existsSync(pkgFile)) {
      try {
        const content = fs.readFileSync(pkgFile, 'utf8');
        return YAML.parse(content) as WorkPackage;
      } catch {
        // fallback
      }
    }

    return {
      run_id: `RUN-${new Date().toISOString().slice(0, 10)}-0001`,
      milestone: 'M01',
      phase: 'P01',
      goal: 'Default bootstrap work package',
      scope: {
        include: ['*'],
        exclude: [],
      },
      requirements: [],
      dependencies: [],
      risks: [],
      blockers: [],
      complexity: 'S',
      expected_domains: ['backend'],
      human_gate_required: false,
    };
  }

  public saveWorkPackage(pkg: WorkPackage): void {
    const planningDir = path.join(this.projectRoot, '.agentic', 'planning');
    const historyDir = path.join(planningDir, 'history');
    if (!fs.existsSync(historyDir)) {
      fs.mkdirSync(historyDir, { recursive: true });
    }

    const currentFile = path.join(planningDir, 'current-work-package.yaml');
    const yamlContent = YAML.stringify(stampVersion(pkg));
    fs.writeFileSync(currentFile, yamlContent, 'utf8');

    const historyFile = path.join(historyDir, `${pkg.run_id}-work-package.yaml`);
    fs.writeFileSync(historyFile, yamlContent, 'utf8');
  }
}
