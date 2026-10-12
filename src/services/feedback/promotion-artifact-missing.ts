/**
 * The reader half of the promotion-artifact concern: which of a layer's required
 * artifacts are NOT present, under a given project root.
 *
 * Extracted from `./feedback-promotion-service.ts` for the file-size cap, the way
 * `./promotion-artifact-evidence.ts` was extracted before it. That module builds
 * the decision from a file's text; this one decides whether the file is there to
 * read. The service re-exports `missingArtifacts` from its own path, so no
 * importer changed.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  artifactEvidenceFailure,
  type PromotionArtifactCheck
} from './promotion-artifact-evidence.js';

/**
 * Which of `checks` are not satisfied under `projectRoot`. Empty means the
 * promotion is backed by its artifact. Never throws, and never permits: a file
 * that is absent, unreadable, or unparseable is a finding, not a warning —
 * "cannot read the evidence" must not read as "the evidence is good".
 *
 * A check is satisfied when `path` OR any of its `alternatives` carries the
 * evidence; one that no candidate satisfies is reported ONCE, naming every
 * location it looked in, so a reader is never told about half the search.
 */
export function missingArtifacts(
  checks: readonly PromotionArtifactCheck[],
  projectRoot: string
): string[] {
  const missing: string[] = [];
  for (const check of checks) {
    const failures = candidateFailures(check, projectRoot);
    if (failures !== null) missing.push(failures.join('; '));
  }
  return missing;
}

/**
 * One `${path} (${reason})` per location that does NOT back `check`, or `null`
 * when one of them does. `null` and `[]` are different answers, which is why the
 * caller gets the distinction rather than an empty array.
 *
 * `check.alternatives` exists because a layer may legitimately keep its one
 * artifact in more than one place; the conjunction is across CHECKS, so an
 * alternative location cannot be spelled as another check without demanding it.
 */
function candidateFailures(check: PromotionArtifactCheck, projectRoot: string): string[] | null {
  const failures: string[] = [];
  for (const candidate of [check.path, ...(check.alternatives ?? [])]) {
    const absolute = resolve(projectRoot, candidate);
    if (!existsSync(absolute)) {
      failures.push(`${candidate} (absent)`);
      continue;
    }
    let text: string;
    try {
      text = readFileSync(absolute, 'utf8');
    } catch {
      failures.push(`${candidate} (unreadable)`);
      continue;
    }
    const failure = artifactEvidenceFailure(check, text);
    if (failure !== null) failures.push(`${candidate} (${failure})`);
  }
  return failures.length === 1 + (check.alternatives?.length ?? 0) ? failures : null;
}
