/**
 * Slice 2026-06-22-top-level-change-id-cleanup — defense test for the
 * `.peaks/<YYYY-MM-DD-*>/` rule.
 *
 * Background: peaks-cli 2.8.0+ requires change-id / session-id artifacts
 * to live under `.peaks/_runtime/<sessionId>/` (gitignored) — NOT as
 * siblings at `.peaks/<date-prefix>/`. A 2.8.0-era install left a stale
 * `.peaks/2026-06-22-cc-connect-orphan-cleanup/` directory at the
 * working-tree top level; the same root `.gitignore` was hardened with
 * a YYYY-MM-DD-prefix fnmatch pattern (see DEFENSE_RULE below) to
 * prevent recurrence. This test pins that defense.
 *
 * ACs:
 *   1. root `.gitignore` contains the YYYY-MM-DD-prefix defensive rule
 *   2. the rule's fnmatch pattern matches a synthetic candidate path
 *   3. the rule's fnmatch pattern does NOT match entries under
 *      `.peaks/_runtime/` (so legitimate session-id dirs are still ignored
 *      via the existing `.peaks/_runtime/` rule, NOT this one)
 *   4. working tree contains no orphan top-level date-prefixed `.peaks/`
 *      directories at the moment the suite runs (catches regressions
 *      if the rule is silently dropped)
 *
 * No fixtures, no mocks — pure fs + fs-of-gitignore + readFileSync. The
 * test is hermetic against the live working tree and git binary.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const PEAKS_DIR = join(REPO_ROOT, '.peaks');
const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');

/**
 * The defensive rule added in slice 2026-06-22-top-level-change-id-cleanup.
 * If this literal substring is removed from `.gitignore`, the test fails.
 */
const DEFENSE_RULE = '.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/';

function isDatePrefixedSegment(seg: string): boolean {
  // Mirrors the fnmatch pattern: YYYY-MM-DD-*
  return /^\d{4}-\d{2}-\d{2}-/.test(seg);
}

describe('top-level change-id guard (slice 2026-06-22-top-level-change-id-cleanup)', () => {
  test('AC1: root .gitignore contains the YYYY-MM-DD-prefix defensive rule', () => {
    expect(existsSync(GITIGNORE_PATH)).toBe(true);
    const content = readFileSync(GITIGNORE_PATH, 'utf8');
    // Allow trailing comment / whitespace, but the rule literal must appear
    expect(content).toContain(DEFENSE_RULE);
  });

  test('AC2: the rule\'s fnmatch pattern ignores a synthetic candidate path', () => {
    // git check-ignore exits 0 when the path IS ignored, 1 when not.
    const candidate = '.peaks/2026-06-22-fake-test-dir/rd/foo.md';
    const result = execFileSync(
      'git',
      ['check-ignore', '-v', candidate],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    // The matched rule must be the new defense (line number is volatile
    // — just assert the pattern literal appears in the trace output).
    expect(result).toContain(DEFENSE_RULE);
  });

  test('AC3: the rule\'s fnmatch pattern does NOT match .peaks/_runtime/<date>/...', () => {
    // A file under .peaks/_runtime/ MUST be ignored, but by the existing
    // `.peaks/_runtime/` rule (line 9), NOT by the new defense rule.
    // We assert the trace contains `.peaks/_runtime/` and does NOT
    // contain the new YYYY-MM-DD pattern in the same trace.
    const candidate = '.peaks/_runtime/2026-06-22-fake-test-session/rd/foo.md';
    const result = execFileSync(
      'git',
      ['check-ignore', '-v', candidate],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    expect(result).toContain('.peaks/_runtime/');
    expect(result).not.toContain(DEFENSE_RULE);
  });

  test('AC4: working tree contains no orphan top-level date-prefixed .peaks/ dirs', () => {
    // Walking the live filesystem catches regressions where the rule is
    // silently dropped or the working tree was hand-edited to bypass it.
    expect(existsSync(PEAKS_DIR)).toBe(true);
    const entries = readdirSync(PEAKS_DIR);
    const orphans = entries.filter((seg) => {
      if (seg.startsWith('.')) return false;
      if (!isDatePrefixedSegment(seg)) return false;
      // Defensive: must be a directory (the rule only matches directories)
      const full = join(PEAKS_DIR, seg);
      try {
        return statSync(full).isDirectory();
      } catch {
        return false;
      }
    });
    expect(orphans).toEqual([]);
  });

  test('AC4b: git ls-files also returns no top-level date-prefixed .peaks/ tracked entries', () => {
    // Belt-and-suspenders: even if a directory slipped past the working-
    // tree scan (e.g. ephemeral filter), git must not have tracked any
    // sibling date-prefix entry. Catches the "tracked-but-ignored"
    // edge case (e.g. --force-add escape hatch).
    const result = execFileSync(
      'git',
      ['ls-files', '.peaks/'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    );
    const tracked = result
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((rel) => {
        // Strip the `.peaks/` prefix and the first path segment; that
        // segment is the candidate top-level entry.
        const stripped = rel.replace(/^\.peaks\//, '');
        const firstSeg = stripped.split('/')[0] ?? '';
        return isDatePrefixedSegment(firstSeg);
      });
    expect(tracked).toEqual([]);
  });
});