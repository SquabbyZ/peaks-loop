// tests/unit/services/session/_session-dir-scans.ts
//
// The scan machinery behind `session-dir-canonical.test.ts` — the same
// division `tests/unit/standards/_file-size-cap-scan.ts` uses: the scanners
// and their allow-lists live here, the collected scenario module keeps every
// case (and the 500-line cap for `tests/**`).
//
// Four invariants are implemented here; the test file's header states them.
//   (a) render    — not a scanner; the resolver's delegation, in the test.
//   (b) `src/**`  — a `.peaks` + session-id join with no `_runtime` in between.
//   (c) `skills/` — a legacy `.peaks/<sid>/…` path an LLM would follow.
//   (d) `src/**`  — a `.peaks` + `_runtime` composition, whose only permitted
//                   site is the workspace-runtime package's `defaultStateRoot`.
//
// Every allow-list entry is machine-checked to suppress a real violation (see
// `inertEntries`), so an entry cannot outlive the reason it was added and an
// inert one fails the suite.

import { join } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

// `src/` files exempt from invariant (b). Every entry MUST be load-bearing —
// i.e. the file must contain a chain the scanner would otherwise flag — and
// that is asserted by the test, so an exemption cannot silently outlive its
// reason. Four entries are intentional legacy **reads**. The fifth was a known
// scanner false positive (`request-artifact-service.ts`), retired by repair R5:
// its exit condition — "remove the entry once that parameter is renamed to
// reflect what it holds" — was met when `readSummary` stopped taking a
// pre-joined `_runtime/<sid>` scope fragment.
export const ALLOWED_LEGACY_READ_PATHS: ReadonlyArray<string> = [
  // Intentional legacy read, top-level probe of a 3-umbrella search
  // (`.peaks/<sid>`, `.peaks/retrospective/<sid>`, `.peaks/_dogfood/<sid>`).
  // The other two umbrellas are separate trees, not the session workspace.
  'src/services/sc/sc-service.ts',
  // Intentional legacy read: `legacyMisplacedQaDir` is the pre-1.3.0
  // `.peaks/<sessionId>/qa/` fallback, tagged `'legacy'` so Gate C can warn.
  'src/services/workflow/artifact-paths.ts',
  // Intentional legacy read: the L2.2 audit gate must still read 2.8.0-era
  // design drafts from the legacy sibling dir when one exists.
  'src/services/audit/enforcers/design-draft-confirm.ts',
  // Not a write target: the legacy string is pushed onto a `migratedFiles`
  // report list describing where a file was moved FROM.
  'src/services/workspace/reconcile-migrate.ts',
  // Intentional legacy read: `sessionRootsFor` builds tier 2 of the documented
  // pre-F3 back-compat fallback, which `resolvePrerequisiteAbsolutePathWithFallback`
  // then probes. Both the transition and the commit-leg expiry gate read it.
  'src/services/artifacts/prerequisite-path-resolver.ts'
];

// `src/` files exempt from invariant (b) because the session id they join is
// NOT a session RUNTIME directory — it names a FILE inside a git-TRACKED
// `.peaks/` tree. This list is SEPARATE from the legacy-read list above on
// purpose: the two exemptions have different reasons, and merging them would
// let a legacy-read exemption silently authorise a new tracked write (and the
// other way round). Every entry here is load-bearing under the same assertion
// as the list above, so an inert entry cannot accumulate either.
export const ALLOWED_TRACKED_SESSION_ARTIFACT_PATHS: ReadonlyArray<string> = [
  // The tracked per-session metric row lives at
  // `.peaks/observability/sessions/<sessionId>.json`.
  //
  // WHY THIS IS NOT A SESSION RUNTIME DIR. The underscore convention
  // (`.peaks/memory/workspace-underscore-convention.md`) makes a
  // non-underscore `.peaks/` segment a git-TRACKED truth source and an
  // underscore-prefixed one ephemeral. This row is tracked ON PURPOSE: it is
  // the artifact a CI runner or a fresh clone compares a session against, and
  // `.peaks/_runtime/<sid>/` is gitignored — routing the row through
  // `getSessionDir` would put the tracked row where git can never see it,
  // which defeats the only reason the row exists.
  //
  // The session id here is the FILE NAME inside a tracked directory, not a
  // directory of its own: nothing is written under a session-shaped
  // directory, so the slice-005 bug this scan exists for (a session-scoped
  // artifact landing at `.peaks/<sid>/…`) cannot be reproduced by this shape.
  'src/services/observability/session-metric-rows.ts'
];

/** Every `src/` allow-list entry, in one place, for the scanner and the test. */
export const ALLOWED_SRC_PATHS: ReadonlyArray<string> = [
  ...ALLOWED_LEGACY_READ_PATHS,
  ...ALLOWED_TRACKED_SESSION_ARTIFACT_PATHS
];

// `skills/` files exempt from invariant (c). Deliberately empty: the two
// historical entries (`skills/peaks-code/references/a2a-artifact-mapping.md`
// and `skills/bee/peaks-prd/SKILL.md`) were canonicalized by later slices and
// now emit zero violations, so the exemptions only hid those paths from the
// scan. Add an entry back — with a justification — if a legitimate
// legacy-shaped reference appears.
export const ALLOWED_LEGACY_SKILL_PATHS: ReadonlyArray<string> = [];

/** Session-scoped `<...>` placeholder shapes. Bare `<id>` is excluded: it is
 *  a global SOP id, not a session id. */
