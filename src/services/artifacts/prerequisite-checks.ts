/**
 * How ONE prerequisite is judged: its body markers, and the soft-pass
 * downgrade a missing file gets inside a back-compat window.
 *
 * WHY THIS IS A SIBLING AND NOT THREE MORE LINES IN THE TABLE.
 * `artifact-prerequisites.ts` is over the 300-line file-size cap and
 * `fileSizeExcessLines` is a ratchet that may only go DOWN
 * (`.husky/peaks-gate-baseline-monotonic.mjs` — "Split the file; do not raise
 * the ceiling"). The soft-pass branch this module was split out for must ADD
 * lines to that file, so the body check its two enforcers share lives here,
 * where the census counts no debt. `prerequisiteBodyViolations` moved verbatim;
 * only its location changed.
 */

import { basename, extname } from 'node:path';

import type { ArtifactPrerequisite } from './artifact-prerequisites.js';

/** Stands in for a `backCompatUntil` nobody declared. ONE token for BOTH sites
 *  — the warning code and the message — so the two cannot disagree, and
 *  token-shaped like the version it stands in for. No live prerequisite omits
 *  the field, so this is unreachable today; the honest placeholder beats
 *  asserting a release nobody set. */
const UNDECLARED_WINDOW = 'a-future-release';

/**
 * The warning `code` for a prerequisite whose file is missing inside its
 * back-compat window, derived from the prerequisite itself: the artifact's own
 * filename stem plus the release that closes the window.
 *
 * The stem is what makes the code name WHICH artifact is missing — the branch
 * this replaced emitted the literal `mut-report-missing-deprecated-in-v2.14.0`
 * for EVERY `backCompat` prerequisite, so the `rd/third-party-review.md`
 * warning carried the same code as the `mut/mut-report.json` one and a
 * consumer filtering on it matched both. `backCompatUntil` keeps the
 * deprecation semantics legible and is per-prerequisite, because the two live
 * windows close in different releases (v2.14.0 and v2.15.0).
 *
 * The stem is taken verbatim: both prerequisites that carry `backCompat` name
 * a fixed path, so no character is rewritten.
 *
 * TWO KNOWN LIMITS OF THE STEM, stated so neither is read as a guarantee:
 *   - a `<rid>`-templated soft prerequisite keeps the placeholder, producing
 *     the LITERAL `<rid>-missing-deprecated-in-…` — the same code for every
 *     request. The code is therefore not per-slice filterable. No live
 *     prerequisite carries `backCompat` with a `<rid>` path, so nothing
 *     filters on one today; the placeholder is the honest thing to print, and
 *     making it per-slice would mean resolving the rid into a code a consumer
 *     would have to know to match.
 *   - the stem comes from the FILENAME only, so two prerequisites sharing a
 *     stem collide (`x.md` and `x.json` both yield `x-…`). Measured 0 live
 *     collisions, and the pair that exists (`mut/mut-report.json` vs
 *     `rd/third-party-review.md`) differs by stem as well as by directory.
 */
export function backCompatWarningCode(prerequisite: ArtifactPrerequisite): string {
  const stem = basename(prerequisite.relativePath, extname(prerequisite.relativePath));
  return `${stem}-missing-deprecated-in-${prerequisite.backCompatUntil ?? UNDECLARED_WINDOW}`;
}

/**
 * The soft-pass warning for a missing `prerequisite`, or `null` when a missing
 * file is a HARD failure and belongs in `missing` instead.
 *
 * The `null` is the whole decision, and it is the caller's only input to it. The
 * invariant the two destinations have, stated exactly:
 *   - `warnings` does NOT feed `ok` — a soft pass is reported, never enforced,
 *     which is why this can be a warning at all;
 *   - `missing` IS what decides `ok` (`ok = missing.length === 0`), so choosing
 *     the `missing` branch is choosing to fail the gate. That is the point of
 *     the `null`, and the acceptance evidence for this change depends on it.
 */
