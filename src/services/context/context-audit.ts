/**
 * `peaks code context-audit` — what actually fills the orchestrator's window.
 *
 *
 * Why this exists: `peaks code context-now` reports a RATIO only. Nothing
 * reported WHAT occupies the window, so the same 40K-token mistake (dumping a
 * full `peaks memory reindex --json` array four times in one session) was
 * invisible until the window was 68% gone. The IDE transcript already holds
 * per-message tool results, so the breakdown is derivable locally, with zero
 * tokens spent asking a model.
 *
 * Contract:
 *   - READ-ONLY. The transcript is never modified.
 *   - FAIL-SOFT. A missing / oversized / corrupt transcript yields
 *     `available: false` plus a machine-readable `reason`. Never throws,
 *     never blocks a workflow, never exits non-zero on its own.
 *   - NO CONTENT. The envelope carries tool names, short command/path keys
 *     and byte counts — never the tool result text itself (dumping it would
 *     re-create the very problem this command measures).
 *   - BOUNDED MEMORY. The transcript can be tens of MB; it is streamed in
 *     fixed-size chunks with a carried partial line, never read whole.
 *
 * Grouping key = `(tool name, short input key)`. The key is a *stable
 * summary* of the tool input — the Bash command line, the file path tail, the
 * grep pattern — so "4 × the same 40KB reindex dump" collapses into ONE row
 * with `count: 4` instead of four anonymous entries.
 *
 * Split note (wave 3, eslint-family sweep): the public envelope types live
 * in `./context-audit-types.ts`, the limits constants and `--top` clamp in
 * `./context-audit-limits.ts`, the group-key builders in
 * `./context-audit-keys.ts`, and the streaming scan / fold / ranking /
 * fail-soft assembly in `./context-audit-scan.ts`. Those bodies were moved
 * VERBATIM — control flow copied, nothing improved — so this module keeps
 * its whole public surface (every name re-exported below) and stays under
 * the 300 raw-line cap.
 */

import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import { detectIdeFromEnv } from './ide-detect.js';
import { CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES, normalizeTopN } from './context-audit-limits.js';
import { auditTranscriptFile, emptyResult } from './context-audit-scan.js';
import type { ContextAuditInput, ContextAuditResult } from './context-audit-types.js';

export {
  CONTEXT_AUDIT_DEFAULT_TOP,
  CONTEXT_AUDIT_MAX_TOP,
  CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES,
  normalizeTopN
} from './context-audit-limits.js';
export { contextAuditKey } from './context-audit-keys.js';
export type {
  ContextAuditEntry,
  ContextAuditInput,
  ContextAuditResult
} from './context-audit-types.js';

/** Adapter resolution outcome: a transcript path, or a fail-soft reason. */
type ResolvedTranscript = { readonly transcriptPath: string } | { readonly reason: string };

/**
 * Vendor-neutral: the adapter owns the on-disk layout. Mirrors
 * `readContextPercent`'s narrowing of the detected kind to a
 * registered adapter id ('unknown' → claude-code default). Both the
 * registry lookup and the locator call are guarded — an unregistered
 * detected id (e.g. an IDE without a peaks adapter yet) or an adapter
 * bug must degrade, never throw.
 */
function resolveTranscriptViaAdapter(
  outerSessionId: string,
  env: NodeJS.ProcessEnv | undefined
): ResolvedTranscript {
  try {
    const detected = detectIdeFromEnv(env ?? process.env);
    const ideId: IdeId = (detected === 'unknown' ? 'claude-code' : detected) as IdeId;
    const locate = getAdapter(ideId).compact?.resolveTranscriptPath;
    if (locate === undefined) {
      return { reason: 'transcript-locator-unavailable' };
    }
    const transcriptPathOrNull = locate(outerSessionId);
    if (transcriptPathOrNull === null) {
      return { reason: 'transcript-not-found' };
    }
    return { transcriptPath: transcriptPathOrNull };
  } catch {
    return { reason: 'transcript-locator-unavailable' };
  }
}

/**
 * Audit the CURRENT session's transcript. Never throws.
 *
 * Unavailability reasons (all return `available: false`, exit code stays 0):
 *   - `no-outer-session-id`  — the peaks session has no bound outer id
 *   - `transcript-locator-unavailable` — the active IDE adapter does not
 *                              declare `compact.resolveTranscriptPath`
 *   - `transcript-not-found` — the adapter locator returned null
 *   - `transcript-too-large` — above `CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES`
 *   - `transcript-unreadable`— stat/open failed
 *   - `audit-failed`         — any unexpected internal error
 */
export function auditContext(input: ContextAuditInput = {}): ContextAuditResult {
  const topN = normalizeTopN(input.topN);
  const explicit = input.transcriptPath;
  let transcriptPath: string | null = null;
  if (typeof explicit === 'string' && explicit.length > 0) {
    transcriptPath = explicit;
  } else {
    const outerSessionId = input.outerSessionId;
    if (typeof outerSessionId !== 'string' || outerSessionId.length === 0) {
      return emptyResult({ reason: 'no-outer-session-id', topN });
    }
    const resolved = resolveTranscriptViaAdapter(outerSessionId, input.env);
    if ('reason' in resolved) {
      return emptyResult({ reason: resolved.reason, topN });
    }
    transcriptPath = resolved.transcriptPath;
  }

  const maxBytes =
    typeof input.maxTranscriptBytes === 'number' &&
    Number.isFinite(input.maxTranscriptBytes) &&
    input.maxTranscriptBytes >= 0
      ? input.maxTranscriptBytes
      : CONTEXT_AUDIT_MAX_TRANSCRIPT_BYTES;

  return auditTranscriptFile(transcriptPath, maxBytes, topN);
}
