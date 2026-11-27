import { readFile } from 'node:fs/promises';

import { designFidelityViolations } from './design-fidelity-prerequisite.js';
import { emitPrereqTransitionEvent } from './prerequisite-transition-event.js';
import { isUnsafePathInput } from '../../shared/path-safety.js';
import { bodyViolationsIfDeclared, missingPrerequisiteWarning } from './prerequisite-checks.js';
import { PREREQUISITES_BY_TYPE } from './prerequisite-tables.js';
import {
  resolvePrerequisiteAbsolutePathWithFallback,
  resolvePrerequisitePath,
  sessionRootsFor
} from './prerequisite-path-resolver.js';
import type { RequestArtifactRole, RequestArtifactState } from './request-artifact-service.js';

// The commit-leg expiry gate lives in its own module to keep this file under
// the file-size cap; re-exported here so every caller keeps one import site.
export {
  checkExpiredBackCompatCommitGate,
  type ExpiredBackCompatCommitGateOptions
} from './backcompat-acceptance.js';

// The request-type tables moved to `prerequisite-tables.ts` for the same
// file-size reason; re-exported so every existing importer keeps its site.
export { PREREQUISITES_BY_TYPE };

export type RequestType = 'feature' | 'bugfix' | 'refactor' | 'docs' | 'config' | 'chore';

export const VALID_REQUEST_TYPES: ReadonlyArray<RequestType> = [
  'feature',
  'bugfix',
  'refactor',
  'docs',
  'config',
  'chore'
];

export const DEFAULT_REQUEST_TYPE: RequestType = 'feature';

export function isRequestType(value: string): value is RequestType {
  return (VALID_REQUEST_TYPES as ReadonlyArray<string>).includes(value);
}

export type ArtifactPrerequisite = {
  /** Relative path under `.peaks/_runtime/<session-id>/`. May contain `<rid>` placeholder. */
  relativePath: string;
  /** Human-readable description of what this artifact represents. */
  description: string;
  /** Optional content markers — when set, the file must contain ALL of these (case-insensitive substring). */
  mustContain?: ReadonlyArray<string>;
  /**
   * Optional content markers — when set, the file must contain AT LEAST ONE of
   * these (case-insensitive substring). Use this for escape-hatch patterns
   * (e.g. perf-baseline's "Results table" OR "N/A — no perf surface" stub).
   * `mustContain` and `mustContainAny` are independent: when both are set,
   * `mustContain` markers must all be present AND at least one `mustContainAny`
   * marker must be present.
   */
  mustContainAny?: ReadonlyArray<string>;
  /**
   * Slice 2.6.1.F: structural heading markers — when set, the file must
   * contain ALL of these as markdown headings (line beginning with `#`–`###`
   * followed by the marker, case-insensitive). This prevents a file from
   * passing the gate by simply mentioning the marker as prose. Use this for
   * section-anchored gates like the karpathy 4-guideline review.
   * Independent of `mustContain` / `mustContainAny`.
   */
  headingMustContain?: ReadonlyArray<string>;
  /**
   * The immediately previous location of this artifact. When
   * `relativePath` does not resolve on disk, the resolver tries this
   * path before reporting the prereq as missing.
   *
   * This field is a published surface, not just a private hint:
   * `verify-pipeline`'s `contractEvidencePaths()`
   * (`src/services/workflow/pipeline-verify-gate-support.ts`) reads it
   * to build its probe list, so it must keep meaning "the one path a
   * previous release wrote". Do not repurpose it as a general list —
   * add older tiers to `legacyRelativePaths` instead.
   *
   * Body checks (`mustContain` / `mustContainAny` /
   * `headingMustContain`) apply to whichever path resolved — the
   * gate does not distinguish which path served the file. That is
   * deliberate: a legacy hit must keep the gate open, or existing
   * sessions would fail the transition on upgrade.
   */
  legacyRelativePath?: string;
  /**
   * Further, older locations, tried **in declared order** after
   * `legacyRelativePath`. The two audit artifacts have a two-release
   * history, and the oldest tier still has to resolve on disk.
   */
  legacyRelativePaths?: ReadonlyArray<string>;
  /** Back-compat window — a missing file warns instead of failing; see `prerequisite-checks.ts`. */
  backCompat?: boolean;
  /** The release that CLOSES that window (e.g. `v2.14.0`); the warning code's suffix. */
  backCompatUntil?: string;
  /**
   * A check the file resolver cannot express: whether this prerequisite is
   * unmet depends on the project's own state, not on a file at `relativePath`.
   * `design-fidelity` is answered by the read-only checker in
   * `design-fidelity-prerequisite.ts`; `relativePath` then names the artifact
   * class for the contract block and the path census, never a file the
   * resolver probes.
   */
  dynamicGate?: 'design-fidelity';
};

