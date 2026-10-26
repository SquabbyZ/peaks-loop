/**
 * `src/services/artifacts/prerequisite-path-census.ts`
 *
 * Every path shape that can reach the prerequisite missing list, as one
 * de-duplicated list.
 *
 * WHY THIS EXISTS. The owner-skill map has to cover the paths the gates
 * actually demand, and the gates read ONE table. Reading that table through
 * a census function means the coverage check and the gate can never
 * disagree about which paths exist — a second hand-written list would drift
 * from the table on the first table change.
 *
 * THE THREE SOURCES OF A MISSING PATH. `checkPrerequisites` builds its
 * missing list from three places, and a census that reads only the first
 * would leave the other two uncovered:
 *
 *   1. the table loop — the canonical `relativePath`, plus the legacy tiers
 *      (`legacyRelativePath` / `legacyRelativePaths`) the resolver probes
 *      before it calls a file absent;
 *   2. the judged-declaration refusals — the security artifact's own
 *      location, which the resolver reports verbatim;
 *   3. the handoff capsule's gate-evidence declaration — a key that names a
 *      file that is not on disk, reported under the KEY's name, and the
 *      unreadable-capsule shape beside it.
 *
 * The `<rid>` placeholder is left in place on the table paths: this is the
 * table's own shape, and the owner lookup is a prefix match, so the
 * placeholder is irrelevant to it.
 *
 * THE KEY SET IS READ, NOT COPIED. `GATE_EVIDENCE_KEYS` is the one
 * definition of the gate-evidence vocabulary, and a second copy of it here
 * would be the same drift hole this census exists to close. The failure
 * statuses are held in a `Record` keyed by the reader's own status type, so
 * a status added to that type fails the build here until this census
 * accounts for it.
 */

import { PREREQUISITES_BY_TYPE } from './artifact-prerequisites.js';
import { GATE_EVIDENCE_KEYS } from '../prd/handoff-types.js';
import type { HandoffGateEvidenceStatus } from '../prd/handoff-gate-evidence.js';

/**
 * The gate-evidence statuses that can produce a `gateEvidence(<status>)`
 * path in the missing list.
 *
 * `ok` never does (the declaration is read), and neither do `field-absent`
 * or `file-missing` (there is nothing to declare, or nothing to read).
 */
type GateEvidenceFailureStatus = Exclude<
  HandoffGateEvidenceStatus,
  'ok' | 'field-absent' | 'file-missing'
>;

/**
 * The failure statuses, keyed so that the type checks BOTH ways: a status
 * added to the reader's union fails the build here until this record names
 * it, and a status dropped from that union fails here as an excess key.
 */
const GATE_EVIDENCE_FAILURE_STATUSES: Record<GateEvidenceFailureStatus, true> = {
  'read-error': true,
  'frontmatter-malformed': true,
  'field-not-map': true,
  'value-not-string': true
};

/**
 * Every `relativePath` any request type demands, every legacy tier the
 * resolver probes for one, and every gate-evidence shape a declaration can
 * report — de-duplicated and sorted.
 */
export function allPrerequisitePaths(): readonly string[] {
  const paths = new Set<string>();
  for (const table of Object.values(PREREQUISITES_BY_TYPE)) {
    for (const requirements of Object.values(table)) {
      if (requirements === undefined) continue;
      for (const requirement of requirements) {
        paths.add(requirement.relativePath);
        if (requirement.legacyRelativePath !== undefined) {
          paths.add(requirement.legacyRelativePath);
        }
        for (const legacy of requirement.legacyRelativePaths ?? []) {
          paths.add(legacy);
        }
      }
    }
  }
  for (const key of GATE_EVIDENCE_KEYS) {
    paths.add(`gateEvidence.${key}`);
  }
  for (const status of Object.keys(GATE_EVIDENCE_FAILURE_STATUSES)) {
    paths.add(`gateEvidence(${status})`);
  }
  return [...paths].sort();
}
