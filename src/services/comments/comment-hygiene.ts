/**
 * Which comments are still worth their bytes to the next reader.
 *
 * Two categories are reported as hygiene debt, and they fail in different
 * directions, so they are kept separate rather than summed into one number:
 *
 *   - `dead-reference` — the comment asserts that some file exists by naming a
 *     path, and that path resolves nowhere the citation is allowed to mean. This
 *     is checkable, and it is the class that has already cost this repository a
 *     wrong decision: the header of `src/services/prd/handoff-gate-evidence.ts`
 *     described a pre-existing "no producer" state in the same voice as the
 *     current one, a reader took it as fact, and the fix was chased into
 *     `dist/` instead of the source.
 *   - `narrative` — the comment is about the work rather than the code: slice
 *     and rid identifiers, `AC-3`, "F2 of `rid-…`", "this used to claim", "the
 *     test named above was deleted". Legitimately valuable in a commit message
 *     or `.peaks/docs/backlog.md`; in a source file it is re-read by every
 *     later agent, at their token cost, and it rots silently the moment the
 *     history it summarises moves.
 *
 * The narrative rule is a marker list, not a heuristic about length or
 * sentence shape, precisely because a false positive here is worse than a false
 * positive on `dead-reference`: a wrong `dead-reference` is visible in a diff as
 * a removed path, while a wrong `narrative` deletes a reason someone wrote down
 * on purpose. Every finding carries its matched marker for that reason — an
 * unattributable finding is one nobody can review, and a rule nobody can review
 * is a rule that will be widened until it stops mattering.
 */

import {
  citationResolves,
  citations,
  commentLines,
  type CommentLine
} from './comment-citations.js';
import { isCitationCandidate } from './citation-rules.js';

/** Why a comment line was flagged. */
export type CommentFindingKind = 'dead-reference' | 'narrative';

export type CommentFinding = {
  readonly file: string;
  readonly line: number;
  readonly kind: CommentFindingKind;
  /** The path that does not resolve, or the marker that matched. Never prose. */
  readonly matched: string;
  readonly text: string;
};

/**
 * Development-process markers. Each entry is a named rule so a report can say
 * WHICH one fired — the failure mode this whole feature is modelled on is a
 * refusal that could not name itself (the content scan in
 * `src/services/memory/project-memory-service/store/atomic-write.ts` answered a
 * ten-pattern `||` chain with `matchedTerm: null`).
 *
 * Order is significant and is the whole attribution: one line reports its FIRST
 * match, so a specific marker must precede the general one that also fits it.
 * `F2 of \`rid-…\`` is a finding reference, not a bare rid, and a list ordered
 * the other way round would blame the wrong rule for every such line.
 */
export const NARRATIVE_MARKERS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'finding-id', pattern: /\b[DF]\d+\s+of\b/ },
  { name: 'acceptance-id', pattern: /\bAC-\d+\b/ },
  {
    name: 'slice-id',
    pattern: /\bslice\s+(?:`?)?(?:20\d\d-\d\d-\d\d|rid-|change-|S\d+\b|0\d\d\b)/i
  },
  { name: 'change-folder', pattern: /\b20\d\d-\d\d-\d\d-[a-z]+-[a-z-]+/ },
  { name: 'rid-id', pattern: /\brid-[a-z0-9][a-z0-9._-]*\b/i },
  {
    name: 'historical-voice',
    pattern:
      /\b(used to (?:say|claim|read|write)|previously (?:named|said)|no longer (?:exists|ships|carries)|which never existed|did not exist)\b/i
  },
  { name: 'deleted-test-ref', pattern: /\b(?:tests?|specs?)\b[^.]{0,48}\b(?:was|were) deleted\b/i },
  {
    name: 'guard-self-reference',
    pattern: /\bthis (?:comment|header|paragraph|note) (?:says|claimed|documents|is )/i
  }
];

export type CommentScanInput = {
  /** Repo-relative path, e.g. `src/services/x/y.ts`. */
  readonly file: string;
  readonly source: string;
};

export type CommentScanOptions = {
  /** Injected for tests; defaults to nothing-exists so a caller must decide. */
  readonly exists?: (relPath: string) => boolean;
  /** True for directories only; defaults to `exists`, which is true for both. */
  readonly dirExists?: (relDir: string) => boolean;
  /** Filesystem-only view of the tree, for the installed-package question.
   *  Defaults to `exists`. */
  readonly installed?: (relPath: string) => boolean;
  readonly kinds?: readonly CommentFindingKind[];
};

/** The probes and the scope one line is judged with, bundled so the rule fits. */
type LineJudge = {
  readonly file: string;
  readonly exists: (relPath: string) => boolean;
  readonly installed: (relPath: string) => boolean;
  readonly dirExists: (relDir: string) => boolean;
  readonly kinds: ReadonlySet<CommentFindingKind>;
};

function deadReferenceFindings(entry: CommentLine, judge: LineJudge): CommentFinding[] {
  const ctx = { file: judge.file, dirExists: judge.dirExists };
  const out: CommentFinding[] = [];
  for (const citation of citations(entry.text)) {
    if (!isCitationCandidate(citation, entry.text, ctx)) continue;
    if (citationResolves(citation.span, judge.file, judge.exists, judge.installed)) continue;
    out.push({
      file: judge.file,
      line: entry.line,
      kind: 'dead-reference',
      matched: citation.span,
      text: entry.text.trim()
    });
  }
  return out;
}

/**
 * One line, both readings. A line reports at most ONE narrative marker — its
 * first — because the list is ordered specific-before-general, and a line that
 * named every rule it matches would multiply the count without naming anything
 * a reader could not already see.
 */
function classifyLine(entry: CommentLine, judge: LineJudge): CommentFinding[] {
  const out: CommentFinding[] = judge.kinds.has('dead-reference')
    ? deadReferenceFindings(entry, judge)
    : [];
  if (!judge.kinds.has('narrative')) return out;
  for (const marker of NARRATIVE_MARKERS) {
    const hit = marker.pattern.exec(entry.text);
    if (hit === null) continue;
    out.push({
      file: judge.file,
      line: entry.line,
      kind: 'narrative',
      matched: `${marker.name}:${hit[0].trim()}`,
      text: entry.text.trim()
    });
    break;
  }
  return out;
}

/** Every finding in one file, in line order. */
export function scanComments(
  input: CommentScanInput,
  options: CommentScanOptions = {}
): CommentFinding[] {
  const exists = options.exists ?? (() => false);
  const judge: LineJudge = {
    file: input.file,
    exists,
    installed: options.installed ?? exists,
    dirExists: options.dirExists ?? exists,
    kinds: new Set<CommentFindingKind>(options.kinds ?? ['dead-reference', 'narrative'])
  };
  const out: CommentFinding[] = [];
  for (const entry of commentLines(input.source)) {
    out.push(...classifyLine(entry, judge));
  }
  return out;
}

/** Per-file totals, which is the shape the gate ratchets and the worklist sorts by. */
export type CommentFileSummary = {
  readonly file: string;
  readonly commentLines: number;
  readonly deadReferences: number;
  readonly narrative: number;
};

function countKind(findings: readonly CommentFinding[], kind: CommentFindingKind): number {
  return findings.filter((finding) => finding.kind === kind).length;
}

export function summarize(
  input: CommentScanInput,
  findings: readonly CommentFinding[]
): CommentFileSummary {
  return {
    file: input.file,
    commentLines: commentLines(input.source).length,
    deadReferences: countKind(findings, 'dead-reference'),
    narrative: countKind(findings, 'narrative')
  };
}
