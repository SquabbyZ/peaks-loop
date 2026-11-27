/**
 * DESIGN_FIDELITY — the fidelity half of the evidence pair written by
 * `peaks design fidelity <route>` (S4.2b). It gates `rd:qa-handoff` for feature
 * and bugfix slices beside DESIGN_CONFORMANCE; refactor reaches it through the
 * `REFACTOR_TABLE` alias.
 *
 * THE VERDICT IS CONDITIONAL ON THE PROJECT, not on one file, so this row is
 * answered by `designFidelityViolations` instead of the plain path resolver:
 *
 *   - no adopted design contract (the same `resolveContractRoot` + contract
 *     files rule `design check` uses, read through `readDesignStatus`) is
 *     NOT-APPLICABLE. Refusing here would lock every non-frontend slice and
 *     every frontend project that never adopted the contract. `readDesignStatus`
 *     also folds an AMBIGUOUS multi-app root into `adopted: false`; the gate has
 *     no `--app` selector, so the alternative is a permanent lock on a
 *     legitimate monorepo — the stated trade, not a silent one.
 *   - a contract adopted with no artifact under `design/fidelity/` is
 *     DESIGN_FIDELITY_MISSING.
 *   - every `*.md` artifact is read: `pass`, `not-applicable` and `accepted`
 *     open the handoff; `fail` and `blocked` refuse it, naming the artifact and
 *     the reason it recorded. One failing artifact refuses the handoff even
 *     when another passes.
 *
 * READ-ONLY. Nothing here launches a browser, starts a server, or writes: the
 * artifact is the producer's, and this module only reads it.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { readDesignStatus } from '../design/design-status.js';
import { getSessionDir } from '../session/getSessionDir.js';
import type { ArtifactPrerequisite } from './artifact-prerequisites.js';
import type { UnmetPrerequisite } from './prerequisite-checks.js';

/**
 * The artifact class the contract block and the path census name. One file per
 * prototype route is written as `design/fidelity/<route-slug>.md`, so no single
 * filename exists to put here.
 */
export const DESIGN_FIDELITY_RELATIVE_PATH = 'design/fidelity/<route>.md';

/** The named refusals. The code leads the description so a reader of the
 *  transition envelope can filter on it. */
export const DESIGN_FIDELITY_MISSING = 'DESIGN_FIDELITY_MISSING';
export const DESIGN_FIDELITY_FAILED = 'DESIGN_FIDELITY_FAILED';
export const DESIGN_FIDELITY_BLOCKED = 'DESIGN_FIDELITY_BLOCKED';

/** Verdicts that open the handoff. `accepted` is listed because a human
 *  acceptance is the design contract's existing escape hatch, mirroring
 *  DESIGN_CONFORMANCE; no writer emits it for fidelity today. */
const ACCEPTED_VERDICTS = new Set(['pass', 'not-applicable', 'accepted']);

export const DESIGN_FIDELITY: ArtifactPrerequisite = {
  relativePath: DESIGN_FIDELITY_RELATIVE_PATH,
  description:
    'Design fidelity evidence written by `peaks design fidelity <route>` (one `<route-slug>.md` per prototype route under design/fidelity/). A project without an adopted design contract is not-applicable and open; with a contract adopted, a missing artifact refuses as DESIGN_FIDELITY_MISSING, and a `design-fidelity: fail` or `blocked` verdict refuses naming the reason. `pass` and `not-applicable` open the handoff.',
  dynamicGate: 'design-fidelity'
};

type RecordedVerdict = { verdict: string; reason: string | null };

/** The `design-fidelity:` and `reason:` lines the writer emits in `## Fidelity`.
 *  Caller-controlled text is neutralised by the writer, so the first
 *  `design-fidelity:` line is the verdict, never prose that mentions it. */
function recordedVerdict(body: string): RecordedVerdict | null {
  const verdict = /^design-fidelity:\s*([a-z-]+)\s*$/m.exec(body)?.[1];
  if (verdict === undefined) return null;
  const reason = /^reason:\s*(.*)$/m.exec(body)?.[1]?.trim();
  const usable = reason === undefined || reason === '' || reason === '(none)' ? null : reason;
  return { verdict, reason: usable };
}

/** The markdown artifacts under `directory`, sorted; an absent directory is the
 *  normal "no artifact yet" case, not an error. */
async function artifactNames(directory: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

function missingArtifact(): UnmetPrerequisite {
  return {
    kind: 'absent',
    path: DESIGN_FIDELITY_RELATIVE_PATH,
    description:
      `${DESIGN_FIDELITY_MISSING}: the project's design contract is adopted, but no fidelity ` +
      'artifact exists under design/fidelity/. Run `peaks design fidelity <route>` for each ' +
      'prototype route.'
  };
}

/** The refusal one present artifact earns, or `null` when its verdict opens
 *  the handoff. */
async function artifactRefusal(directory: string, name: string): Promise<UnmetPrerequisite | null> {
  const read = recordedVerdict(await readFile(join(directory, name), 'utf8'));
  if (read !== null && ACCEPTED_VERDICTS.has(read.verdict)) return null;
  const code = read?.verdict === 'fail' ? DESIGN_FIDELITY_FAILED : DESIGN_FIDELITY_BLOCKED;
  const verdict = read === null ? 'no design-fidelity verdict' : read.verdict;
  const reason = read?.reason ?? 'the artifact states no reason';
  return {
    kind: 'body',
    path: `design/fidelity/${name}`,
    description: `${code}: ${name} records ${verdict} — ${reason}`
  };
}

/**
 * Every unmet fidelity requirement for this session, in filename order. Empty
 * means the handoff may proceed: either the project has no adopted contract, or
 * every artifact it does have records an accepted verdict.
 */
export async function designFidelityViolations(input: {
  projectRoot: string;
  sessionId: string;
}): Promise<UnmetPrerequisite[]> {
  const design = await readDesignStatus({ projectRoot: input.projectRoot });
  if (!design.adopted) return [];
  const directory = join(getSessionDir(input.projectRoot, input.sessionId), 'design', 'fidelity');
  const names = await artifactNames(directory);
  if (names.length === 0) return [missingArtifact()];
  const refusals: UnmetPrerequisite[] = [];
  for (const name of names) {
    const refusal = await artifactRefusal(directory, name);
    if (refusal !== null) refusals.push(refusal);
  }
  return refusals;
}
