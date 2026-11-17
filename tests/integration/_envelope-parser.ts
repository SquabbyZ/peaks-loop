/**
 * Parsing a CLI envelope out of a spawned process's output, for integration
 * tests that run the real binary and read what it printed.
 *
 * WHY THIS IS A MODULE. Two e2e suites carried their own copy of this, and both
 * carried the same defect — `stdout + stderr` as a parse candidate, and a
 * `slice(indexOf('{'))` that ran to the END of the stream. Each was ~40 lines of
 * non-obvious brace-walking that pushed its test file over the 500-line cap.
 * One copy, tested once, is the fix for all three problems.
 *
 * WHAT THE OUTPUT ACTUALLY LOOKS LIKE (measured 2026-11-17):
 *
 *   error: required option '--path <file>' not specified     ← commander, stderr
 *   { "ok": false, "command": "...", ... }                   ← the envelope
 *   (node:24436) ExperimentalWarning: SQLite is an...        ← NODE, stderr
 *
 * Three things follow, and each one broke a naive parser:
 *   1. The envelope may be on STDERR, not stdout.
 *   2. It may be preceded by commander's `error: ...` line.
 *   3. It may be FOLLOWED by Node's own runtime warnings, which the CLI does not
 *      emit and cannot suppress. Slicing to end-of-stream therefore fails with
 *      "Unexpected non-whitespace character after JSON" — and whether that
 *      warning appears depends on whether the process loaded `node:sqlite`,
 *      which is why the same test passed on CI and failed on a workstation.
 */

/** The minimal shape every `peaks --json` failure envelope carries. */
export type CliEnvelope = {
  readonly ok: boolean;
  readonly command: string;
  readonly code?: string;
  readonly message?: string;
  readonly data: unknown;
  readonly warnings: readonly unknown[];
  readonly nextActions: readonly string[];
};

/** What a spawn returned, as far as this module cares. */
export type SpawnedOutput = {
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * The first complete JSON object in `text`, from its opening brace to the brace
 * that closes it — respecting strings and escapes.
 *
 * Depth-counting rather than "last `}`": an envelope's own string values may
 * contain braces, and the trailing Node warning contains no braces at all but
 * would still be included by an end-of-stream slice.
 */
export function firstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * The envelope from either stream.
 *
 * Each stream is parsed ON ITS OWN. A concatenation of two streams is not a
 * document — it hides which stream carried the envelope when the parse fails,
 * and it is how the original defect produced an error that named neither.
 */
export function parseCliEnvelope(result: SpawnedOutput): CliEnvelope {
  let lastError: unknown = null;
  for (const raw of [result.stdout, result.stderr]) {
    if (!raw.trim()) continue;
    const json = firstJsonObject(raw);
    if (json === null) continue;
    try {
      return JSON.parse(json) as CliEnvelope;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw (
    lastError ??
    new Error(
      'parseCliEnvelope: no JSON envelope in stdout or stderr. The streams are parsed ' +
        'separately on purpose; a concatenation would not be a document.'
    )
  );
}
