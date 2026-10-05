/**
 * artifact has to PROVE.
 *
 * The three layers used to be checked with `text.includes(<rule name>)` over the
 * whole file. A substring test cannot tell "the rule is registered" from "a
 * comment saying the rule is absent", so a refusal tree passed every layer:
 *
 *   - layer A: a `.peaks/sops/registry.json` that is not valid JSON, with the id
 *     still somewhere in its bytes;
 *   - layer B: a settings template whose only mention of the rule reads
 *     "do NOT add a matcher for <rule>";
 *   - layer C: a `mode-gate.ts` whose only mention reads
 *     "// TODO: <rule> is DELIBERATELY NOT a hard-floor category".
 *
 * All three are the same defect facing the other way: an unreadable artifact is
 * treated as a permitted one. Each check below therefore parses its evidence and
 * asserts the SHAPE, and every failure is a finding — never a warning that
 * permits. Nothing here throws: an unparseable file is reported, not swallowed.
 *
 * R8 (same rid) — the same defect survived inside R2's repair, in two places:
 *
 *   - layer C matched a member's `doc` by name MENTION, so an adverse line
 *     sitting between two vocabulary members became the following member's doc
 *     and the verdict flipped on where the comment sat. The predicate is now this
 *     repo's own citation form — the memory cited by PATH,
 *     `.peaks/memory/<id>.md`, exactly as `mode-gate.ts:41` does — rather than
 *     the memory merely named. That citation requirement is what closes the
 *     placement dependence; the doc is also read from the comment SPANS attached
 *     to the member rather than from the raw slice, which states "code is not a
 *     doc" as an invariant rather than relying on the raw slice to honour it;
 *   - layer B kept `matcher.includes(id)` / `command.includes(id)` over free
 *     text, so `command: "echo 'do NOT add a matcher for rule-x'"` registered a
 *     rule by writing a sentence about it. Both fields are now parsed: a matcher
 *     is a tool selector, a command is argv.
 *
 * R10 (same rid) — layer C read the `HardFloorCategory` union and the
 * `HARD_FLOOR_CATEGORIES` array as ONE flattened member list, so a member of the
 * union alone satisfied the check. Measured on the R8 bytes: a union-only literal
 * — and a union-only member whose doc cited `.peaks/memory/<id>.md` — were both
 * reported BACKED, while `isHardFloorCategory` (which reads the array) returned
 * false and `shouldPauseAtGate` returned `shouldPause: false`. The gate certified
 * a hard floor that paused nothing, contradicting its own message. Only the array
 * enforces, so only the array is now evidence — for the name and for the citation
 * alike. The union is still READ, for one reason only: a category's doc belongs
 * to the category, and this repo documents `commit-boundary-side-effect` beside
 * the union member while the array enforces it.
 */

// Slice `b1-filesplit-campaign` (wave 3): the JSON-artifact shape predicates and
// the comment / vocabulary-member machinery moved VERBATIM into two sibling
// modules so this file clears the 300 raw-line cap. The two public type names are
// re-exported from here, so no importer changed.
import {
  isRecord,
  isToolMatcher,
  manifestFailure,
  type PromotionArtifactCheck,
  registryFailure
} from './promotion-artifact-json-evidence.js';
import {
  citedMemories,
  type CommentSpan,
  commentSpans,
  maskComments,
  mergeByLiteral,
  type VocabularyMember
} from './promotion-source-comments.js';

export type {
  PromotionArtifactCheck,
  PromotionEvidence
} from './promotion-artifact-json-evidence.js';

/**
 * Split a hook command the way a shell does: whitespace separates words, and
 * quotes group whitespace INTO a word rather than ending it. So a phrase inside
 * a string literal arrives as one long word, while a path arrives short.
 */
function commandWords(command: string): string[] {
  const words: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < command.length; i += 1) {
    const char = command[i] as string;
    if (char === '\\' && quote !== "'" && i + 1 < command.length) {
      current += command[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (quote !== null) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) words.push(current);
      current = '';
      started = false;
      continue;
    }
    current += char;
    started = true;
  }
  if (started) words.push(current);
  return words;
}

const SCRIPT_EXTENSION_RE = /\.(?:c|m)?[jt]s$|\.(?:sh|bash|ps1|py|rb)$/i;

/**
 * Does this hook `command` RUN something named after the rule?
 *
 * A command is argv, not prose. The rule counts only when its name sits inside a
 * single word that (a) is not a phrase — no embedded whitespace, so a sentence
 * inside a string literal is out — and (b) designates a file the hook executes:
 * a path, or a script by extension.
 *
 * `echo 'do NOT add a matcher for rule-x'` parses to two words, the second of
 * which holds the rule's name and four spaces: a sentence ABOUT the rule, not an
 * invocation of it. `node scripts/enforce-rule-x.js` parses to two words, the
 * second a path. That difference is the check.
 */
function commandRegistersRule(command: string, id: string): boolean {
  return commandWords(command).some((word) => {
    if (/\s/.test(word)) return false;
    if (!word.includes(id)) return false;
    return word.includes('/') || word.includes('\\') || SCRIPT_EXTENSION_RE.test(word);
  });
}

/**
 * Layer B. A hook group is `{ matcher?, hooks: [...] }`. The matcher SELECTS
 * TOOLS, so it can never name a rule: a group whose selector is not a tool
 * matcher fires nothing and registers nothing. The registration itself is a hook
 * command that runs something named after the rule — prose elsewhere in the file
 * (an `env` note saying "do NOT add a matcher") is not a registration, and
 * neither is a sentence in a command.
 */
