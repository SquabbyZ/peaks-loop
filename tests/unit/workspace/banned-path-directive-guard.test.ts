/**
 * Slice 2026-06-24-handoff-path-canonicalization-v2 — defense test for
 * the B-class `.peaks/_runtime/<id>/` LLM/CLI directive ban.
 *
 * Background: peaks-cli 2.8.0+ routes change-id / session-id artifacts
 * under `.peaks/_runtime/<sessionId>/` (gitignored), never as siblings
 * at `.peaks/_runtime/<id>/`. After PRD1 (commit 9893d3a) shipped, a follow-up
 * audit (slice 2026-06-24 v2) found 11 B-class hits in production code
 * where the LLM/CLI was being told to write to the forbidden layout
 * — e.g. via `description(...)`, `nextActions.push(...)`, `warnings: [...]`,
 * `throw new Error(...)`, or hard-coded in `hardGates`/`requiredArtifacts`/
 * `nextActions` arrays emitted to the LLM. Each of these is a directive
 * surface: the LLM reads the string and follows it.
 *
 * This test source-greps the production directories listed in PRD AC-2.2
 * for the forbidden `.peaks/_runtime/<id>/` literal appearing inside a directive
 * context. It fails if any are found, locking the v2 fix in place.
 *
 * Design:
 *   - No mocks, no fixtures, no external services.
 *   - Walks the file tree with synchronous `readdirSync` + `statSync`
 *     (matches the convention in `top-level-change-id-guard.test.ts`).
 *   - Strips line and block comments BEFORE matching so A-class JSDoc
 *     (e.g. `src/cli/commands/workspace/init-command.ts:71-72`) does not
 *     trigger false positives.
 *   - Defines directive contexts as multi-line regexes anchored on the
 *     opening call/array. The patterns are intentionally lenient about
 *     the literal that follows `.peaks/_runtime/<id>/` (anything can follow) so
 *     a future regression in any of: description, nextActions, warnings,
 *     helpLines, recommendations, or `throw new Error` containing a
 *     write target gets caught.
 *
 * AC-2.2 patterns (see PRD1 v2 §Acceptance criteria):
 *   - `description\(\s*['"\`].*\.peaks/_runtime/<[^>]+>/`  (CLI help-text)
 *   - `nextActions.push\(\s*['"\`].*\.peaks/_runtime/<\w+>/`
 *   - `recommendations.push\(\s*['"\`].*\.peaks/_runtime/<\w+>/`
 *   - `warnings:\s*\[.*?\.peaks/_runtime/<\w+>\]
 *   - `helpLines:.*?\.peaks/_runtime/<\w+>`
 *   - any `throw new Error\(...\.peaks/_runtime/<\w+>/...\)` string-literal
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** Top-level production directories the v2 PRD enumerates. */
const TARGET_ROOTS = [
  'src/cli/commands',
  'src/services/refactor',
  'src/services/sc',
  'src/services/slice',
] as const;

const TARGET_EXTS = new Set(['.ts', '.mts', '.cts']);

/**
 * Keep-listed `.description(...)` strings. These intentionally label a
 * legacy / forbidden path so the LLM learns what to avoid, and rewriting
 * them would destroy the migration discoverability / contrast teaching.
 * The PRD (slice 2026-06-24 v2) explicitly preserves these as KEEP.
 *
 * Each entry is a (relativePath, substringThatMustBePresent) tuple. The
 * substring anchors the entry to the specific description block so a
 * future contributor editing an unrelated line doesn't accidentally
 * re-flag a removed description.
 */
const KEEP_DESCRIPTIONS: ReadonlyArray<{ file: string; anchor: string }> = [
  // migrate-1-4-1: contrast legacy `.peaks/_runtime/<sid>/` vs canonical `.peaks/_runtime/<sid>/`
  {
    file: 'src/cli/commands/migrate-1-4-1-command.ts',
    anchor: 'Move per-session files from the legacy `.peaks/_runtime/<sid>/',
  },
  // workspace/migrate: contrast legacy `.peaks/_runtime/<session-id>/` vs `.peaks/retrospective/<change-id>/`
  {
    file: 'src/cli/commands/workspace/migrate-command.ts',
    anchor: 'Migrate legacy `.peaks/_runtime/<session-id>/',
  },
  // workspace/init: contrast canonical `.peaks/_runtime/<session-id>/` against forbidden
  // `.peaks/_runtime/<change-id>/` sibling. The description teaches the LLM the difference
  // (slice 2.8.3 top-level change-id ban). Removing the contrast destroys the
  // pedagogical value.
  {
    file: 'src/cli/commands/workspace/init-command.ts',
    anchor: 'NOT a sibling dir at .peaks/_runtime/<change-id>/',
  },
  // workflow/verify-pipeline: document the canonical look-up location
  // (slice 2026-06-28-solo-mode-bypass-fix defect #3). The literal
  // `.peaks/_runtime/change/<sessionId>/` is the CANONICAL shape (under
  // `.peaks/_runtime/`), NOT the banned sibling form, but the directive
  // pattern matches any `<...>`-bracketed path so we keep-list the
  // description explicitly.
  {
    file: 'src/cli/commands/workflow-commands.ts',
    anchor: 'Scans `.peaks/_runtime/change/<sessionId>/`',
  },
];

