/**
 * Slice `b1-filesplit-campaign` (wave 3) — verbatim extraction of the JSON-artifact
 * half of `./promotion-artifact-evidence.ts` (the evidence vocabulary and the three
 * layer-A / layer-B shape predicates) so that module clears the 300 raw-line cap.
 * No predicate body, no doc comment and no message string changed; the original
 * module re-exports the two public type names from its own path, so importers are
 * untouched.
 */

export type PromotionEvidence =
  /** A SOP manifest: a JSON object whose `id` is the SOP's and whose `gates` is an array. */
  | 'sop-manifest'
  /** An entry with the SOP's `id` inside `<registry>.sops[]` — what `readRegistry()` enumerates. */
  | 'sop-registry-entry'
  /** A hook registration (hook command) inside `hooks` that runs something named after the rule. */
  | 'hook-registration'
  /** A member of `HARD_FLOOR_CATEGORIES` — the array `isHardFloorCategory` reads — that names the rule. */
  | 'hard-floor-category';

export type PromotionArtifactCheck = {
  /** Project-relative POSIX path whose CONTENT must carry the evidence. */
  path: string;
  evidence: PromotionEvidence;
  /** The rule id the evidence must name (a SOP id for layer A, a memory name for B and C). */
  id: string;
};

/** Is `value` a JSON object (not null, not an array)? */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function manifestFailure(parsed: unknown, id: string): string | null {
  if (!isRecord(parsed)) return 'not a JSON object';
  if (parsed.id !== id) return `does not declare id "${id}"`;
  if (!Array.isArray(parsed.gates)) return 'has no "gates" array';
  return null;
}

export function registryFailure(parsed: unknown, id: string): string | null {
  if (!isRecord(parsed)) return 'not a JSON object';
  if (!Array.isArray(parsed.sops)) return 'has no "sops" array';
  const registered = parsed.sops.some((entry) => isRecord(entry) && entry.id === id);
  return registered ? null : `registry has no SOP entry with id "${id}"`;
}

/**
 * A tool selector: `Name` or `Name(pattern)`, one or more separated by `|` —
 * `Bash`, `Write|Edit|MultiEdit`, `Bash(git push:*)`. A segment that is not a
 * tool-name token (a hyphenated rule name, say) makes the selector malformed.
 */
const MATCHER_SEGMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*\s*(\(.*\))?$/;

export function isToolMatcher(matcher: string): boolean {
  const segments = matcher.split('|');
  return segments.every((segment) => MATCHER_SEGMENT_RE.test(segment.trim()));
}
