import fs from 'fs';
import path from 'path';

/**
 * An error the operator can act on: printed as a plain message, never as a
 * stack trace. Anything else is a bug in the framework and is printed as such.
 */
export class CliError extends Error {
  public readonly hint?: string;

  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'CliError';
    this.hint = hint;
  }
}

/** Fails with an actionable message instead of throwing a raw Error. */
export function fail(message: string, hint?: string): never {
  throw new CliError(message, hint);
}

/**
 * Guards commands that cannot work without the `.agentic` architecture.
 *
 * Without this, running `agentic prompt` in a fresh directory ended in a Node
 * stack trace about a missing YAML file, which tells the user nothing about
 * what to do.
 */
export function requireInitialized(projectRoot: string, command: string): void {
  const marker = path.join(projectRoot, '.agentic', 'orchestrator', 'workflow.yaml');
  if (fs.existsSync(marker)) return;

  const hasDirectory = fs.existsSync(path.join(projectRoot, '.agentic'));
  fail(
    hasDirectory
      ? `'${command}' needs a complete .agentic setup, but ${path.relative(projectRoot, marker)} is missing.`
      : `'${command}' needs this project to be initialized first (no .agentic directory in ${projectRoot}).`,
    'Run: agentic init'
  );
}

/** Formats an error for the terminal and returns the process exit code. */
export function reportError(error: unknown, debug = Boolean(process.env.AGENTIC_DEBUG)): number {
  if (error instanceof CliError) {
    console.error(`\nx ${error.message}`);
    if (error.hint) console.error(`  ${error.hint}\n`);
    return 1;
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error(`\nx ${message}`);

  if (debug && error instanceof Error && error.stack) {
    console.error(`\n${error.stack}`);
  } else {
    console.error('  Run again with AGENTIC_DEBUG=1 for the full stack trace.');
  }
  console.error('  If this looks like a framework bug, `agentic doctor` usually points at the cause.\n');

  return 1;
}
