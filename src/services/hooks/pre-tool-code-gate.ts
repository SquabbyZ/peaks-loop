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

function matchesAny(path: string, families: readonly string[]): string | null {
  for (const fam of families) {
    if (path.startsWith(fam)) return fam;
    // also handle ".md" suffix pattern
    if (fam.startsWith('.') && path.endsWith(fam)) return fam;
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
 */
export function decideGateAction(
  tool: GateToolName,
  input: Readonly<Record<string, unknown>>,
  driver?: string | null
): GateVerdict {
  // Only gate Edit / Write / MultiEdit.
  if (tool !== 'Edit' && tool !== 'Write' && tool !== 'MultiEdit') {
    return { action: 'allow' };
  }

  const filePath = extractFilePath(input);
  if (filePath.length === 0) {
    // No path → cannot decide; fail-open (allow). The probe side
    // (`orchestrator-can-do`) handles slice-spec content; this hook
    // handles file paths only.
    return { action: 'allow' };
  }

  // Allow-list check first — short-circuits any deny, for every driver.
  const allowMatch = matchesAny(filePath, ALLOW_LISTED_PATH_PATTERNS);
  if (allowMatch !== null) {
    return { action: 'allow' };
  }

  // Hard-blocked family check.
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
      `PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ${filePath} matches hard-blocked path family ${reason}; ` +
      `orchestrator MUST NOT Edit/Write these directly. Use: peaks sub-agent dispatch rd --prompt '<your task>' --request-id <rid> --project . --batch-id <uuid>`;
    return { action: 'deny', filePath, reason, message };
  }

  // Anything not in the deny list → allow (e.g. CHANGELOG, README, top-level files).
  return { action: 'allow' };
}
