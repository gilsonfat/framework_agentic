import { AntigravityAdapter } from './antigravity-adapter.js';

export class ClaudeAdapter extends AntigravityAdapter {
  public getSlashCommands(): Record<string, string> {
    return {
      '/agentic-run': 'Run the complete Agentic SDLC cycle',
      '/agentic-status': 'Display the current SDLC status dashboard',
      '/agentic-doctor': 'Run diagnostics on all frameworks and state',
      '/agentic-observe': 'Inspect and record real repository observed state',
      '/agentic-reconcile': 'Reconcile declared state against observed truth',
      '/agentic-resume': 'Resume an interrupted run safely',
    };
  }
}