export function missingPrerequisiteWarning(
  prerequisite: ArtifactPrerequisite,
  relativePath: string
): { path: string; code: string; message: string } | null {
  if (prerequisite.backCompat !== true) return null;
  const until = prerequisite.backCompatUntil ?? UNDECLARED_WINDOW;
  return {
    path: relativePath,
    code: backCompatWarningCode(prerequisite),
    message: `${prerequisite.description} — file missing; soft-blocked under the back-compat window. ${until} hard-fail.`
  };
}

/**
 * The contract's BODY checks for one prerequisite, applied to `body`. Returns
 * one human-readable message per failed check, empty when the body satisfies
 * the contract.
 *
 * Exported because this contract has a SECOND enforcer: `peaks workflow
 * verify-pipeline` probes the same table for the paths it checks
 * (`pipeline-verify-gate-support.ts`), and a resolver that probed only
 * `existsSync` passed files this function rejects — a guard laxer than the
 * contract it claims to read. Both callers now share this one implementation,
 * so the checker cannot drift from the table again.
 */
export function prerequisiteBodyViolations(
  prerequisite: ArtifactPrerequisite,
  body: string
): string[] {
  const violations: string[] = [];
  const lowered = body.toLowerCase();
  if (prerequisite.mustContain && prerequisite.mustContain.length > 0) {
    const missingMarkers = prerequisite.mustContain.filter(
      (marker) => !lowered.includes(marker.toLowerCase())
    );
    if (missingMarkers.length > 0) {
      violations.push(
        `${prerequisite.description} — missing section(s): ${missingMarkers.join(', ')}`
      );
    }
  }
  if (prerequisite.headingMustContain && prerequisite.headingMustContain.length > 0) {
    // Slice 2.6.1.F: a line beginning with `#`, `##`, or `###` followed by
    // the marker (case-insensitive). Fenced code blocks are NOT excluded
    // here — a "heading" inside a code fence is rare and, when present,
    // should still be reported as missing to keep the contract strict.
    const headingLines = body
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => /^#{1,3}\s+/.test(line));
    const loweredHeadings = headingLines.map((h) => h.toLowerCase());
    const missingHeadings = prerequisite.headingMustContain.filter(
      (marker) => !loweredHeadings.some((h) => h.includes(marker.toLowerCase()))
    );
    if (missingHeadings.length > 0) {
      violations.push(
        `${prerequisite.description} — missing heading(s): ${missingHeadings.join(', ')}`
      );
    }
  }
  if (prerequisite.mustContainAny && prerequisite.mustContainAny.length > 0) {
    const hitAny = prerequisite.mustContainAny.some((marker) =>
      lowered.includes(marker.toLowerCase())
    );
    if (!hitAny) {
      violations.push(
        `${prerequisite.description} — none of the escape-hatch markers present: ${prerequisite.mustContainAny.join(', ')}`
      );
    }
  }
  return violations;
}

/** True when `prerequisite` declares any body check at all. Private on purpose:
 *  its ONE caller is `bodyViolationsIfDeclared` below. */
function hasBodyChecks(prerequisite: ArtifactPrerequisite): boolean {
  return (
    (prerequisite.mustContain?.length ?? 0) > 0 ||
    (prerequisite.headingMustContain?.length ?? 0) > 0 ||
    (prerequisite.mustContainAny?.length ?? 0) > 0
  );
}

/**
 * The body violations for `prerequisite`, or `[]` when it declares no body
 * contract — and in that case `read` is NEVER called, so a prerequisite with
 * nothing to check never has its file opened (unchanged behaviour: the guard has
 * always been a guard on the READ, which is why it takes the read as a thunk
 * rather than the body).
 */
export async function bodyViolationsIfDeclared(
  prerequisite: ArtifactPrerequisite,
  read: () => Promise<string>
): Promise<string[]> {
  if (!hasBodyChecks(prerequisite)) return [];
  return prerequisiteBodyViolations(prerequisite, await read());
}