export type PrerequisiteCheckResult = {
  ok: boolean;
  missing: Array<{ path: string; description: string; kind: 'absent' | 'body' }>;
  /**
   * Missing files inside a back-compat window (see
   * `ArtifactPrerequisite.backCompat`). NOT a failure — the gate does not throw
   * on these, so legacy callers keep working. They ARE reported:
   * `transitionRequestArtifact` copies the list onto its success result and
   * `peaks request transition` prints each one as an envelope warning, so a
   * soft-passed prerequisite is not read as a passed one. `code` is derived per
   * prerequisite (`prerequisite-checks.ts`), so it names which artifact.
   */
  warnings: Array<{ path: string; code: string; message: string; expiredWindow?: string }>;
};

export type CheckPrerequisitesOptions = {
  projectRoot: string;
  /**
   * Durable scope of the artifact (the `.peaks/_runtime/<sessionId>/` directory
   * the file lives in). The gate scans under `.peaks/_runtime/<sessionId>/<role>/`
   * for prerequisite artifacts.
   */
  sessionId: string;
  role: RequestArtifactRole;
  newState: RequestArtifactState;
  requestId: string;
  /**
   * Required, with no default. The `?? DEFAULT_REQUEST_TYPE` that used to sit in
   * `getPrerequisitesFor`'s signature let a caller silently select the `feature`
   * table by omitting an argument; a caller that wants the default now has to
   * write it, and the one place that legitimately substitutes it is the artifact
   * reader (`request-artifact-metadata.ts`), which labels the substitution.
   */
  requestType: RequestType;
  /**
   * False for a caller that is not a state move — the retag command's impact
   * probe reads the table without transitioning anything, and the event stream
   * is read as a record of transitions.
   */
  emitEvents?: boolean;
};

export function getPrerequisitesFor(
  role: RequestArtifactRole,
  newState: RequestArtifactState,
  requestType: RequestType
): ReadonlyArray<ArtifactPrerequisite> {
  const table = PREREQUISITES_BY_TYPE[requestType];
  return table[`${role}:${newState}`] ?? [];
}

