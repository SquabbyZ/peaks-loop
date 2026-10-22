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

import {
  canonicalGatePath,
  normalizeGatePath,
  rootPair,
  type GateRoots
} from './gate-path-normalize.js';

export { normalizeGatePath };
export type { GateRoots };

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

/**
 * The hard-blocked family a reading of the path names, or `null` when it
 * names none.
 *
 * The ALLOW-LIST is read FIRST, for each reading on its own: a path the
 * project allows is allowed, and a reading that names an allow-listed
 * directory does not become a deny because ANOTHER reading names a family.
 * That is what keeps `src/x.md` allowed, exactly as it was before.
 *
 * The family comparison folds CASE, because every family name is written in
 * lower case and the filesystem holding the file may not be.
 */
function hardBlockedFamilyOf(reading: string): string | null {
  if (matchesAny(reading, ALLOW_LISTED_PATH_PATTERNS) !== null) return null;
  return matchesAny(reading, HARD_BLOCKED_PATH_FAMILIES);
}

/**
 * The verdict for a file that one reading of the path placed in a
 * hard-blocked family.
 *
 * A driver that is not the fast lane falls through to the same deny a
 * two-argument call produces, so an unresolvable identity can never become a
 * silent pass.
 */
function denyVerdict(family: string, requestedPath: string, driver: string | null): GateVerdict {
  if (driver === FAST_LANE_DRIVER) {
    return { action: 'allow' };
  }
  const reason = `${family} (orchestrator's hard-blocked path family)`;
  const message =
    `PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${requestedPath} matches hard-blocked path family ${reason}; ` +
    `orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>`;
  return { action: 'deny', filePath: requestedPath, reason, message };
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
 * `roots` is where the verdict is taken: the root the deny families are
 * relative to, and the directory the tool call runs in. A bare string is the
 * project root alone, which is how every earlier call spelled it.
 *
 * The project root is what lets an ABSOLUTE path be judged like its relative
 * spelling; without it an absolute path cannot be related to the project and
 * is left alone. It is the project root the CALLER named, not the canonical
 * root above it: a project nested inside a git repository is judged against
 * itself, and the canonical root - where the session and the leases live - is
 * a different question that this parameter does not answer.
 *
 * The tool call's directory is the base a RELATIVE path is read against: the
 * file a call writes is the one that directory names. It does not move the
 * families - those stay relative to the project root - it only says which
 * file the payload points at.
 *
 * THE VERDICT IS THE STRICTEST OF THE TWO READINGS. The path is read
 * LEXICALLY - how it is written - and, when that reading has not already
 * denied the file, CANONICALLY - where the file really is. A directory can
 * be named two ways, and the difference is what a symlinked base looks like:
 * a call that runs in `link/` and writes `deep/x.ts` lands in `src/deep/x.ts`
 * when `link` points at `src`, and the lexical reading says `link/deep/x.ts`
 * - no family at all. §18.1 rules that the verdict depends on WHICH
 * DIRECTORY the file is in, not on how the path is written.
 *
 * Strictest, and not "canonical wins": making the canonical reading
 * authoritative would WIDEN the gate in a layout this repository supports.
 * When `src` is a symlink to `shared/src`, the lexical reading is
 * `src/x.ts` (a family) and the canonical one is `shared/src/x.ts` (not
 * one), and the file the gate denies today must stay denied. The tie-breaker
 * is the repository's own: a wrongly ALLOWED edit is a hole, a wrongly
 * REFUSED one is only an inconvenience. So a file reached through a
 * directory NAMED `src` stays refused even when it really sits in `docs/` -
 * the spelling is what the path says in this project's terms, and the gate
 * refuses it rather than resolve it.
 */
export function decideGateAction(
  tool: GateToolName,
  input: Readonly<Record<string, unknown>>,
  driver?: string | null,
  roots?: GateRoots
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
  const pair = rootPair(roots);
  const filePath = normalizeGatePath(requestedPath, pair.projectRoot, pair.toolCwd);

  // The LEXICAL reading: the allow-list first — it short-circuits any deny,
  // for every driver — and then the hard-blocked families.
  const denyMatch = hardBlockedFamilyOf(filePath);
  if (denyMatch !== null) {
    return denyVerdict(denyMatch, requestedPath, driver ?? null);
  }

  // The CANONICAL reading, asked only when the lexical one has not already
  // denied the file: it costs two filesystem lookups, and the file it names
  // is the one the lexical reading could not place.
  const canonical = canonicalGatePath(requestedPath, pair.projectRoot, pair.toolCwd);
  if (canonical !== null) {
    const canonicalMatch = hardBlockedFamilyOf(canonical);
    if (canonicalMatch !== null) {
      return denyVerdict(canonicalMatch, requestedPath, driver ?? null);
    }
  }

  // Anything not in the deny list → allow (e.g. CHANGELOG, README, top-level files).
  return { action: 'allow' };
}
