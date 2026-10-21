/**
 *
 * Vendor-neutral PreToolUse gate. Reads the standard `{tool, input}`
 * JSON hook payload (any IDE / harness using this protocol is
 * supported; the implementation is host-agnostic) and decides
 * whether the tool call is allowed:
 *
 *   Edit / Write / MultiEdit on hard-blocked path families
 *   (src/, tests/unit/, tests/integration/, config/, bin/, scripts/)
 *   → deny with `PEAKS_CODE_PROHIBITED_DIRECT_EDIT`.
 *
 *   All other tool calls, OR allow-listed paths
 *   (.peaks/**, .peaks/_runtime/**, skills/**, docs/**, *.md)
 *   → allow (silent exit 0).
 *
 * Pure function. The shell-script sibling
 * (`pre-tool-code-gate.sh`) is the canonical source for the same
 * logic, usable from any non-Node harness. Both share the same
 * hard-blocked + allow-listed path families.
 */

import { isAbsolute, relative, resolve } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';

export type GateToolName = 'Edit' | 'Write' | 'MultiEdit' | string;

export type GatePathKey = 'file_path' | 'path' | 'notebook_path';

export interface GateInput {
  readonly tool: GateToolName;
  readonly input: Readonly<Record<string, unknown>>;
}

/** Hard-blocked path families — orchestrator MUST NOT Edit/Write these. */
export const HARD_BLOCKED_PATH_FAMILIES = [
  'src/',
  'tests/unit/',
  'tests/integration/',
  'config/',
  'bin/',
  'scripts/'
] as const;

/** Allow-listed path prefixes / suffixes — orchestrator may freely Edit/Write these. */
export const ALLOW_LISTED_PATH_PATTERNS = [
  '.peaks/',
  '.peaks_',
  'skills/',
  'docs/',
  '.md',
  'CHANGELOG.md',
  'README.md'
] as const;

/**
 * The single driver identity that opens the hard-blocked families: the
 * fast-lane skill's name, compared as a whole string. No prefix match and no
 * case folding — a future `peaks-race-<something>` sibling must NOT inherit
 * this write, because the write it opens is source editing.
 */
const FAST_LANE_DRIVER = 'peaks-race-code';

/** The tool names this gate judges. A call under any other name is allowed. */
export const GATED_TOOL_NAMES = ['Edit', 'Write', 'MultiEdit'] as const;

/** Is this tool one the gate judges at all? */
export function isGatedTool(tool: GateToolName): boolean {
  return (GATED_TOOL_NAMES as readonly string[]).includes(tool);
}

export type GateVerdict =
  | { readonly action: 'allow' }
  | {
      readonly action: 'deny';
      readonly filePath: string;
      readonly reason: string;
      readonly message: string;
    };

