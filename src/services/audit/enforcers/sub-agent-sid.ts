/**
 * sub-agent-sid enforcer — dogfood of Slice 0.5 sid-naming-guard.
 *
 * Per L2 redesign §5.4, "sub-agent-sid" is one of the 5 P0 red lines.
 * Slice 0.5 (Task 7) shipped `isValidSessionId` in
 * `src/services/workspace/sid-naming-guard.ts`. This enforcer exposes the
 * same check to the red-line audit framework, so any invalid sid under
 * `.peaks/_sub_agents/` shows up as a backable red line in the audit.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isValidSessionId } from '../../workspace/sid-naming-guard.js';

const SUB_AGENTS_DIR = '.peaks/_sub_agents';
const RUNTIME_DIR = '.peaks/_runtime';

export interface SubAgentSidCheckResult {
  readonly invalid: readonly string[];
  readonly valid: readonly string[];
  readonly scanned: boolean;
}

/**
 * Find sids under `.peaks/_sub_agents/<sid>/` that fail `isValidSessionId`.
 * Bare forms (sid-3, unknown-sid) and date-mismatched sids all fail.
 */
export function findInvalidSubAgentSids(projectRoot: string): SubAgentSidCheckResult {
  const subAgentsRoot = join(projectRoot, SUB_AGENTS_DIR);
  if (!existsSync(subAgentsRoot)) {
    return { invalid: [], valid: [], scanned: false };
  }
  const entries = readdirSync(subAgentsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const invalid: string[] = [];
  const valid: string[] = [];
  for (const name of entries) {
    if (isValidSessionId(name)) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }
  return { invalid, valid, scanned: true };
}

/**
 * Same check, for `.peaks/_runtime/<sid>/`. Slice 0.5's clean-service
 * already handles the sub-agents dir; the audit framework also wants to
 * know about invalid runtime sids (which would be a different failure mode).
 */
export function findInvalidRuntimeSids(projectRoot: string): SubAgentSidCheckResult {
  const runtimeRoot = join(projectRoot, RUNTIME_DIR);
  if (!existsSync(runtimeRoot)) {
    return { invalid: [], valid: [], scanned: false };
  }
  const entries = readdirSync(runtimeRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
  const invalid: string[] = [];
  const valid: string[] = [];
  for (const name of entries) {
    if (isValidSessionId(name)) {
      valid.push(name);
    } else {
      invalid.push(name);
    }
  }
  return { invalid, valid, scanned: true };
}
