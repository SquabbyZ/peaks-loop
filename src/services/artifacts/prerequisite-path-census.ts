/**
 * `src/services/artifacts/prerequisite-path-census.ts`
 *
 * Every artifact path the prerequisite tables demand, as one de-duplicated
 * list.
 *
 * WHY THIS EXISTS. The owner-skill map has to cover the paths the gates
 * actually demand, and the gates read ONE table. Reading that table through
 * a census function means the coverage check and the gate can never
 * disagree about which paths exist — a second hand-written list would drift
 * from the table on the first table change.
 *
 * The `<rid>` placeholder is left in place: this is the table's own shape,
 * and the owner lookup is a prefix match, so the placeholder is irrelevant to
 * it.
 */

import { PREREQUISITES_BY_TYPE } from './artifact-prerequisites.js';

/**
 * Every `relativePath` any request type demands, de-duplicated and sorted.
 */
export function allPrerequisitePaths(): readonly string[] {
  const paths = new Set<string>();
  for (const table of Object.values(PREREQUISITES_BY_TYPE)) {
    for (const requirements of Object.values(table)) {
      if (requirements === undefined) continue;
      for (const requirement of requirements) {
        paths.add(requirement.relativePath);
      }
    }
  }
  return [...paths].sort();
}
