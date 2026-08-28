import fs from 'fs';
import path from 'path';
import { TaskDAG, TaskDAGNode, TaskDAGEdge, WriteConflict } from '../types/task.js';

export class TaskCompiler {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = path.resolve(projectRoot);
  }

  public compile(nodes: TaskDAGNode[]): TaskDAG {
    const nodeMap = new Map<string, TaskDAGNode>();
    for (const node of nodes) {
      nodeMap.set(node.id, node);
    }

    // Generate edges from node dependencies
    const edges: TaskDAGEdge[] = [];
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjList.set(node.id, []);
    }

    for (const node of nodes) {
      for (const depId of node.dependencies) {
        if (nodeMap.has(depId)) {
          edges.push({ from: depId, to: node.id });
          adjList.get(depId)!.push(node.id);
          inDegree.set(node.id, (inDegree.get(node.id) || 0) + 1);
        } else {
          throw new Error(`Unresolved dependency '${depId}' required by task '${node.id}'`);
        }
      }
    }

    // Kahn's Algorithm for Cycle Detection & Level (Parallel Group) Assignment
    const queue: string[] = [];
    for (const [id, deg] of inDegree.entries()) {
      if (deg === 0) {
        queue.push(id);
      }
    }

    const parallel_groups: string[][] = [];
    let processedCount = 0;
    const currentInDegree = new Map(inDegree);
    let currentLevel = [...queue];

    while (currentLevel.length > 0) {
      parallel_groups.push(currentLevel);
      const nextLevel: string[] = [];

      for (const taskId of currentLevel) {
        processedCount++;
        for (const neighbor of adjList.get(taskId) || []) {
          const updatedDeg = currentInDegree.get(neighbor)! - 1;
          currentInDegree.set(neighbor, updatedDeg);
          if (updatedDeg === 0) {
            nextLevel.push(neighbor);
          }
        }
      }

      currentLevel = nextLevel;
    }

    if (processedCount < nodes.length) {
      const unvisited = nodes.filter((n) => (currentInDegree.get(n.id) || 0) > 0).map((n) => n.id);
      throw new Error(
        `Dependency cycle detected in Task DAG involving tasks: [${unvisited.join(', ')}]. Execution blocked.`
      );
    }

    // Detect Write Conflicts within each parallel group
    const conflicts = this.detectConflicts(parallel_groups, nodeMap);

    // Compute Critical Path (longest path in DAG)
    const critical_path = this.computeCriticalPath(nodes, adjList);

    const dag: TaskDAG = {
      nodes,
      edges,
      parallel_groups,
      critical_path,
      conflicts,
    };

    this.saveDAG(dag);
    return dag;
  }

  private detectConflicts(
    parallelGroups: string[][],
    nodeMap: Map<string, TaskDAGNode>
  ): WriteConflict[] {
    const conflicts: WriteConflict[] = [];

    for (const group of parallelGroups) {
      if (group.length <= 1) continue;

      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const taskA = nodeMap.get(group[i])!;
          const taskB = nodeMap.get(group[j])!;

          const intersectingPaths: string[] = [];
          for (const pathA of taskA.ownership.write || []) {
            for (const pathB of taskB.ownership.write || []) {
              if (this.pathsOverlap(pathA, pathB)) {
                intersectingPaths.push(`${pathA} <-> ${pathB}`);
              }
            }
          }

          if (intersectingPaths.length > 0) {
            conflicts.push({
              task_a: taskA.id,
              task_b: taskB.id,
              conflicting_paths: intersectingPaths,
            });
          }
        }
      }
    }

    return conflicts;
  }

  private pathsOverlap(pathA: string, pathB: string): boolean {
    const normA = pathA.replace(/\\/g, '/').toLowerCase();
    const normB = pathB.replace(/\\/g, '/').toLowerCase();

    if (normA === normB) return true;
    if (normA === '**' || normB === '**') return true;

    // Glob check e.g. src/db/** vs src/db/users.ts
    const prefixA = normA.endsWith('/**') ? normA.slice(0, -3) : normA;
    const prefixB = normB.endsWith('/**') ? normB.slice(0, -3) : normB;

    if (normA.includes('/**') && (normB.startsWith(prefixA + '/') || normB === prefixA)) {
      return true;
    }
    if (normB.includes('/**') && (normA.startsWith(prefixB + '/') || normA === prefixB)) {
      return true;
    }

    return false;
  }

  private computeCriticalPath(nodes: TaskDAGNode[], adjList: Map<string, string[]>): string[] {
    if (nodes.length === 0) return [];

    const memo = new Map<string, string[]>();

    const getLongestPath = (nodeId: string): string[] => {
      if (memo.has(nodeId)) {
        return memo.get(nodeId)!;
      }

      const neighbors = adjList.get(nodeId) || [];
      if (neighbors.length === 0) {
        const path = [nodeId];
        memo.set(nodeId, path);
        return path;
      }

      let longestSubPath: string[] = [];
      for (const neighbor of neighbors) {
        const subPath = getLongestPath(neighbor);
        if (subPath.length > longestSubPath.length) {
          longestSubPath = subPath;
        }
      }

      const fullPath = [nodeId, ...longestSubPath];
      memo.set(nodeId, fullPath);
      return fullPath;
    };

    let criticalPath: string[] = [];
    for (const node of nodes) {
      const path = getLongestPath(node.id);
      if (path.length > criticalPath.length) {
        criticalPath = path;
      }
    }

    return criticalPath;
  }

  private saveDAG(dag: TaskDAG) {
    const tasksDir = path.join(this.projectRoot, '.agentic', 'tasks');
    if (!fs.existsSync(tasksDir)) {
      fs.mkdirSync(tasksDir, { recursive: true });
    }
    fs.writeFileSync(path.join(tasksDir, 'dag.json'), JSON.stringify(dag, null, 2), 'utf8');
  }
}
