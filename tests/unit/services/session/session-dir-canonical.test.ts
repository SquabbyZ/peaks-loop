/**
 * Regression test for slice 005-session-runtime-dir-regression.
 *
 * Two invariants:
 *
 *  (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
 *
 *  (b) A static scan over `src/` flags any direct join of `.peaks` +
 *      `sessionId` that does NOT route through `getSessionDir`. The
 *      back-compat **read** sites are excluded by an explicit allow-list
 *      (those reads intentionally dual-read the legacy `<root>/.peaks/<sid>/`
 *      layout to support pre-migration trees; the bug is write-paths only).
 */

import { describe, expect, test } from 'vitest';
import { join, sep } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

import { getSessionDir } from '../../../../src/services/session/getSessionDir.js';

// Back-compat READ paths that intentionally dual-read the legacy
// `<root>/.peaks/<sid>/` layout. Per slice 005 PRD, these are NOT in scope
// for this fix. Format: "<rel-path>:<line>". The list is a defense-in-depth
// allow-list: if a new suspect appears in `src/` that isn't on this list,
// the test fails and the new suspect must be either (a) routed through
// `getSessionDir` for writes, or (b) added to this allow-list with a
// comment explaining why the legacy path is intentional.
const ALLOWED_LEGACY_READ_PATHS: ReadonlyArray<string> = [
  // request-artifact-service.ts: legacyDir fallback for pre-migration trees
  'src/services/artifacts/request-artifact-service.ts',
  // artifact-prerequisites.ts: legacy back-compat read for old workspaces
  'src/services/artifacts/artifact-prerequisites.ts',
  // sc-service.ts: retrospective / _dogfood roots are separate trees
  'src/services/sc/sc-service.ts',
];

function listSrcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listSrcFiles(full));
    } else if (/\.(ts|mjs|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function findSessionDirJoinViolations(file: string): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  // Skip the resolver itself (it IS the canonical join)
  if (rel.endsWith('src/services/session/getSessionDir.ts')) return [];
  // Skip the test file (it intentionally references the legacy pattern in a comment / allow-list)
  if (rel.endsWith('tests/unit/services/session/session-dir-canonical.test.ts')) return [];
  if (ALLOWED_LEGACY_READ_PATHS.some((allow) => rel.endsWith(allow))) return [];

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const violations: Array<{ line: number; text: string }> = [];
  // Pattern: `join(<...>.peaks<...>, sessionId)` where the join chain
  // between `.peaks` and `sessionId` does NOT include `_runtime` (the
  // canonical sub-segment) and does NOT include `_sub_agents` (the
  // sub-agent dispatch sub-tree, which is a separate layout, not the
  // per-session workspace). This catches the regression: writers that
  // produce `<root>/.peaks/<sid>/...` (legacy) instead of
  // `<root>/.peaks/_runtime/<sid>/...` (canonical).
  //
  // The negative-lookahead is a single string check on the gap between
  // `.peaks` and the sessionId argument. This correctly excludes
  // (a) the canonical `join(root, '.peaks', '_runtime', sid)` in
  //     `session-manager.ts:532` and `request-artifact-service.ts:391`,
  // (b) the sub-agent dir writer `join(root, '.peaks', '_sub_agents', sid)`
  //     in `leak-detector.ts:36` and `cancel-handler.ts:42` (different
  //     sub-tree, not the per-session workspace).
  // The resolver file is excluded above; the allow-list excludes the
  // intentional back-compat read sites.
  const joinPattern = /join\([^)]*\.peaks[^)]*?,\s*(sessionId|meta\.sessionId)\s*\)/;
  // Template literal: `` `.peaks/${...sessionId...}` `` — same intent,
  // produces `<root>/.peaks/<sid>/...`.
  const templatePattern = /`\.peaks\/\$\{[^}]*sessionId[^}]*\}`/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip comment-only lines (e.g. back-compat explanatory comments).
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    if (joinPattern.test(line)) {
      // Exclude joins whose chain (between `.peaks` and `sessionId`)
      // contains `_runtime` (canonical) or `_sub_agents` (sub-agent
      // dispatch sub-tree, separate layout — not the per-session
      // workspace).
      const between = line.match(/join\([^)]*\.peaks([^)]*?),\s*(sessionId|meta\.sessionId)\s*\)/);
      const gap = between?.[1] ?? '';
      if (!gap.includes('_runtime') && !gap.includes('_sub_agents')) {
        violations.push({ line: i + 1, text: line.trim() });
      }
    } else if (templatePattern.test(line)) {
      violations.push({ line: i + 1, text: line.trim() });
    }
  }
  return violations;
}

describe('session-dir-canonical (slice 005)', () => {
  test('getSessionDir returns the canonical .peaks/_runtime/<sid> path', () => {
    const root = '/tmp/example';
    const sid = '2026-06-06-session-5b1095';
    const expected = join(root, '.peaks', '_runtime', sid);
    expect(getSessionDir(root, sid)).toBe(expected);
  });

  test('getSessionDir preserves any projectRoot shape (relative or absolute)', () => {
    const root = join(sep, 'repo', 'project');
    const sid = '2026-05-26-session-a3f8b1';
    expect(getSessionDir(root, sid)).toBe(join(root, '.peaks', '_runtime', sid));
  });

  test('static scan: no direct .peaks + sessionId join in src/ outside the resolver and allow-list', () => {
    const srcDir = join(process.cwd(), 'src');
    const files = listSrcFiles(srcDir);
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const hits = findSessionDirJoinViolations(file);
      for (const hit of hits) {
        violations.push({ file: file.replace(/\\/g, '/'), line: hit.line, text: hit.text });
      }
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  - ${v.file}:${v.line}  ${v.text}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} session-dir join(s) in src/ that bypass the canonical resolver. ` +
          `Route writes through getSessionDir() (src/services/session/getSessionDir.ts) or add the read site ` +
          `to the ALLOWED_LEGACY_READ_PATHS allow-list with a justification:\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