/**
 * Recursively walk a directory and yield absolute file paths that match
 * the target extensions. Mirrors the style used in
 * `top-level-change-id-guard.test.ts` (synchronous fs, no third-party
 * glob library — `fast-glob` is not a runtime dep).
 */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(full, out);
    } else if (s.isFile() && TARGET_EXTS.has(extname(name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip line and block comments from source so JSDoc / explanatory
 * comments do not trip the directive patterns. Heuristic-only — we
 * do not need a full TS parser; we just need the strings the runtime
 * sees.
 */
function stripComments(src: string): string {
  // Block comments: /* ... */ (non-greedy, multi-line)
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Line comments: // ... to end-of-line. Skip if preceded by `://`
  // (URLs) — we use a conservative match: `//` not preceded by `:`.
  out = out.replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  return out;
}

/**
 * Directive-context patterns. Each must return ZERO matches against
 * the comment-stripped production code.
 */
const DIRECTIVE_PATTERNS: ReadonlyArray<{ label: string; regex: RegExp }> = [
  {
    label: 'description(...) help-text',
    regex: /\.description\(\s*['"`][^'"]*\.peaks\/<[^>]+>\//,
  },
  {
    label: 'nextActions.push(...) directive',
    regex: /nextActions\.push\(\s*['"`][^'"]*\.peaks\/<\w+>\//,
  },
  {
    label: 'recommendations.push(...) directive',
    regex: /recommendations\.push\(\s*['"`][^'"]*\.peaks\/<\w+>\//,
  },
  {
    label: 'warnings: [...] array entry',
    regex: /warnings\s*:\s*\[[^\]]*\.peaks\/<\w+>[\s\]]/,
  },
  {
    label: 'helpLines directive line',
    regex: /helpLines\s*:[^]*?\.peaks\/<\w+>/,
  },
  {
    label: 'throw new Error(...) string literal',
    regex: /throw\s+new\s+Error\([^)]*\.peaks\/<\w+>\//,
  },
  {
    label: 'hardGates / requiredArtifacts / nextActions array literal',
    // Catches entries like: 'Retain ... in .peaks/_runtime/<session-id>/ storage ...'
    // inside array literals emitted to the LLM.
    regex: /'(?:Retain|Keep|Create|Discover|Paste|Open|Save)[^']*\.peaks\/<\w+>\/[^']*'/,
  },
];

describe('B-class banned-path directive guard (slice 2026-06-24 v2)', () => {
  test('AC-2.2: zero .peaks/_runtime/<id>/ literals inside LLM/CLI directive contexts in production code', () => {
    const files: string[] = [];
    for (const root of TARGET_ROOTS) {
      const abs = join(REPO_ROOT, root);
      walk(abs, files);
    }
    // Sanity: ensure the walk actually found files (catches a typo
    // in TARGET_ROOTS that would silently make the test vacuously pass).
    expect(files.length).toBeGreaterThan(10);

    const violations: string[] = [];
    for (const file of files) {
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const stripped = stripComments(src);
      // Normalize to forward-slash so keep-list (which uses `/`) matches
      // on Windows (where `relative()` returns `\\`-separated paths).
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');
      // Build a quick lookup of keep-listed descriptions for this file.
      const fileKeepList = KEEP_DESCRIPTIONS.filter((k) => k.file === rel);
      for (const { label, regex } of DIRECTIVE_PATTERNS) {
        regex.lastIndex = 0;
        // Use matchAll so a single file can have multiple violations
        // of the same directive pattern.
        const matches = [...stripped.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g'))];
        for (const m of matches) {
          // For the description(...) pattern, check if the matched
          // substring falls inside a keep-listed description anchor.
          // Keep-listed descriptions are the only place where
          // `.peaks/_runtime/<id>/` may legitimately appear inside a directive
          // (they explicitly label the path as legacy or forbidden).
          if (label === 'description(...) help-text') {
            const isKeep = fileKeepList.some((k) => stripped.includes(k.anchor));
            if (isKeep) continue;
          }
          // Truncate the matched string for readable test failure output.
          const preview = m[0].slice(0, 100).replace(/\n/g, '\\n');
          violations.push(`${rel} [${label}]: ${preview}`);
        }
      }
    }

    if (violations.length > 0) {
      // Use expect so vitest prints the diff nicely.
      expect(violations).toEqual([]);
    }
  });

  /**
   * Slice 2026-06-24-handoff-path-canonicalization-v3 — extend the guard
   * to skills md files. The earlier sweep classified all 116 matches as
   * "correctly axis-labeled" or "A-class", but in practice the LLM treats
   * paths inside backtick / code-fence / bash-block contexts in skills/
   * as operational directives — copying them into Bash / Playwright
   * `browser_take_screenshot filename=...` / grep calls verbatim. Only
   * prose with axis labels (`<session-id>`, `<sessionId>`, etc.) and
   * explicit FORBIDDEN / 2.8.3 hard-ban prose is safe to leave alone.
   *
   * Scope:
   *   - Skills files: skills all-md (excluding tests/fixtures/skills/pre-slim subdir)
   *   - Banned: literal `.peaks/_runtime/<id>/`, `.peaks/_runtime/<sid>/`, `.peaks/_runtime/<session-id>/`
   *     inside markdown triple-backtick code fences OR inside backtick spans
   *     acting as path tokens. Bare axis labels that include `<session-id>`,
   *     `<sessionId>`, `<sessionId>`, `<sid>`, `<rid>` (rid is a request id
   *     token, not a directory name) are allowed.
   *   - Allowed: prose explaining the rule, prose that says NEVER / FORBIDDEN /
   *     banned 2.8.3 (the canonical hard-ban prose stays).
   *
   * Implementation note:
   *   - We extract every markdown triple-backtick code fence body and assert
   *     that no banned pattern appears inside.
   *   - We also extract every inline backtick span and assert the same.
   *   - The axis-label exception (`<session-id>` / `<sessionId>` / `<sid>` /
   *     `<sessionId>`) means the regex is precise: it only flags bare
   *     `<id>`, `<X>` (single-letter placeholder for id), and patterns that
   *     lack any axis label.
   */
  test('v3 AC: skills all-md must not contain `.peaks/_runtime/<id>/` inside code fences or path backtick spans', () => {
    const skillsRoot = join(REPO_ROOT, 'skills');
    const mdFiles: string[] = [];
    // Skills files are markdown, not TS — reuse the synchronous walk
    // pattern but accept .md instead of the production TARGET_EXTS set.
    const walkMd = (dir: string, out: string[] = []): string[] => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return out;
      }
      for (const name of entries) {
        const full = join(dir, name);
        let s;
        try {
          s = statSync(full);
        } catch {
          continue;
        }
        if (s.isDirectory()) {
          walkMd(full, out);
        } else if (s.isFile() && extname(name) === '.md') {
          out.push(full);
        }
      }
      return out;
    };
    walkMd(skillsRoot, mdFiles);

    // The pre-slim fixture baseline is OFF LIMITS (those are the slim-
    // evidence snapshots that intentionally retain the legacy literal).
    const filtered = mdFiles.filter((f) => {
      const rel = relative(REPO_ROOT, f).replace(/\\/g, '/');
      return !rel.startsWith('tests/fixtures/skills/pre-slim/');
    });

    expect(filtered.length).toBeGreaterThan(5);

    // The B-class regexes target paths that an LLM would copy into a
    // tool call verbatim. Allow only the proper axis labels:
    // `<session-id>`, `<sessionId>`, `<change-id>`, `<sessionId>`,
    // `<sid>`, plus a wildcard `<X>` placeholder (used in canonical axes
    // explanation prose like "every `.peaks/_runtime/<X>/` has an axis label")
    // and the date-prefix placeholder `<YYYY-MM-DD-*>` (the 2.8.3 hard-ban
    // pattern). Bare `<id>` is BANNED.
    //
    // Pattern matches:
    //   .peaks/_runtime/<id>/   (literally)
    // And EXCLUDES:
    //   .peaks/_runtime/<session-id>/
    //   .peaks/_runtime/<sid>/
    //   .peaks/_runtime/<sessionId>/
    //   .peaks/_runtime/<change-id>/
    //   .peaks/_runtime/<sessionId>/
    //   .peaks/_runtime/<X>/     (canonical "any axis" placeholder)
    //   .peaks/_runtime/<YYYY-MM-DD-*>/  (date-prefix hard-ban placeholder)
    const BANNED_PATH = /\.peaks\/<(?!session-id>|sid>|sessionId>|change-id>|sessionId>|X>|YYYY-MM-DD-\*>)([^>]+)>\//g;

    const violations: string[] = [];

    for (const file of filtered) {
      let src: string;
      try {
        src = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const rel = relative(REPO_ROOT, file).replace(/\\/g, '/');

      // 1. Triple-backtick code fences: extract bodies and assert
      const fenceRegex = /```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```/g;
      const fences = src.matchAll(fenceRegex);
      for (const m of fences) {
        const body = m[1] ?? '';
        BANNED_PATH.lastIndex = 0;
        for (const bm of body.matchAll(BANNED_PATH)) {
          if (bm[1] !== undefined) {
            violations.push(`${rel} [code-fence]: .peaks/_runtime/<${bm[1]}>/...`);
          }
        }
      }

      // 2. Inline backtick spans (single-line): only assert when the
      // span starts with `.peaks/`, because non-path backtick spans
      // are not directives.
      const inlineRegex = /`([^`\n]+)`/g;
      for (const im of src.matchAll(inlineRegex)) {
        const span = im[1] ?? '';
        if (!span.startsWith('.peaks/')) continue;
        BANNED_PATH.lastIndex = 0;
        const m2 = BANNED_PATH.exec(span);
        if (m2 && m2[1] !== undefined) {
          violations.push(`${rel} [inline-backtick]: ${span}`);
        }
      }
    }

    if (violations.length > 0) {
      expect(violations).toEqual([]);
    }
  });
});
