// scripts/install-skills-report.mjs
//
// A fallback is not a failure but must not LOOK like one, and a `skipped` entry is a
// half migration that must not be invisible. Both are reported here, and the shared
// empty result shape lives beside them.
//
// Split out of `scripts/install-skills.mjs` (rid-043). Every line below was moved
// VERBATIM from that file; only this header, the import block, and the `export`
// keyword on names a sibling imports are new.

export function createInstallResult() {
  return { installed: [], skipped: [], pruned: [], fallbacks: [] };
}

/**
 * A fallback is not a failure — but it must never LOOK like a plain success. The
 * entry is a real copy instead of a link, and the postinstall says so, naming each
 * one. Silence here would be the same shape as the defect this slice fixes: an
 * outcome nobody can observe from the outside.
 */
export function reportCopyFallbacks(label, fallbacks) {
  if (fallbacks.length === 0) return;
  process.stderr.write(
    `Peaks ${label}: ${fallbacks.map((entry) => entry.name).join(', ')} ` +
      'installed as REAL COPIES because this host refused a symlink ' +
      `(${fallbacks[0].code ?? 'no code returned'})\n`
  );
}

/**
 * The other half of the same rule, for the other bucket. A `skipped` entry means the
 * canonical copy WAS written and the IDE entry was NOT — a half migration. Whatever the
 * cause (a file the user authored, or an entry whose sidecar names a second live
 * installation), it must not be invisible: the whole defect this slice fixes was an
 * outcome nobody could observe from outside.
 */
export function reportLeftAlone(label, skipped) {
  if (skipped.length === 0) return;
  process.stderr.write(
    `Peaks ${label}: left alone, not peaks-loop's to replace: ${skipped.join(', ')}\n`
  );
}
