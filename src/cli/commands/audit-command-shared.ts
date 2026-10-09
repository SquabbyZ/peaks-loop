/**
 * Shared plumbing for the `peaks audit *` command family.
 *
 * Split out of `audit-commands.ts` (file-size cap) so each runner module can
 * read the option shapes, the `--project` validation and the two whitelists
 * without importing the registrar back. Dependency direction is one-way:
 * nothing here imports `audit-commands.ts`.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { getErrorMessage } from '../cli-helpers.js';
import type { AuditGoalOutput } from '../../services/audit/audit-goal-types.js';
import type { AgentShieldState } from '../../services/audit/static-service.js';
import type { ArtifactKind } from '../../services/audit/artifact-writer.js';
import type { AuditDecisionRecord } from '../../services/audit/decision-writer.js';
import type { RedLineAudit } from '../../services/audit/types.js';

export type RedLinesOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
};

export type StaticAuditOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
  record?: boolean;
  rid?: string;
};

export type AuditGoalOptions = {
  project: string;
  need: string;
  llmProvider?: string;
  json?: boolean;
};

export type ArtifactWriteOptions = {
  project: string;
  kind: string;
  input: string;
  description?: string;
  name?: string;
  rid?: string;
  dryRun?: boolean;
  json?: boolean;
};

export type ProseRatioOptions = {
  project: string;
  target: string;
  json?: boolean;
};

export const SUPPORTED_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'decision',
  'prompt',
  'machine-output',
  'narrative'
];

export function isSupportedArtifactKind(value: string): value is ArtifactKind {
  return (SUPPORTED_ARTIFACT_KINDS as readonly string[]).includes(value);
}

/** Whitelist of supported `--llm-provider` values for `peaks audit goal`. */
export const SUPPORTED_LLM_PROVIDERS = ['anthropic', 'stub'] as const;
export type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * The real provider is the default: `peaks audit goal` is the entry gate for
 * every peaks-* workflow, so it must audit by default and only scaffold when
 * a caller explicitly asks for `stub`.
 */
export const DEFAULT_LLM_PROVIDER: SupportedLlmProvider = 'anthropic';

export function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

/** The one hint every `--project` refusal carries, verbatim. */
export const PROJECT_PATH_HINT = 'Verify the project path exists and is a directory';

/** The one hint every scanner-failure refusal carries, verbatim. */
export const SCANNER_HINT = 'Inspect scanner logs and re-run with the same --project path';

/** `--project` is valid only when it resolves to an existing directory. */
export type ProjectRootValidation =
  { ok: true; projectRoot: string } | { ok: false; code: string; message: string };

export function validateProjectRoot(projectArg: string): ProjectRootValidation {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return {
      ok: false,
      code: 'PROJECT_NOT_FOUND',
      message: `project path does not exist: ${projectArg}`
    };
  }
  let stat;
  try {
    stat = statSync(projectRoot);
  } catch (error) {
    return { ok: false, code: 'INVALID_PROJECT', message: getErrorMessage(error) };
  }
  if (!stat.isDirectory()) {
    return {
      ok: false,
      code: 'INVALID_PROJECT',
      message: `project path is not a directory: ${projectArg}`
    };
  }
  return { ok: true, projectRoot };
}

/** `audit-failed` is a failure envelope's status — never a scaffold, never a success. */
export type AuditGoalStatus = 'audit-complete' | 'scaffold-only' | 'audit-failed';

export interface AuditGoalData {
  readonly status: AuditGoalStatus;
  /** Which LLM produced (or failed to produce) the audit. `unresolved` = rejected before binding. */
  readonly providerBinding: 'anthropic-messages-api' | 'stub' | 'unresolved';
  readonly need: string;
  readonly projectRoot: string;
  /** The validated 6-dimension audit. Present on success only. */
  readonly result?: AuditGoalOutput;
  /** The bound model. Present on a real run only. */
  readonly model?: string;
  /**
   * Environment variables the binding needed and did not find. Present on a
   * binding failure only, and verbatim: `fail()` redacts `message`, so this
   * is the channel that reliably names what the operator must set.
   */
  readonly missingEnv?: readonly string[];
}

export interface StaticAuditData {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  /** Populated only when `--record` is passed. Persisted decision record path. */
  readonly decision?: AuditDecisionRecord;
}
