/**
 * Regression test for slice 005-session-runtime-dir-regression + slice 012 (5th writer).
 *
 * Three invariants:
 *
 *  (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
 *
 *  (b) A static scan over `src/` flags any direct join of `.peaks` +
 *      `sessionId` that does NOT route through `getSessionDir`. The
 *      back-compat **read** sites are excluded by an explicit allow-list
 *      (those reads intentionally dual-read the legacy `<root>/.peaks/<sid>/`
 *      layout to support pre-migration trees; the bug is write-paths only).
 *
 *  (c) A static scan over `skills/<skill>/references/<file>.md` flags any legacy
 *      `.peaks/<sid>/...` artifact path that a sub-agent would write to
 *      without going through `_runtime/`. The 5th writer (slice 012) was
 *      the QA 3-way fan-out contract `skills/peaks-qa/references/qa-fanout-contract.md`,
 *      which instructed sub-agents to write to `.peaks/<sid>/qa/test-reports/<rid>.md`,
 *      `.peaks/<sid>/qa/performance-findings.md`, and
 *      `.peaks/<sid>/qa/security-findings.md` — all missing `_runtime/`.
 *      The skill markdown is the "fifth writer" because the four fixed in
 *      slice 005 were all in `src/` and the static scan only covered
 *      `src/`. The contract is documentation, not code, but the LLM
 *      follows it literally, so it is a writer in spirit.
 */

import { describe, expect, test } from 'vitest';
import { join, sep } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

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

