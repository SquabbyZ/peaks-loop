// ---------------------------------------------------------------------------
// Sensitive-content + write helpers for the project memory store.
//
//   - `hasSensitiveMemoryContent` — pattern check for api keys, tokens,
//     PEM private keys, JWTs, GitHub / GitLab tokens, AWS access keys. Used
//     both by the extract path (`assertSafeMemory`) and the backup path
//     (`assertSafeMemoryFileContent`).
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

export function hasSensitiveMemoryContent(content: string): boolean {
  return (
    /(?:api[_-]?key|token|secret|password|credential|bearer)\s*[:=]/i.test(content) ||
    /\bauthorization\s*:\s*bearer\s+\S+/i.test(content) ||
    /\bbearer\s+[A-Za-z0-9._~+/=-]{12,}\b/i.test(content) ||
    /\bsk-[A-Za-z0-9_-]{6,}\b/.test(content) ||
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(content) ||
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/.test(content) ||
    /\bglpat-[A-Za-z0-9_-]{20,}\b/.test(content) ||
    /\bAKIA[0-9A-Z]{16}\b/.test(content) ||
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(content) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(content)
  );
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
 * NOTHING HERE WEAKENS THE REDACTOR. The content scan never puts its match in
 * this object (see `matchedTerm` below), so no value can reach an envelope
 * through it; the redactor's guarantee is intact and is pinned by the cases in
 * `tests/unit/services/memory/memory-title-sensitive-scan.test.ts`.
 */
export class UnsafeMemoryError extends Error {
  /** One of `SENSITIVE_MEMORY_CHECKS` — which rule refused the write. */
  readonly check: string;
  /**
   * The credential term the TITLE scan matched, or `null` for the other two
   * checks. `null` is not an omission: their match can BE the credential
   * (`ghp_…`, the PEM header, the JWT), which is why their messages describe
   * the pattern family and never echo the text.
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
  if (hasSensitiveMemoryContent(content)) {
    // The match is deliberately NOT echoed, in the message or in the error's
    // fields: for most of these patterns the match IS the credential, so
    // copying it would write the value this scan exists to keep out.
    //
    // The DETAIL is worded around the envelope redactor's vocabulary on
    // purpose. Its catch-all (`/(secret|token|password|api[-_ ]?key)/gi`)
    // rewrites those four words wherever they appear in a failure message, so
    // naming the pattern families in their own words arrives on the CLI as
    // "an [redacted] / [redacted] / [redacted] assignment" — a remedy sentence
    // redacted into uselessness by the very policy it agrees with. Measured on
    // the real CLI, both wordings; this one survives intact.
    throw new UnsafeMemoryError(
      SENSITIVE_MEMORY_CHECKS.content,
      'matched a credential value in the memory content (a `key=value` credential assignment, a Bearer header, a PEM private key, a JWT, or a provider credential)'
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
  if (hasSensitiveMemoryContent(content)) {
    throw new Error('Refusing to back up sensitive memory content');
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