function hookFailure(parsed: unknown, id: string): string | null {
  if (!isRecord(parsed)) return 'not a JSON object';
  if (!isRecord(parsed.hooks)) return 'has no "hooks" object';
  for (const groups of Object.values(parsed.hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isRecord(group)) continue;
      if (typeof group.matcher === 'string' && !isToolMatcher(group.matcher)) continue;
      const hooks = group.hooks;
      if (!Array.isArray(hooks)) continue;
      const registers = hooks.some(
        (h) => isRecord(h) && typeof h.command === 'string' && commandRegistersRule(h.command, id)
      );
      if (registers) return null;
    }
  }
  return `no hook registration runs anything named "${id}" (a hook command must invoke a file named after the rule)`;
}

/**
 * Collect the members of the hard-floor vocabulary, each with the comment text
 * that governs it. `masked` decides where a member STARTS (so a quoted string
 * inside a comment is not a member, and no comment can inject the `;` / `]` that
 * bounds a declaration); the doc is read from the comment SPANS inside the
 * member's slot. Taking it from the raw slice instead — as R2 did — let CODE
 * between two members become a doc, which is what made the verdict depend on
 * where an adverse line sat.
 */
function collectMembers(
  masked: string,
  comments: readonly CommentSpan[],
  start: number,
  end: number,
  enforcing: boolean,
  out: VocabularyMember[]
): void {
  const body = masked.slice(start, end);
  const literalRe = /'([^']*)'/g;
  let match: RegExpExecArray | null;
  let previousEnd = 0;
  while ((match = literalRe.exec(body)) !== null) {
    // A member literal is preceded by nothing but whitespace, a `|` (union) or a
    // `,` (array). Anything else — a `'` inside prose, say — is not a member.
    if (/^[\s|,]*$/.test(body.slice(previousEnd, match.index))) {
      const from = start + previousEnd;
      const to = start + match.index;
      out.push({
        literal: match[1] as string,
        doc: comments
          .filter((comment) => comment.start >= from && comment.end <= to)
          .map((comment) => comment.text)
          .join('\n'),
        enforcing
      });
    }
    previousEnd = match.index + match[0].length;
  }
}

/**
 * The two declarations that spell the vocabulary: the `HardFloorCategory` union
 * (a type) and `HARD_FLOOR_CATEGORIES` (the array `isHardFloorCategory` reads).
 * They are the same vocabulary, but only the ARRAY enforces — see
 * `mergeByLiteral` for why the union is still read.
 */
function vocabularyMembers(source: string): VocabularyMember[] {
  const masked = maskComments(source);
  const comments = commentSpans(source);
  const raw: VocabularyMember[] = [];
  const union = /export\s+type\s+HardFloorCategory\s*=/.exec(masked);
  if (union) {
    const start = union.index + union[0].length;
    const end = masked.indexOf(';', start);
    if (end > start) collectMembers(masked, comments, start, end, false, raw);
  }
  const array = /HARD_FLOOR_CATEGORIES\s*:/.exec(masked);
  if (array) {
    const equals = masked.indexOf('=', array.index);
    const open = masked.indexOf('[', equals);
    const close = masked.indexOf(']', open + 1);
    if (equals > array.index && open > equals && close > open) {
      collectMembers(masked, comments, open + 1, close, true, raw);
    }
  }
  return mergeByLiteral(raw);
}

/**
 * Layer C. The rule counts when it IS a member of `HARD_FLOOR_CATEGORIES`, or
 * when one of THAT ARRAY's members has a doc block that CITES it the way this
 * repo cites a memory — by path: `commit-boundary-side-effect` cites
 * `.peaks/memory/2026-06-28-full-auto-boundary.md`.
 *
 * R10 — both clauses are gated on `enforcing`. Certifying membership in the
 * `HardFloorCategory` union alone is what let the check report BACKED for a
 * category that `isHardFloorCategory` rejects and `shouldPauseAtGate` ignores.
 *
 * A citation is a deliberate act with a shape; a name is a word that any
 * sentence can carry. `// TODO: <rule> is DELIBERATELY NOT a hard-floor
 * category` names the rule while saying the opposite, and is rejected in every
 * placement — the predicate never reads the sentence the citation sits in, so
 * prose that negates a citation is a residual this cannot see. What it does see
 * is the difference between being cited and being mentioned.
 */
function hardFloorFailure(source: string, id: string): string | null {
  const registered = vocabularyMembers(source).some(
    (member) =>
      member.enforcing && (member.literal === id || citedMemories(member.doc).includes(id))
  );
  return registered
    ? null
    : `no hard-floor category names "${id}" (it must be a member of HARD_FLOOR_CATEGORIES, or cited by one as ".peaks/memory/${id}.md")`;
}

/**
 * The reason `check` is unsatisfied by `text`, or `null` when it is satisfied.
 * Never throws: a file that cannot be parsed yields the reason it could not be.
 */
export function artifactEvidenceFailure(
  check: PromotionArtifactCheck,
  text: string
): string | null {
  if (check.evidence === 'hard-floor-category') return hardFloorFailure(text, check.id);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return `not valid JSON: ${(err as Error).message}`;
  }
  if (check.evidence === 'sop-manifest') return manifestFailure(parsed, check.id);
  if (check.evidence === 'sop-registry-entry') return registryFailure(parsed, check.id);
  return hookFailure(parsed, check.id);
}
