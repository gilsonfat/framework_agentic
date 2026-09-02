/**
 * Agent product integrations.
 *
 * Every AI coding product reads a different set of files. The protocol they must
 * follow is identical, so the framework keeps one source of truth for the
 * protocol and renders it into whatever each product actually reads.
 */

export type AgentProductId =
  | 'claude'
  | 'antigravity'
  | 'gemini'
  | 'codex'
  | 'chatgpt'
  | 'cursor'
  | 'copilot'
  | 'windsurf';

export interface AgentProductDefinition {
  id: AgentProductId;
  /** Human-readable product name. */
  label: string;
  /** How the user triggers the workflow inside this product. */
  entryPoint: string;
  /** Files this integration owns, relative to the project root. */
  files: string[];
  /** Paths/binaries that suggest the product is used on this machine. */
  detect?: string[];
}

export interface WrittenFile {
  path: string;
  /**
   * `appended` means the file belonged to the user and the protocol was added to
   * it inside markers, leaving their content untouched.
   */
  action: 'created' | 'updated' | 'merged' | 'appended' | 'preserved';
  product: AgentProductId;
}

export interface IntegrationResult {
  product: AgentProductId;
  label: string;
  entryPoint: string;
  files: WrittenFile[];
  /** Whether the product looks present on this machine (advisory only). */
  detected: boolean;
}

/**
 * `partial` is the case a brownfield project hits: the instruction file exists
 * (the team already had one) but carries none of the protocol, so the product
 * reads nothing about the workflow. Reporting it as wired would be a lie.
 */
export type IntegrationState = 'installed' | 'partial' | 'missing';

export interface IntegrationStatus {
  definition: AgentProductDefinition;
  state: IntegrationState;
  installed: boolean;
  detected: boolean;
  /** Files that exist but do not carry the protocol. */
  withoutProtocol: string[];
}
