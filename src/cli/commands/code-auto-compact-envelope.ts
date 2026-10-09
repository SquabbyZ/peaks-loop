// The `peaks code auto-compact` result adapter, on its own so the CHANNEL each
// fact chooses can be asserted directly, without a real red-line probe.
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';
import { type AutoCompactResult } from '../../services/code/auto-compact-orchestrator.js';
import { harnessWindowSyncWarning } from '../../services/context/harness-window-config.js';

/**
 * Adapt `runAutoCompact`'s domain result to a `ResultEnvelope`.
 *
 * Extracted and exported so the CHANNEL each fact chooses can be asserted
 * directly, without a real red-line probe.
 *
 * The harness-window CONFLICT ("peaks-loop divided this ratio by N but the
 * settings file pins M") is a fact about the STATE, not an instruction, so it
 * rides `warnings` — the very channel `peaks code context-now` already puts it
 * on, via the same `harnessWindowSyncWarning`. Before this, the shim hard-coded
 * `warnings: []`, so the identical fact reached a consumer as a sentence inside
 * `nextActions` on this command and as a `warnings` entry on the other one. One
 * fact, two shapes, depending on which of the two syncing commands a consumer
 * happened to read: two parsers for one mechanism.
 *
 * The prose description (`describeHarnessWindowSync`) stays in `nextActions` on
 * BOTH commands — that half is advice ("what to do about it") and both already
 * agree on it.
 */
export function buildAutoCompactEnvelope(result: AutoCompactResult): ResultEnvelope<unknown> {
  const data = 'data' in result ? result.data : null;
  const nextActions = 'nextActions' in result ? result.nextActions : [];
  const warning = harnessWindowSyncWarning(data?.harnessWindow ?? null);
  const warnings = warning === null ? [] : [warning];
  if (result.ok) {
    return ok('code.auto-compact', data ?? {}, warnings, [result.message, ...nextActions]);
  }
  // `fail()` hard-codes `warnings: []`, so the warning is spread back over it —
  // a refused write can disagree with the ratio just as easily on the failure
  // path, and the state does not become less true because the dispatch failed.
  return {
    ...fail('code.auto-compact', result.code, result.message, data, [...nextActions]),
    warnings
  };
}