const SESSION_PLACEHOLDER = '<(?:sid|session-id|sessionId)>';
/** Path segments that are legitimately NOT the per-session workspace. */
const NON_WORKSPACE_SEGMENTS = ['_runtime', '_sub_agents', 'retrospective', '_dogfood'];
/** Bare or dot-qualified session-id argument names (`meta.sessionId`, ...). */
const SESSION_ID_TOKEN = /\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?sessionId\b/;

/**
 * A `join()` that composes the runtime directory out of its two literal
 * segments. Single-literal forms (`'.peaks/_runtime/...'`) and message strings
 * are NOT compositions and are not matched.
 */
const RUNTIME_DIR_COMPOSITION = /join\([^)]*'\.peaks'[^)]*'_runtime'/;

/**
 * `src/` files exempt from invariant (d): pre-existing hand-rolled layouts that
 * predate the shared state-root. A ratchet baseline, not a justification, and
 * it may only shrink — every entry is machine-checked to still compose, so
 * migrating a file out of it is how it goes away.
 */
export const COMPOSITION_BASELINE: { reason: string; files: ReadonlyArray<string> } = JSON.parse(
  readFileSync(join(__dirname, 'session-runtime-composition-baseline.json'), 'utf8')
);

const isNonWorkspace = (gap: string): boolean =>
  NON_WORKSPACE_SEGMENTS.some((token) => gap.includes(token));

export function listFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

/**
 * Find a `join(...)` chain that names `.peaks` and then a session-id token
 * without the canonical `_runtime` segment (or another non-workspace
 * segment) in between. Guards the resolver itself and the allow-list.
 */
export function findSessionDirJoinViolations(
  file: string,
  opts: { applyAllowList?: boolean } = {}
): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if (rel.endsWith('src/services/session/getSessionDir.ts')) return [];
  if ((opts.applyAllowList ?? true) && ALLOWED_SRC_PATHS.some((a) => rel.endsWith(a))) {
    return [];
  }

  // Template-literal form `` `.peaks/${sessionId}` `` is gap-safe by
  // construction: the canonical shape (`.peaks/_runtime/${...}`) has
  // `_runtime` before the `${`, so it cannot match.
  const templatePattern = /`\.peaks\/\$\{[^}]*sessionId[^}]*\}`/;
  const violations: Array<{ line: number; text: string }> = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    for (const call of line.matchAll(/join\(([^)]*)\)/g)) {
      const pk = (call[1] ?? '').indexOf('.peaks');
      if (pk === -1) continue;
      const rest = (call[1] ?? '').slice(pk + '.peaks'.length);
      const token = SESSION_ID_TOKEN.exec(rest);
      if (token === null) continue;
      if (!isNonWorkspace(rest.slice(0, token.index))) {
        violations.push({ line: i + 1, text: trimmed });
      }
    }
    if (templatePattern.test(line) && !violations.some((v) => v.line === i + 1)) {
      violations.push({ line: i + 1, text: trimmed });
    }
  }
  return violations;
}

/**
 * Find a `join()` that composes the runtime directory from `.peaks` +
 * `_runtime` instead of delegating to the workspace-runtime package. The only
 * permitted composition site is the package's `defaultStateRoot`.
 */
export function findDirectRuntimeComposition(
  file: string,
  opts: { applyAllowList?: boolean } = {}
): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if ((opts.applyAllowList ?? true) && COMPOSITION_BASELINE.files.some((a) => rel.endsWith(a))) {
    return [];
  }
  const violations: Array<{ line: number; text: string }> = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (RUNTIME_DIR_COMPOSITION.test(line)) violations.push({ line: i + 1, text: trimmed });
  }
  return violations;
}

/** Find `<root>/.peaks/<sid>/...` paths a sub-agent would follow verbatim. */
export function findSkillMarkdownLegacySessionPaths(
  file: string,
  opts: { applyAllowList?: boolean } = {}
): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if ((opts.applyAllowList ?? true) && ALLOWED_LEGACY_SKILL_PATHS.some((a) => rel.endsWith(a))) {
    return [];
  }

  const pattern = new RegExp(`\\.peaks(?:\\/([^\\s/]+))?\\/${SESSION_PLACEHOLDER}`);
  const violations: Array<{ line: number; text: string }> = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--') || trimmed.endsWith('-->')) continue;
    const match = line.match(pattern);
    if (match === null) continue;
    if (!isNonWorkspace(match[1] ?? '')) violations.push({ line: i + 1, text: trimmed });
  }
  return violations;
}

/** Run `scan` over `files`, reporting each hit relative to `root`. */
export function scanTree(
  root: string,
  files: string[],
  scan: (file: string) => Array<{ line: number; text: string }>
): Array<{ file: string; line: number; text: string }> {
  const prefix = root.replace(/\\/g, '/') + '/';
  const violations: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    for (const hit of scan(file)) {
      violations.push({ file: file.replace(/\\/g, '/').replace(prefix, ''), ...hit });
    }
  }
  return violations;
}

/**
 * Allow-list entries that suppress nothing. An exempted file with no violation
 * is a hole in the guard — it only blinds the scan to that path — so every
 * entry has to be load-bearing, and this is the check that says so.
 */
export function inertEntries(
  entries: ReadonlyArray<string>,
  scan: (file: string, opts: { applyAllowList: boolean }) => Array<{ line: number; text: string }>,
  root: string
): string[] {
  return entries.filter((rel) => scan(join(root, rel), { applyAllowList: false }).length === 0);
}