/** Pull the target file path from `input.file_path | input.path | input.notebook_path`. */
export function extractFilePath(input: Readonly<Record<string, unknown>>): string {
  for (const key of ['file_path', 'path', 'notebook_path'] as const) {
    const v = input[key];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

/**
 * Does the path belong to one of these families?
 *
 * The comparison folds CASE: every family name is written in lower case, and
 * on a case-insensitive filesystem (Windows, and macOS by default) `SRC/x.ts`
 * IS the file `src/x.ts`, so comparing the case exactly lets the spelling
 * decide the verdict. BOTH lists are folded the same way, because both are
 * judged against the same path: a case variant of an allow-listed file has to
 * reach the same verdict as the file itself, or the fold would only move the
 * inconsistency from one list to the other.
 *
 * THE TRADE-OFF, written down instead of left to look like an oversight: on a
 * case-SENSITIVE filesystem a repository holding BOTH `src/` and `SRC/`
 * refuses the edit under `SRC/` as well. That refusal is accepted on purpose.
 * A wrongly allowed edit is a hole in the gate; a wrongly refused one is an
 * inconvenience the caller can undo. Only the COMPARISON folds case - the
 * path the tool asked for is echoed to the caller exactly as it was spelled,
 * and the family a verdict names is the canonical one, not the folded form.
 */
function matchesAny(path: string, families: readonly string[]): string | null {
  const folded = path.toLowerCase();
  for (const fam of families) {
    if (folded.startsWith(fam.toLowerCase())) return fam;
    // also handle ".md" suffix pattern
    if (fam.startsWith('.') && folded.endsWith(fam.toLowerCase())) return fam;
  }
  return null;
}

/** Drop every leading `./` segment: `./src/x.ts` and `src/x.ts` are one path. */
function stripLeadingDotSegments(path: string): string {
  let out = path;
  while (out.startsWith('./')) out = out.slice(2);
  return out;
}

/**
 * Collapse the `.` and `..` segments of a RELATIVE path, lexically.
 *
 * The base directory does not enter the answer for a path that stays inside
 * it: a `..` cancels the segment before it, for every base. A `..` that would
 * leave the base is KEPT, so the result still reads as "outside", and a path
 * outside the project belongs to no family.
 */
function collapseRelativeDotSegments(path: string): string {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      const last = out.length > 0 ? out[out.length - 1] : null;
      if (last !== null && last !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(segment);
  }
  return out.join('/');
}

/**
 * The path of `target` relative to `root`, when `target` is INSIDE `root`;
 * `null` when it is not — the target is outside the root, or it is the root.
 */
function relativizeInsideRoot(target: string, root: string): string | null {
  const relativePath = normalizePath(relative(root, target));
  if (relativePath.length === 0) return null;
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) return null;
  return stripLeadingDotSegments(relativePath);
}

/**
 * The ONE spelling-independent form of a target path.
 *
 * The deny families are project-relative prefixes (`src/`, `tests/unit/`, …),
 * so how the incoming path happens to be SPELLED must not decide the verdict:
 * `src/x.ts`, `./src/x.ts` and the absolute spelling of that same file are one
 * file and must get one verdict. Without this, the same edit is denied in one
 * spelling and allowed in another — and the allow is the one that happens.
 *
 *   - separators fold to `/` (a Windows payload spells `src\x.ts`)
 *   - a leading `./` is dropped
 *   - a `..` segment is resolved
 *   - an ABSOLUTE path inside `projectRoot` becomes project-relative
 *   - an absolute path OUTSIDE `projectRoot` stays absolute: the families name
 *     THIS project's directories, and a path in another repository is another
 *     project's business. That is also what the gate already did with every
 *     absolute path, so it is not a widening.
 *   - with no `projectRoot` an absolute path cannot be made relative and is
 *     left as it is
 *
 * The base a `..` is resolved against is the PROJECT ROOT the caller named,
 * and that is a fact about the caller rather than a guess: the IDE invokes
 * `peaks code-gate --project "<the project directory>"`, and the tool call's
 * own working directory is that same project directory. A `..` that resolves
 * OUTSIDE the root names a file outside the project, so it belongs to no
 * family and is allowed - the same rule an absolute path outside the root
 * follows. The trade-off is written down rather than left implicit: a base
 * chosen wrongly would refuse files of a neighbouring directory, and the
 * project root is the one base both the caller and the tool call agree on.
 */
export function normalizeGatePath(filePath: string, projectRoot?: string | null): string {
  if (filePath.length === 0) return '';
  const slashed = normalizePath(filePath);
  const root =
    typeof projectRoot === 'string' && projectRoot.length > 0 ? resolve(projectRoot) : null;

  if (isAbsolute(slashed)) {
    if (root === null) return slashed;
    return relativizeInsideRoot(resolve(slashed), root) ?? slashed;
  }

  if (root === null) return collapseRelativeDotSegments(stripLeadingDotSegments(slashed));
  const resolved = resolve(root, slashed);
  const inside = relativizeInsideRoot(resolved, root);
  if (inside !== null) return inside;
  // The `..` left the project root: the target is another project's file.
  return normalizePath(resolved);
}

/**
 * Pure decision function. Given the tool name + input object, return
 * the gate verdict. Tolerates malformed payloads (allow).
 *
 * `driver` is the already-resolved identity of whoever is running the
 * tool call, or `null`/absent when no caller identity resolved. Absent and
 * `null` are the same verdict as before this parameter existed: the
 * hard-blocked families deny. Resolution is the caller's job, so this
 * module keeps no session, lease or filesystem state.
 *
 * `projectRoot` is the root the deny families are relative to. It is what
 * lets an ABSOLUTE path be judged like its relative spelling; without it an
 * absolute path cannot be related to the project and is left alone.
 */
export function decideGateAction(
  tool: GateToolName,
  input: Readonly<Record<string, unknown>>,
  driver?: string | null,
  projectRoot?: string | null
): GateVerdict {
  // Only gate Edit / Write / MultiEdit.
  if (!isGatedTool(tool)) {
    return { action: 'allow' };
  }

  const requestedPath = extractFilePath(input);
  if (requestedPath.length === 0) {
    // No path → cannot decide; fail-open (allow). The probe side
    // (`orchestrator-can-do`) handles slice-spec content; this hook
    // handles file paths only.
    return { action: 'allow' };
  }

  // The verdict is about the FILE, not about the spelling of the path that
  // names it, so the path is reduced to the project-relative form the
  // families are written in before anything is matched. The verdict still
  // echoes the path the tool actually asked for.
  const filePath = normalizeGatePath(requestedPath, projectRoot);

  // Allow-list check first — short-circuits any deny, for every driver.
  const allowMatch = matchesAny(filePath, ALLOW_LISTED_PATH_PATTERNS);
  if (allowMatch !== null) {
    return { action: 'allow' };
  }

  // Hard-blocked family check — case-insensitively, because every family name
  // is lower-case and the filesystem holding the file may not be.
  const denyMatch = matchesAny(filePath, HARD_BLOCKED_PATH_FAMILIES);
  if (denyMatch !== null) {
    // A driver that is not the fast lane falls through to the same deny a
    // two-argument call produces, so an unresolvable identity can never
    // become a silent pass.
    if (driver === FAST_LANE_DRIVER) {
      return { action: 'allow' };
    }
    const reason = `${denyMatch} (orchestrator's hard-blocked path family)`;
    const message =
      `PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${requestedPath} matches hard-blocked path family ${reason}; ` +
      `orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>`;
    return { action: 'deny', filePath: requestedPath, reason, message };
  }

  // Anything not in the deny list → allow (e.g. CHANGELOG, README, top-level files).
  return { action: 'allow' };
}
