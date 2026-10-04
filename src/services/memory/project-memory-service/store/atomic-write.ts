// ---------------------------------------------------------------------------
// Sensitive-content + write helpers for the project memory store.
//
//   - `hasSensitiveMemoryContent` — pattern check for api keys, tokens,
//     PEM private keys, JWTs, GitHub / GitLab tokens, AWS access keys. Used
//     both by the extract path (`assertSafeMemory`) and the backup path
//     (`assertSafeMemoryFileContent`). It is a wrapper over
//     `findSensitiveMemoryContentRule`, which answers the same question and
//     names the rule that answered it.
//   - `findSensitiveMemoryTitleTerm` — the PROSE predicate for
//     `memory.title`. It is deliberately NOT the config-key predicate: see
//     the block comment above it (slice C0).
//   - `assertSafeMemory` — full safety gate applied during extraction.
//     Combines the metadata key scan + the content pattern scan + the title
//     scan. Each failure names the check that fired, and the title one names
//     the term it matched.
//   - `assertSafeMemoryFileContent` — lighter version for backup: just
//     the content pattern scan, since the file already lives in
//     `.peaks/memory/` and was authored through the normal pipeline.
//   - `writeNewFile` — `O_EXCL` create-and-write via `openSync`. Atomic
//     with respect to other writers (no overwrite), used both for fresh
//     memory writes and (with the O_TRUNC variant inside `ranking.ts`)
//     for index.json regeneration.
// ---------------------------------------------------------------------------

import { closeSync, constants, openSync, writeFileSync } from 'node:fs';

import { containsSensitiveConfigValue } from '../../../config/config-service.js';
import type { ExtractedProjectMemory } from '../types.js';

/**
 * The names of the three checks `assertSafeMemory` can fail on, written once.
 *
 * The name of the check that fired rides the refusal message, so the reader is
 * told WHICH rule stopped the write instead of only that something was
 * refused. Callers route their remedy on these same constants (see
 * `memoryExtractNextActions` in `src/cli/commands/core/memory-command.ts`) —
 * two strings kept equal by hand is how a message and its advice drift apart.
 */
export const SENSITIVE_MEMORY_CHECKS = {
  metadataKey: 'metadata key scan',
  content: 'content scan',
  title: 'title scan'
} as const;

/** The stable prefix of every refusal this module raises on the extract path. */
const SENSITIVE_MEMORY_REFUSAL = 'Refusing to store sensitive memory content';

/**
 * Credential TERMS as they appear in prose — the word-level counterpart of the
 * config-key predicate `config-service.isSensitiveConfigPath`.
 *
 * WHY THE TITLE CHECK EXISTS AT ALL (it is not redundant with the content
 * scanner). `hasSensitiveMemoryContent` looks for a credential *value*: its
 * first pattern needs a `:` or `=`, so a title that is nothing but `apiKey`
 * carries no value and slips past it. The title scan is the only rule that can
 * see "the title IS a credential name" — so this check was kept, and only its
 * predicate was replaced.
 *
 * WHY IT DOES NOT REUSE `isSensitiveConfigPath`. That predicate answers "is
 * this a CONFIG KEY", and it answers by SUBSTRING: `includes('auth')` is true
 * for `authority`, `author`, `unauthorized`. On a config key that breadth is
 * harmless — an auth-bearing key IS a credential key, and the config domain is
 * untouched here. On a prose title it is a false refusal the author cannot see
 * the cause of: slice C0, where `peaks memory extract` refused a memory titled
 * "Derive from the authority, never re-declare it" and told the user to
 * "remove secrets" from a memory that had none.
 *
 * HOW IT MATCHES. The title is cut into alphanumeric segments (camelCase
 * boundaries included) and a match is a CONTIGUOUS RUN of segments whose
 * concatenation is one of the terms below. Runs — not single words — are what
 * keep the credential-name spellings a substring check caught and a naive
 * word-per-word check would lose: `private_key`, `api key`, `myApiKey` and
 * `access token` all still match, while `authority`, `author`, `tokenizer`,
 * `secretary` and `credentialed` do not.
 *
 * The residual narrowing is named rather than hidden: an UNSEPARATED compound
 * with a term buried mid-word (`mysecretstuff`) no longer matches. That is the
 * same class as the false refusals above — a word containing `secret` is not a
 * credential term — and the memory body is scanned for values either way.
 *
 * The plural forms are listed explicitly instead of deriving them by stripping
 * a trailing `s` from each match: that rule would turn `secretaries` into
 * `secretarie` → `secret`, which is precisely the substring confusion this
 * predicate exists to end.
 */
