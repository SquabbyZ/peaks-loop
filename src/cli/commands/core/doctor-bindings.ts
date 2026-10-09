import { readBinding } from '../../../services/session/binding-store.js';

// resolved the binding from. `canonical` = .peaks/_runtime/session.json (the
// post-slice-006 home); `legacy` = .peaks/.session.json (read-only back-compat).
// Callers / migration tooling detect pre-migration trees by `source === 'legacy'`.
export type BindingSource = 'canonical' | 'legacy';

/** One stale entry in the project-level binding. */
export type StaleInstance = { sid: string; callerId: string; lastHeartbeat: string };

// threshold is exposed as a CLI flag so users can tune it for
// long-running sessions. 300000 ms = 5 minutes.
export const STALE_TTL_MS = 300_000;

// in the project-level binding. Used by `peaks doctor` and surfaced as
// a warning in the report. Returns the stale entry descriptors.
export function listStaleInstances(
  projectRoot: string,
  ttlMs: number = STALE_TTL_MS
): StaleInstance[] {
  const binding = readBinding(projectRoot);
  if (!binding) return [];
  const cutoff = Date.now() - ttlMs;
  const stale: StaleInstance[] = [];
  for (const [sid, inst] of Object.entries(binding.instances)) {
    const t = Date.parse(inst.lastHeartbeat);
    if (Number.isFinite(t) && t < cutoff) {
      stale.push({ sid, callerId: inst.callerId, lastHeartbeat: inst.lastHeartbeat });
    }
  }
  return stale;
}

/** The `staleBinding` block every doctor envelope carries. */
export function staleBindingSection(
  ttlMs: number,
  staleInstances: readonly StaleInstance[],
  droppedStale: readonly string[]
) {
  return {
    ttlMs,
    staleCount: staleInstances.length,
    staleInstances,
    droppedCount: droppedStale.length,
    droppedSids: droppedStale
  };
}
