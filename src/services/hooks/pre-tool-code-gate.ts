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

import { normalizeGatePath, rootPair, type GateRoots } from './gate-path-normalize.js';

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
