import fs from 'fs';
import path from 'path';
import { AuditEvent, AuditEventType } from '../types/audit.js';

export class AuditLogger {
  private auditFile: string;

  constructor(projectRoot: string = process.cwd()) {
    const auditDir = path.resolve(projectRoot, '.agentic', 'audit');
    if (!fs.existsSync(auditDir)) {
      fs.mkdirSync(auditDir, { recursive: true });
    }
    this.auditFile = path.join(auditDir, 'events.jsonl');
  }

  public emit(
    runId: string,
    type: AuditEventType,
    details: Partial<Omit<AuditEvent, 'time' | 'run' | 'type'>> = {}
  ): AuditEvent {
    const event: AuditEvent = {
      time: new Date().toISOString(),
      run: runId,
      type,
      ...details,
    };

    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(this.auditFile, line, 'utf8');
    return event;
  }

  public getEvents(runId?: string): AuditEvent[] {
    if (!fs.existsSync(this.auditFile)) {
      return [];
    }

    const content = fs.readFileSync(this.auditFile, 'utf8');
    const lines = content.split('\n').filter((l) => l.trim().length > 0);
    const events: AuditEvent[] = [];

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as AuditEvent;
        if (!runId || parsed.run === runId) {
          events.push(parsed);
        }
      } catch {
        // ignore malformed line
      }
    }

    return events;
  }
}