export async function checkPrerequisites(
  options: CheckPrerequisitesOptions
): Promise<PrerequisiteCheckResult> {
  const requirements = getPrerequisitesFor(options.role, options.newState, options.requestType);
  if (requirements.length === 0) {
    return { ok: true, missing: [], warnings: [] };
  }
  // Repair R5. The session id is joined into BOTH roots below and then probed
  // on disk. `transitionRequestArtifact` is the only caller and it passes
  // `existing.sessionId`, which pre-R5 was the caller's raw `--session-id`: with
  // `../../../PWNED-R34` the two joins resolved outside the project root and
  // the prerequisite probes ran there. Guarded at the sink, not at the caller,
  // for the same reason `requestArtifactRequestsDir` is.
  if (options.sessionId !== undefined && isUnsafePathInput(options.sessionId)) {
    throw new Error(`Invalid session id: ${options.sessionId} (must be a single path segment)`);
  }
  // per-change-id scope (`.peaks/_runtime/<sessionId>/<role>/`) is gone — new
  // artifacts go to the session dir directly. The 2 tiers are:
  //   1. `.peaks/_runtime/<sid>/<role>/...` (post-F3 canonical
  //      session home; primary).
  //   2. `.peaks/_runtime/<sid>/<role>/...` (pre-F3 legacy session home;
  //      back-compat).
  // The sessionId is preserved in the artifact body's frontmatter for
  // human navigation; it is no longer a filesystem path key.
  // The two tiers are built by the resolver module, so the commit gate and this
  // transition probe the same directories.
  const roots = sessionRootsFor(options.projectRoot, options.sessionId);
  const missing: Array<{ path: string; description: string; kind: 'absent' | 'body' }> = [];
  const warnings: Array<{ path: string; code: string; message: string }> = [];
  for (const prerequisite of requirements) {
    // The conditional rows decide from the project's own state and read their
    // evidence themselves; the file resolver would report a directory-shaped
    // path as absent and lock every project without a design contract.
    if (prerequisite.dynamicGate === 'design-fidelity') {
      missing.push(
        ...(await designFidelityViolations({
          projectRoot: options.projectRoot,
          sessionId: options.sessionId
        }))
      );
      continue;
    }
    const relative = resolvePrerequisitePath(prerequisite, options.requestId);
    const absolute = await resolvePrerequisiteAbsolutePathWithFallback(
      roots.canonical,
      roots.legacy,
      prerequisite,
      options.requestId
    );
    if (absolute === null) {
      // A `backCompat` prerequisite downgrades a missing file to a warning, NOT
      // a hard failure; v2.14.0/v2.15.0 re-elevate it. The decision and the
      // code that names the artifact live in `prerequisite-checks.ts`.
      const softWarning = missingPrerequisiteWarning(prerequisite, relative);
      if (softWarning !== null) {
        warnings.push(softWarning);
        continue;
      }
      missing.push({ kind: 'absent', path: relative, description: prerequisite.description });
      continue;
    }
    // Read handed over as a thunk: the no-body-contract guard lives with the check.
    const bodyViolations = await bodyViolationsIfDeclared(prerequisite, () =>
      readFile(absolute, 'utf8')
    );
    for (const description of bodyViolations) {
      missing.push({ kind: 'body', path: relative, description });
    }
  }
  // own `gateEvidence` DECLARATION must be true — every path it names must
  // exist. The table loop above owns "which artifacts this type must produce";
  // this owns "the handoff may not claim evidence it does not have". They are
  // complementary, and neither restates the other's paths: the declaration is
  // derived from THE SAME table (`gate-evidence-derivation.ts`), so a row
  // changed above changes the declared path below without a second edit.
  //
  // Guarded on `rd:qa-handoff` because that IS Gate C (the doc's gate table is
  // keyed on it), and placed after the loop so it inherits the same
  // `missing` / `warnings` / `ok` arithmetic the caller already throws on —
  // `--allow-incomplete` and the `bypassedPrerequisites` report keep working
  // with no second bypass path to keep in sync.
  //
  // It is skipped for types whose table has no `rd:qa-handoff` row (docs /
  // chore) — the early return above means those types require no evidence at
  // all, so there is no evidence contract to check. The `projectScan` they do
  // carry is Gate A's, and Gate A is the check that owns it.
  //
  // The import is dynamic because `gate-evidence-derivation.ts` reaches
  // `handoff-service.ts`, which imports `REQUEST_ID_PATTERN` from
  // `request-artifact-service.ts`, which imports this module: a static edge
  // here would close a runtime import cycle. Same idiom, same reason, as
  // `request-commands.ts`'s lazy producer imports.
  if (options.role === 'rd' && options.newState === 'qa-handoff') {
    const { checkDeclaredGateEvidence } = await import('../prd/gate-evidence-derivation.js');
    const declaredEvidence = await checkDeclaredGateEvidence({
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      requestId: options.requestId
    });
    missing.push(...declaredEvidence.missing);
    warnings.push(...declaredEvidence.warnings);

    // The security audit artifact declares the paths it judged; the check
    // re-hashes them, so a repair after the audit is refused by name. An
    // artifact with no declaration is refused here, not waved through — a
    // deleted section is the shed this arm exists to close.
    const { describeJudgedRefusal, verifyJudgedDeclaration } =
      await import('../audit-independent/judged-declaration-check.js');
    for (const gap of verifyJudgedDeclaration({
      projectRoot: options.projectRoot,
      sessionId: options.sessionId,
      requestId: options.requestId
    }).refusals) {
      missing.push({ kind: 'body', path: gap.artifact, description: describeJudgedRefusal(gap) });
    }
  }

  const result: PrerequisiteCheckResult = { ok: missing.length === 0, missing, warnings };
  if (options.emitEvents === false) return result;
  emitPrereqTransitionEvent({
    projectRoot: options.projectRoot,
    sessionId: options.sessionId ?? '',
    role: options.role,
    newState: options.newState,
    requestId: options.requestId,
    result
  });
  return result;
}
