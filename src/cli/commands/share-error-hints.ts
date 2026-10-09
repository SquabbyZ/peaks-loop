/**
 * Per-code "what to do next" hints for the failure envelopes of
 * `peaks sub-agent share`, `peaks sub-agent shared-read`, and
 * `peaks sub-agent await`. Extracted from `share-commands.ts` so that file
 * stays under the line cap; each helper is pure — it maps an error code to the
 * single actionable hint the runner places in the envelope, and nothing here
 * prints, reads state, or throws.
 *
 * Each branch names the most likely next step, so a caller gets an actionable
 * hint instead of a generic "see error message" fallback.
 */

export function shareErrorNextActions(code: string): string {
  if (code === 'LOCK_TIMEOUT') {
    return 'A concurrent `peaks sub-agent share` is holding the channel lock for >5s; retry, or check for a crashed holder (the .lock file is reaped after 30s).';
  }
  if (code === 'RECORD_NOT_FOUND' || code === 'INVALID_RECORD_PATH') {
    return 'The dispatch record path is missing or outside .peaks/_sub_agents/. Re-run `peaks sub-agent dispatch <role>` to get a fresh record path, then use that here.';
  }
  return 'See error message; check that --batch matches the dispatch envelope and the value is a JSON object ≤ 64KB.';
}

export function sharedReadErrorNextActions(code: string): string {
  if (code === 'INVALID_BATCH_ID' || code === 'MISSING_BATCH') {
    return 'Pass --batch <batchId> exactly as returned by the `peaks sub-agent dispatch` envelope.';
  }
  return 'See error message; check that --batch matches the dispatch envelope (typo / wrong batch will return an empty channel, not an error).';
}

export function awaitErrorNextActions(code: string): string {
  if (code === 'INVALID_TIMEOUT') {
    return 'Pass --timeout as a positive integer ms (e.g. --timeout 60000). 0 and non-numeric values are rejected.';
  }
  if (code === 'IDE_NOT_SUPPORTED') {
    return 'Switch to claude-code, or rely on LLM-side await for non-claude-code IDEs in slice 1.3.';
  }
  if (code === 'NO_DISPATCH_RECORDS') {
    return 'Check --session-id / --project: records live under .peaks/_sub_agents/<sessionId>/. Use the batchId exactly as printed by the dispatch envelope.';
  }
  return 'See error message; check that --batch matches the dispatch envelope and --timeout is a positive integer ms.';
}