const SENSITIVE_PROSE_TERMS: ReadonlySet<string> = new Set([
  'apikey',
  'apikeys',
  'accesskey',
  'accesskeys',
  'privatekey',
  'privatekeys',
  'secretkey',
  'secretkeys',
  'accesstoken',
  'accesstokens',
  'authtoken',
  'authtokens',
  'authkey',
  'authkeys',
  'refreshtoken',
  'refreshtokens',
  'token',
  'tokens',
  'secret',
  'secrets',
  'password',
  'passwords',
  'passwd',
  'bearer',
  'credential',
  'credentials'
]);

/** A lower→upper transition: the boundary between the words of `apiKey`. */
const CAMEL_CASE_BOUNDARY = /([a-z0-9])([A-Z])/g;

/** `myApiKey` → `['my', 'api', 'key']`; `private_key` → `['private', 'key']`. */
function proseSegments(text: string): string[] {
  return text
    .replace(CAMEL_CASE_BOUNDARY, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((segment) => segment.length > 0);
}

/**
 * The credential term this title contains (as a run of words), or `null`.
 *
 * Returns the MATCHED TERM rather than a boolean because the refusal message
 * names it: `title scan matched the credential term "apikey"` is actionable,
 * while "Refusing to store sensitive memory content" is what sent slice C0's
 * user looking for a secret that was not there. The returned string is a
 * dictionary word from the list above — never the title's own text, and never
 * a value — so echoing it into the error envelope cannot leak anything.
 */
export function findSensitiveMemoryTitleTerm(title: string): string | null {
  const segments = proseSegments(title);
  for (let start = 0; start < segments.length; start += 1) {
    let run = '';
    for (let end = start; end < segments.length; end += 1) {
      run += segments[end] as string;
      if (SENSITIVE_PROSE_TERMS.has(run)) return run;
    }
  }
  return null;
}

/**
 * Is this string shaped like a credential VALUE rather than like prose?
 *
 * WHY THIS EXISTS. The value-carrying patterns used to fire on the SEPARATOR
 * alone: `password:` was a match whether or not anything followed it, so a
 * memory writing `password: the field label in the form` or `myApiKey: from
 * env` was refused for describing an interface. Two documents were killed that
 * way before anyone could say which of ten rules had fired — and the rules
 * could not be tightened, because nothing in them described the VALUE.
 *
 * THE TEST, AND WHAT IT COSTS. A value is credential-shaped when it is at least
 * 5 characters AND carries a digit or one of `_ + / =`. `hunter2`,
 * `abcdef123456`, `supp3rSecret` and every base64-ish token pass;
 * `Authorization`, `the`, `from`, `abc`, `well-designed` fail. Given up
 * deliberately: an all-letter opaque run (`bearer abcdefghijklmnopq`) is no
 * longer caught, and neither is a 4-character real password. The alternative was
 * a rule that cannot tell an English word from a random string, and the
 * complaint on record is about English words. Digits are the discriminator
 * rather than `-` and `.` because hyphens and full stops belong to ordinary
 * prose; provider tokens in the wild carry digits, and the prefix-shaped
 * patterns (`ghp_`, `AKIA`, the PEM header, the JWT) keep their own length floors
 * and are untouched by this predicate.
 */
const MIN_VALUE_CHARS = 5;

function isCredentialShapedValue(value: string): boolean {
  return value.length >= MIN_VALUE_CHARS && /[0-9_+/=]/.test(value);
}

/** A placeholder names where a value will go; it is not itself a secret. */
const PLACEHOLDER_VALUE = /^[<[{(]|^(?:your|the|an|some|my|example|placeholder|todo|fake)/i;

function isPlaceholderValue(value: string): boolean {
  return (
    PLACEHOLDER_VALUE.test(value) ||
    /(?:replace|insert|provide|redact|<[a-z_]+>)/i.test(value) ||
    /^[A-Za-z]+(?:_[A-Z*]+)+$/.test(value) // API_KEY_HERE-style constant
  );
}

/**
 * One content rule: a stable id, the pattern that FINDS a candidate, and the
 * predicate that decides whether the candidate is a credential or a sentence.
 * `shaped` is absent for the six prefixes so specific that the shape question
 * does not arise.
 *
 * WHY AN ARRAY AND NOT A `||` CHAIN. `hasSensitiveMemoryContent` used to be ten
 * patterns OR-ed into one `boolean`, which made the refusal structurally unable
 * to say which rule fired: the caller could not name what it had not computed.
 * So the title path reported the matched term while the content path reported
 * `null`, and the maintainer of slice C0 changed three documents before
 * guessing it was the Bearer and `KEY=value` shapes. One function now answers
 * both questions, and the boolean is a wrapper over it.
 *
 * The `id` is from a CLOSED vocabulary and is what reaches `matchedTerm`. Never
 * the match: for most of these patterns the matched text IS the credential. The
 * ids are also spelled outside the envelope redactor's vocabulary
 * (`secret|token|password|api[-_ ]?key`), so an id survives a trip through a
 * message unchanged.
 *
 * The `g` flag is required by `matchAll`, not chosen: a non-global literal makes
 * `String.prototype.matchAll` throw.
 */
type SensitiveContentRule = {
  readonly id: string;
  readonly pattern: RegExp;
  readonly shaped?: (value: string) => boolean;
};

const SENSITIVE_CONTENT_RULES: ReadonlyArray<SensitiveContentRule> = [
  {
    id: 'credential-assignment',
    pattern:
      /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|refresh[_-]?token|secret|password|passwd|credential|token|bearer)\s*[:=]\s*([^\s,;"'`]+)/gi,
    shaped: (value) => isCredentialShapedValue(value) && !isPlaceholderValue(value)
  },
  {
    id: 'authorization-bearer-header',
    pattern: /\bauthorization\s*:\s*bearer\s+([^\s,;"'`]+)/gi,
    shaped: (value) => isCredentialShapedValue(value) && !isPlaceholderValue(value)
  },
  {
    id: 'bearer-value',
    pattern: /\bbearer\s+([A-Za-z0-9._~+/=-]{8,})/gi,
    shaped: (value) => isCredentialShapedValue(value) && !isPlaceholderValue(value)
  },
  {
    id: 'sk-prefixed-key',
    // The SUFFIX is captured, not the whole `sk-…`: `sk-abcdef is the prefix`
    // is a sentence about the scheme, and the shape test on the suffix is what
    // tells it from `sk-abcdef1234567890`.
    pattern: /\bsk-([A-Za-z0-9_-]{6,})\b/g,
    shaped: (value) => isCredentialShapedValue(value) && !isPlaceholderValue(value)
  },
  { id: 'gh-prefixed-key', pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
  { id: 'github-pat', pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'glpat-prefixed-key', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'akia-prefixed-key', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'pem-private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'jwt-shaped-value', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g }
];

/**
 * Which content rule refused this text — the id, never the match. A rule whose
 * candidate fails `shaped` does not stop the scan: a later rule may still fire,
 * exactly as a later alternative in the old `||` chain would have.
 */
export function findSensitiveMemoryContentRule(content: string): string | null {
  for (const rule of SENSITIVE_CONTENT_RULES) {
    for (const match of content.matchAll(rule.pattern)) {
      const candidate = match[1] ?? match[0];
      if (rule.shaped === undefined || rule.shaped(candidate)) return rule.id;
    }
  }
  return null;
}

export function hasSensitiveMemoryContent(content: string): boolean {
  return findSensitiveMemoryContentRule(content) !== null;
}

/**
 * The refusal `assertSafeMemory` raises: the check that fired and the term it
 * matched travel as DATA, not only as prose.
 *
 * WHY A TYPE RATHER THAN A MESSAGE. The envelope redactor behind every
 * `fail()` (`packages/peaks-loop-shared/src/result.ts`) strips the words
 * secret / token / password / api-key out of every failure MESSAGE — a blanket
 * rule, applied to messages this module does not own. So a message that names
 * the matched term reaches the CLI reading `… the credential term
 * "[redacted]" …`: the term is named, and then removed, on the way out.
 *
 * The term is a word from `SENSITIVE_PROSE_TERMS` — a fixed vocabulary, never a
 * value — so there is nothing about it to redact, and it rides a field
 * instead: `fail()` redacts `message` only. The CLI routes its remedy on
 * `check` for the same reason — a substring test against a message whose words
 * can be rewritten is not a routing rule, it is a guess.
 *
 * NOTHING HERE WEAKENS THE REDACTOR. Both scans put a NAME in this field, never
 * a match: the title term comes from `SENSITIVE_PROSE_TERMS` and the content
 * value from the closed id list in `SENSITIVE_CONTENT_RULES`, so no credential
 * can reach an envelope through it. The redactor's guarantee over `message` is
 * intact and is pinned by the cases in
 * `tests/unit/services/memory/memory-title-sensitive-scan.test.ts`.
 */
export class UnsafeMemoryError extends Error {
  /** One of `SENSITIVE_MEMORY_CHECKS` — which rule refused the write. */
  readonly check: string;
  /**
   * WHAT matched, as a name rather than a value: the credential term for the
   * title scan, the rule id for the content scan, `null` only for the metadata
   * key scan (whose predicate answers by a config-key vocabulary the memory
   * metadata never contains — see the note on `assertSafeMemory`).
   *
   * It is never the match itself: for most content patterns the match IS the
   * credential (`ghp_…`, the PEM header, the JWT), which is why their messages
   * describe the pattern family and never echo the text.
   */
  readonly matchedTerm: string | null;

  constructor(check: string, detail: string, matchedTerm: string | null = null) {
    super(`${SENSITIVE_MEMORY_REFUSAL}: ${check} ${detail}.`);
    this.name = 'UnsafeMemoryError';
    this.check = check;
    this.matchedTerm = matchedTerm;
  }
}

export function assertSafeMemory(memory: ExtractedProjectMemory): void {
  const content = `${memory.title}\n${memory.kind}\n${memory.body}`;
  const metadata = { title: memory.title, kind: memory.kind, body: memory.body };
  if (containsSensitiveConfigValue(metadata)) {
    throw new UnsafeMemoryError(
      SENSITIVE_MEMORY_CHECKS.metadataKey,
      'matched a credential key in the memory metadata'
    );
  }
  const contentRule = findSensitiveMemoryContentRule(content);
  if (contentRule !== null) {
    // The matched TEXT is deliberately NOT echoed, in the message or in the
    // error's fields: for most of these patterns the match IS the credential, so
    // copying it would write the value this scan exists to keep out.
    //
    // The RULE ID is echoed, and it is echoed in `matchedTerm` rather than only
    // in prose. This used to be the one refusal that could not say what fired:
    // the predicate returned a boolean, so the caller had no match to report and
    // `matchedTerm` was `null` by construction while the title scan named its
    // term. A reader then had to guess across documents which of ten shapes had
    // refused them. An id from a closed vocabulary leaks nothing and answers the
    // question, so the two paths are diagnosable the same way.
    //
    // The DETAIL is worded around the envelope redactor's vocabulary on
    // purpose. Its catch-all (`/(secret|token|password|api[-_ ]?key)/gi`)
    // rewrites those four words wherever they appear in a failure message, so
    // naming the pattern families in their own words arrives on the CLI as
    // "an [redacted] / [redacted] / [redacted] assignment" — a remedy sentence
    // redacted into uselessness by the very policy it agrees with. The rule ids
    // above are spelled to survive that pass.
    throw new UnsafeMemoryError(
      SENSITIVE_MEMORY_CHECKS.content,
      `matched the credential pattern "${contentRule}" in the memory content`,
      contentRule
    );
  }
  const titleTerm = findSensitiveMemoryTitleTerm(memory.title);
  if (titleTerm !== null) {
    throw new UnsafeMemoryError(
      SENSITIVE_MEMORY_CHECKS.title,
      `matched the credential term "${titleTerm}" in memory.title`,
      titleTerm
    );
  }
}

export function assertSafeMemoryFileContent(content: string): void {
  const rule = findSensitiveMemoryContentRule(content);
  if (rule !== null) {
    // The id travels here too. This path has no `UnsafeMemoryError` (it is not
    // the extract gate, and its callers do not route on `check`), but a backup
    // refusal that cannot say which shape fired is the same dead end as the one
    // the extract path used to be.
    throw new Error(`Refusing to back up sensitive memory content (rule: ${rule})`);
  }
}

export function writeNewFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}
