import fs from 'fs';
import path from 'path';
import { TaskContract, TaskDAGNode, TaskOwnership } from '../types/task.js';
import { AuditLogger } from './audit-logger.js';

export interface TaskExecutionResult {
  taskId: string;
  success: boolean;
  filesChanged: string[];
  testsCreated: string[];
  testOutput: string;
  commitHash?: string;
  error?: string;
}

export class Executor {
  private projectRoot: string;
  private auditLogger: AuditLogger;

  constructor(projectRoot: string = process.cwd(), auditLogger?: AuditLogger) {
    this.projectRoot = path.resolve(projectRoot);
    this.auditLogger = auditLogger || new AuditLogger(this.projectRoot);
  }

  public createTaskContract(node: TaskDAGNode): TaskContract {
    return {
      id: node.id,
      title: node.title,
      role: `${node.domain}-engineer`,
      objective: `Implement ${node.title}`,
      domain: node.domain,
      requirements: node.requirements,
      acceptance_criteria: node.acceptance_criteria,
      dependencies: node.dependencies,
      ownership: node.ownership,
      process: {
        tdd: true,
        systematic_debugging: true,
        verification_before_completion: true,
      },
      output: {
        implementation_report: true,
        tests: true,
        commit: true,
      },
      completion: {
        tests_must_pass: true,
        no_self_declared_done: true,
      },
    };
  }

  public saveTaskContract(contract: TaskContract): void {
    const currentTasksDir = path.join(this.projectRoot, '.agentic', 'tasks', 'current');
    if (!fs.existsSync(currentTasksDir)) {
      fs.mkdirSync(currentTasksDir, { recursive: true });
    }
    const taskFile = path.join(currentTasksDir, `${contract.id}.json`);
    fs.writeFileSync(taskFile, JSON.stringify(contract, null, 2), 'utf8');
  }

  public recordTaskCompletion(runId: string, result: TaskExecutionResult): void {
    if (result.success) {
      this.auditLogger.emit(runId, 'TASK_COMPLETED', {
        task: result.taskId,
        commit: result.commitHash,
        metadata: {
          filesChanged: result.filesChanged,
          testsCreated: result.testsCreated,
        },
      });
    } else {
      this.auditLogger.emit(runId, 'TASK_FAILED', {
        task: result.taskId,
        metadata: {
          error: result.error,
        },
      });
    }
  }
}
