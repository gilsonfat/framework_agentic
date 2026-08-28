import fs from 'fs';
import path from 'path';

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

  public savePlannedSpec(specName: string, content: string): void {
    const plannedDir = path.join(this.projectRoot, '.agentic', 'specs', 'planned');
    if (!fs.existsSync(plannedDir)) {
      fs.mkdirSync(plannedDir, { recursive: true });
    }
    const filename = specName.endsWith('.md') ? specName : `${specName}.md`;
    fs.writeFileSync(path.join(plannedDir, filename), content, 'utf8');
  }
}
