#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const projectRoot = process.cwd();
const agenticDir = path.resolve(projectRoot, '.agentic');

console.log('>>> Initializing Agentic SDLC Orchestrator directories in:', agenticDir);

const dirs = [
  'orchestrator/schemas',
  'state/history',
  'planning/history',
  'specs/planned',
  'specs/as-built',
  'tasks/current',
  'tasks/history',
  'execution/work-packages',
  'execution/agents',
  'execution/runs',
  'verification/current',
  'verification/reports',
  'verification/evidence',
  'reconciliation/reports',
  'prompts',
  'templates',
  'audit',
  'adapters/claude',
  'adapters/antigravity',
  'adapters/generic',
];

for (const sub of dirs) {
  const dirPath = path.join(agenticDir, sub);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
    console.log(`+ Created: .agentic/${sub}`);
  }
}

// Ensure events.jsonl exists
const auditFile = path.join(agenticDir, 'audit', 'events.jsonl');
if (!fs.existsSync(auditFile)) {
  fs.writeFileSync(
    auditFile,
    JSON.stringify({ time: new Date().toISOString(), run: 'SYSTEM', type: 'AUDIT_INITIALIZED', metadata: { version: 1 } }) + '\n',
    'utf8'
  );
  console.log('+ Created: .agentic/audit/events.jsonl');
}

console.log('>>> Agentic SDLC Orchestrator bootstrap initialization complete.');