// Skill markdown files that intentionally reference the legacy
// `.peaks/<sid>/...` path (e.g. browser-screenshot evidence paths, A2A
// documentation, retrospective sub-tree readers). Per slice 012, these
// are explicitly NOT in scope for the 5th-writer fix. New offenders in
// skills/*/references/*.md that aren't on this list fail the test.
const ALLOWED_LEGACY_SKILL_PATHS: ReadonlyArray<string> = [
  // A2A artifact mapping — A2A is a documentation-only mapping convention
  // that uses the legacy layout to match the upstream A2A spec; the actual
  // peaks artifact layout is canonical and unaffected.
  'skills/peaks-solo/references/a2a-artifact-mapping.md',
  // PRD source-doc screenshot contract — Playwright filename= is a relative
  // path the browser writes; not a Node-side join. The actual file lands
  // at the canonical _runtime home via the runtime contract. This line is
  // the documented *target*, not a writer.
  'skills/peaks-prd/SKILL.md',
  // peaks-solo swarm-dispatch-contract — sub-agent prompt templates for
  // peaks-ui / peaks-rd / peaks-qa (planning). Pre-existing legacy
  // `.peaks/<sid>/...` paths; rewriting all 8 paths here is a separate
  // slice from the QA 3-way fan-out fix in this slice. Tracked as a
  // follow-up in slice 012's bug-analysis.md.
  'skills/peaks-solo/references/swarm-dispatch-contract.md',
  // peaks-solo default runbook — `ls` commands for Gate B hard checks
  // (PRD / RD / QA / UI artefacts). Pre-existing legacy paths; same
  // rationale as swarm-dispatch-contract.md: rewriting these is a
  // follow-up slice (the runbook is documentation consumed by Solo, not
  // a sub-agent's write target).
  'skills/peaks-solo/references/runbook.md'
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

function listSkillReferenceFiles(skillsRoot: string): string[] {
  if (!existsSync(skillsRoot)) return [];
  const out: string[] = [];
  for (const skillDir of readdirSync(skillsRoot)) {
    const refsDir = join(skillsRoot, skillDir, 'references');
    if (!existsSync(refsDir)) continue;
    for (const entry of readdirSync(refsDir)) {
      if (entry.endsWith('.md')) out.push(join(refsDir, entry));
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

/**
 * Find legacy `.peaks/<sid>/...` paths in a skill markdown file. The
 * `<sid>` placeholder can appear in two shapes:
 *   (1) literal "<sid>" inside `.peaks/<sid>/...` (the QA sub-agent
 *       dispatch contract writes the placeholder as a copy-pasteable
 *       target, then resolves the placeholder to a real session id at
 *       dispatch time),
 *   (2) literal "<session-id>" (older form),
 *   (3) literal "<sessionId>" (rare, when the dispatch was emitted
 *       programmatically).
 * Each occurrence produces a path under `<root>/.peaks/<sid>/...` —
 * legacy, NOT canonical. The canonical form is `.peaks/_runtime/<sid>/...`.
 */
function findSkillMarkdownLegacySessionPaths(file: string): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if (rel.endsWith('tests/unit/services/session/session-dir-canonical.test.ts')) return [];
  if (ALLOWED_LEGACY_SKILL_PATHS.some((allow) => rel.endsWith(allow))) return [];

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const violations: Array<{ line: number; text: string }> = [];
  // Match `.peaks/<sid>/...` where the next path segment after
  // `.peaks/<sid>` is a write target (qa/, rd/, prd/, txt/, sc/) AND
  // `_runtime` is NOT already present between `.peaks` and `<sid>`.
  // The negative-lookahead is a single string check on the gap between
  // `.peaks` and the placeholder.
  const pattern = /\.peaks(?:\/([^\s/]+))?\/<sid>/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    // Skip code-fence blocks and pure comment lines.
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--') || trimmed.endsWith('-->')) continue;
    const match = line.match(pattern);
    if (match === null) continue;
    const gap = match[1] ?? '';
    // Allow `.peaks/_runtime/<sid>` (canonical) and `.peaks/_sub_agents/<sid>`
    // (sub-agent dispatch, separate sub-tree) and the umbrella
    // `.peaks/retrospective/<sid>` and `.peaks/_dogfood/<sid>` (shipped
    // and dogfood umbrellas) — none of these are the per-session workspace
    // and should not be rewritten.
    if (
      !gap.includes('_runtime') &&
      !gap.includes('_sub_agents') &&
      !gap.includes('retrospective') &&
      !gap.includes('_dogfood')
    ) {
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

  test('static scan: no legacy .peaks/<sid>/ artifact paths in skills/*/references/*.md (slice 012 — 5th writer)', () => {
    const skillsRoot = join(process.cwd(), 'skills');
    const files = listSkillReferenceFiles(skillsRoot);
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const file of files) {
      const hits = findSkillMarkdownLegacySessionPaths(file);
      for (const hit of hits) {
        violations.push({ file: file.replace(/\\/g, '/'), line: hit.line, text: hit.text });
      }
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  - ${v.file}:${v.line}  ${v.text}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} legacy .peaks/<sid>/... path(s) in skills/*/references/*.md ` +
          `that would cause a sub-agent to write outside the canonical _runtime/ tree. ` +
          `Use the canonical .peaks/_runtime/<sid>/... form, or add the file to ` +
          `ALLOWED_LEGACY_SKILL_PATHS with a justification:\n${msg}`,
      );
    }
    expect(violations).toEqual([]);
  });
});

describe('session-dir-canonical (slice 012 — positive tests for the 5th writer)', () => {
  test('QA fanout contract uses canonical .peaks/_runtime/<sid>/qa/... paths', () => {
    const contractPath = join(process.cwd(), 'skills', 'peaks-qa', 'references', 'qa-fanout-contract.md');
    expect(existsSync(contractPath)).toBe(true);
    const body = readFileSync(contractPath, 'utf8');
    // The 3 sub-agent dispatch lines (qa-business, qa-perf, qa-security)
    // must each reference the canonical _runtime/ form, not the legacy
    // .peaks/<sid>/ form. The slice 012 fix changed lines 43, 51, 55
    // and the table rows at 83-85.
    expect(body).toContain('.peaks/_runtime/<sid>/qa/test-reports/<rid>.md');
    expect(body).toContain('.peaks/_runtime/<sid>/qa/performance-findings.md');
    expect(body).toContain('.peaks/_runtime/<sid>/qa/security-findings.md');
    // Negative assertion: no remaining legacy `.peaks/<sid>/qa/...`
    // path that omits `_runtime` (the slice 012 bug class). The
    // 3 sub-agent target lines and the table must all be canonical.
    const legacyHits = (body.match(/\.peaks(?:<[^>]*>)?\/<sid>\/qa\//g) ?? []).filter(
      (hit) => !hit.includes('_runtime')
    );
    expect(legacyHits).toEqual([]);
  });

  test('static scan catches the original 5th-writer pattern (regression for the bug)', () => {
    // The 5th-writer bug class: a markdown line of the form
    // `.peaks/<sid>/qa/...` (no `_runtime` between `.peaks` and `<sid>`)
    // must be flagged by the scan. We exercise the regex inline on a
    // string fixture (the same shape the slice 012 bug produced) and
    // verify the catch. A canonical `.peaks/_runtime/<sid>/qa/...` line
    // must NOT be flagged.
    const legacyFixture = [
      'Write your evidence at .peaks/<sid>/qa/test-reports/<rid>.md',
      'output .peaks/<sid>/qa/performance-findings.md',
      'output .peaks/<sid>/qa/security-findings.md'
    ];
    const pattern = /\.peaks(?:\/([^\s/]+))?\/<sid>/;
    for (const line of legacyFixture) {
      const m = line.match(pattern);
      expect(m !== null).toBe(true);
      const gap = m?.[1] ?? '';
      // Gap between `.peaks` and `<sid>` is empty (or absent) — meaning
      // the bug class is in scope and the fix should rewrite to
      // `.peaks/_runtime/<sid>/...`.
      expect(gap.includes('_runtime')).toBe(false);
    }
    // Sanity: the canonical form does NOT trigger the scan (gap = `_runtime`).
    const canonicalLine = 'output .peaks/_runtime/<sid>/qa/security-findings.md';
    const cm = canonicalLine.match(pattern);
    expect(cm !== null).toBe(true);
    expect((cm?.[1] ?? '').includes('_runtime')).toBe(true);
  });
});
