import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { TaskCompiler } from '../src/core/task-compiler.js';
import { TaskDAGNode } from '../src/types/task.js';

describe('TaskCompiler', () => {
  let tempDir: string;
  let compiler: TaskCompiler;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-dag-'));
    compiler = new TaskCompiler(tempDir);
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should compile linear dependent tasks into sequential DAG', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Database Schema',
        domain: 'database',
        requirements: ['REQ-001'],
        acceptance_criteria: ['AC-001.1'],
        dependencies: [],
        ownership: { write: ['src/db/**'] },
      },
      {
        id: 'TASK-002',
        title: 'Backend API',
        domain: 'backend',
        requirements: ['REQ-001'],
        acceptance_criteria: ['AC-001.2'],
        dependencies: ['TASK-001'],
        ownership: { write: ['src/api/**'] },
      },
    ];

    const dag = compiler.compile(nodes);
    expect(dag.nodes.length).toBe(2);
    expect(dag.edges.length).toBe(1);
    expect(dag.edges[0]).toEqual({ from: 'TASK-001', to: 'TASK-002' });
    expect(dag.parallel_groups).toEqual([['TASK-001'], ['TASK-002']]);
    expect(dag.critical_path).toEqual(['TASK-001', 'TASK-002']);
    expect(dag.conflicts).toHaveLength(0);
  });

  it('should detect parallel task groups', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Core Schema',
        domain: 'database',
        requirements: ['REQ-001'],
        acceptance_criteria: ['AC-001.1'],
        dependencies: [],
        ownership: { write: ['src/db/**'] },
      },
      {
        id: 'TASK-002',
        title: 'Backend Auth',
        domain: 'backend',
        requirements: ['REQ-002'],
        acceptance_criteria: ['AC-002.1'],
        dependencies: ['TASK-001'],
        ownership: { write: ['src/auth/**'] },
      },
      {
        id: 'TASK-003',
        title: 'Frontend Auth View',
        domain: 'frontend',
        requirements: ['REQ-002'],
        acceptance_criteria: ['AC-002.2'],
        dependencies: ['TASK-001'],
        ownership: { write: ['src/views/auth/**'] },
      },
    ];

    const dag = compiler.compile(nodes);
    expect(dag.parallel_groups).toHaveLength(2);
    expect(dag.parallel_groups[0]).toEqual(['TASK-001']);
    expect(dag.parallel_groups[1]).toContain('TASK-002');
    expect(dag.parallel_groups[1]).toContain('TASK-003');
    expect(dag.conflicts).toHaveLength(0);
  });

  it('should throw an error and block execution when a cycle is detected', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Task A',
        domain: 'backend',
        requirements: [],
        acceptance_criteria: [],
        dependencies: ['TASK-002'],
        ownership: { write: ['src/a.ts'] },
      },
      {
        id: 'TASK-002',
        title: 'Task B',
        domain: 'backend',
        requirements: [],
        acceptance_criteria: [],
        dependencies: ['TASK-001'],
        ownership: { write: ['src/b.ts'] },
      },
    ];

    expect(() => compiler.compile(nodes)).toThrow(/Dependency cycle detected/);
  });

  it('should detect write conflicts for parallel tasks modifying overlapping files', () => {
    const nodes: TaskDAGNode[] = [
      {
        id: 'TASK-001',
        title: 'Module A User Service',
        domain: 'backend',
        requirements: [],
        acceptance_criteria: [],
        dependencies: [],
        ownership: { write: ['src/services/**'] },
      },
      {
        id: 'TASK-002',
        title: 'Module B User Service',
        domain: 'backend',
        requirements: [],
        acceptance_criteria: [],
        dependencies: [],
        ownership: { write: ['src/services/user.ts'] },
      },
    ];

    const dag = compiler.compile(nodes);
    expect(dag.conflicts.length).toBeGreaterThan(0);
    expect(dag.conflicts[0].task_a).toBe('TASK-001');
    expect(dag.conflicts[0].task_b).toBe('TASK-002');
  });
});
