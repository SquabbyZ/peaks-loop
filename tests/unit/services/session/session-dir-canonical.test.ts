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
 *      (those reads intentionally dual-read the legacy `<root>/.peaks/_runtime/<sid>/`
 *      layout to support pre-migration trees; the bug is write-paths only).
 *
 *  (c) A static scan over `skills/<skill>/references/<file>.md` flags any legacy
 *      `.peaks/_runtime/<sid>/...` artifact path that a sub-agent would write to
 *      without going through `_runtime/`. The 5th writer (slice 012) was
 *      the QA 3-way fan-out contract `skills/peaks-qa/references/qa-fanout-contract.md`,
 *      which instructed sub-agents to write to `.peaks/_runtime/<sid>/qa/test-reports/<rid>.md`,
 *      `.peaks/_runtime/<sid>/qa/performance-findings.md`, and
 *      `.peaks/_runtime/<sid>/qa/security-findings.md` — all missing `_runtime/`.
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
// `<root>/.peaks/_runtime/<sid>/` layout. Per slice 005 PRD, these are NOT in scope
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
// `.peaks/_runtime/<sid>/...` path (e.g. browser-screenshot evidence paths, A2A
// documentation, retrospective sub-tree readers). Per slice 012, these
// are explicitly NOT in scope for the 5th-writer fix. New offenders in
// skills/*/references/*.md that aren't on this list fail the test.
//
// Slice #015 removed 2 entries (swarm-dispatch-contract.md, runbook.md)
// after rewriting their legacy paths to canonical `.peaks/_runtime/<sid>/...`
// form. Two remain allow-listed with justifications:
//   - a2a-artifact-mapping.md: this is an A2A spec mapping document; the
//     A2A protocol uses `.peaks/_runtime/<artifact-id>/...` style paths as part of
//     the SPEC (not as a real filesystem path). The mapping cites the A2A
//     spec literally; rewriting the spec citations would break the
//     documentation's purpose (to map peaks onto the A2A vocabulary).
//   - peaks-prd/SKILL.md: contains Playwright MCP `filename=` URL
//     parameters (e.g. `filename=".peaks/_runtime/<sid>/prd/source/<doc>-page-<n>.png"`).
//     These are URL parameter values passed to the browser, NOT Node-side
//     file joins; the actual file lands at the canonical _runtime home
//     via the runtime contract. The pattern matches because the string
//     contains the legacy prefix, but the intent is "browser URL
//     parameter", not "writer".
const ALLOWED_LEGACY_SKILL_PATHS: ReadonlyArray<string> = [
  // A2A artifact mapping — A2A is a documentation-only mapping convention
  // that uses the legacy layout to match the upstream A2A spec; the actual
  // peaks artifact layout is canonical and unaffected.
  'skills/peaks-code/references/a2a-artifact-mapping.md',
  // PRD source-doc screenshot contract — Playwright filename= is a
  // browser URL parameter the headed browser writes; not a Node-side
  // join. The actual file lands at the canonical _runtime home via the
  // runtime contract. This line is the documented *target*, not a writer.
  'skills/peaks-prd/SKILL.md',
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
  // produce `<root>/.peaks/_runtime/<sid>/...` (legacy) instead of
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
  // Template literal: `` `.peaks/_runtime/${...sessionId...}` `` — same intent,
  // produces `<root>/.peaks/_runtime/<sid>/...`.
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
 * Find legacy `.peaks/_runtime/<sid>/...` paths in a skill markdown file. The
 * `<sid>` placeholder can appear in two shapes:
 *   (1) literal "<sid>" inside `.peaks/_runtime/<sid>/...` (the QA sub-agent
 *       dispatch contract writes the placeholder as a copy-pasteable
 *       target, then resolves the placeholder to a real session id at
 *       dispatch time),
 *   (2) literal "<session-id>" (older form),
 *   (3) literal "<sessionId>" (rare, when the dispatch was emitted
 *       programmatically).
 * Each occurrence produces a path under `<root>/.peaks/_runtime/<sid>/...` —
 * legacy, NOT canonical. The canonical form is `.peaks/_runtime/<sid>/...`.
 */
function findSkillMarkdownLegacySessionPaths(file: string): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if (rel.endsWith('tests/unit/services/session/session-dir-canonical.test.ts')) return [];
  if (ALLOWED_LEGACY_SKILL_PATHS.some((allow) => rel.endsWith(allow))) return [];

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const violations: Array<{ line: number; text: string }> = [];
  // Match `.peaks/_runtime/<sid>/...` where the next path segment after
  // `.peaks/_runtime/<sid>` is a write target (qa/, rd/, prd/, txt/, sc/) AND
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

  test('static scan: no legacy .peaks/_runtime/<sid>/ artifact paths in skills/*/references/*.md (slice 012 — 5th writer)', () => {
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
        `Found ${violations.length} legacy .peaks/_runtime/<sid>/... path(s) in skills/*/references/*.md ` +
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
    // .peaks/_runtime/<sid>/ form. The slice 012 fix changed lines 43, 51, 55
    // and the table rows at 83-85.
    expect(body).toContain('.peaks/_runtime/<sid>/qa/test-reports/<rid>.md');
    expect(body).toContain('.peaks/_runtime/<sid>/qa/performance-findings.md');
    expect(body).toContain('.peaks/_runtime/<sid>/qa/security-findings.md');
    // Negative assertion: no remaining legacy `.peaks/_runtime/<sid>/qa/...`
    // path that omits `_runtime` (the slice 012 bug class). The
    // 3 sub-agent target lines and the table must all be canonical.
    const legacyHits = (body.match(/\.peaks(?:<[^>]*>)?\/<sid>\/qa\//g) ?? []).filter(
      (hit) => !hit.includes('_runtime')
    );
    expect(legacyHits).toEqual([]);
  });

  test('static scan recognises the canonical .peaks/_runtime/<sid>/qa/... shape', () => {
    // After v5 path canonicalization, every sub-agent writer must emit
    // `.peaks/_runtime/<sid>/qa/...` (with the `_runtime/` segment).
    // The scan captures the segment between `.peaks` and `<sid>` as
    // the `gap`; for canonical lines the gap must be exactly `_runtime`.
    const canonicalFixture = [
      'Write your evidence at .peaks/_runtime/<sid>/qa/test-reports/<rid>.md',
      'output .peaks/_runtime/<sid>/qa/performance-findings.md',
      'output .peaks/_runtime/<sid>/qa/security-findings.md'
    ];
    const pattern = /\.peaks(?:\/([^\s/]+))?\/<sid>/;
    for (const line of canonicalFixture) {
      const m = line.match(pattern);
      expect(m !== null).toBe(true);
      const gap = m?.[1] ?? '';
      // Canonical form: gap between `.peaks` and `<sid>` is `_runtime`.
      expect(gap.includes('_runtime')).toBe(true);
    }
  });
});

/**
 * Slice 020 — caller-keyed session binding. A4 / A8 enforcement.
 *
 * The new per-caller layout (D6) writes per-caller files at:
 *   - `.peaks/_runtime/callers/<callerId>.json` (caller binding)
 *   - `.peaks/_runtime/<peakSid>/active-skill-<callerId>.json` (per-caller active-skill)
 *
 * The legacy single-file paths (`.peaks/_runtime/session.json`,
 * `.peaks/_runtime/active-skill.json`, `.peaks/.session.json`,
 * `.peaks/.active-skill.json`) are now READ-ONLY back-compat
 * (M1 / M4). No new code should WRITE to them; only the migration
 * shim and the back-compat readers touch them.
 *
 * This static scan walks `src/` and flags any new code that
 * constructs one of the legacy single-file paths via `join(...)` or
 * template literal. Reads via `readFileSync(legacyPath)` are
 * allowed (back-compat readers) — only writes (writeFileSync /
 * mkdirSync followed by writeFileSync) are flagged.
 */

const LEGACY_SINGLE_FILE_PATHS: ReadonlyArray<{
  /** Display name for the test report. */
  label: string;
  /** Substring of the path that uniquely identifies it. */
  pathToken: string;
}> = [
  { label: '.peaks/_runtime/session.json', pathToken: '_runtime/session.json' },
  { label: '.peaks/_runtime/active-skill.json', pathToken: '_runtime/active-skill.json' },
  { label: '.peaks/.session.json', pathToken: '.session.json' },
  { label: '.peaks/.active-skill.json', pathToken: '.active-skill.json' }
];

const ALLOWED_LEGACY_SINGLE_FILE_WRITES: ReadonlyArray<string> = [
  // session-manager.ts: writeSessionFile writes `.peaks/_runtime/session.json`.
  // This is the legacy single-file pointer; per the contract it remains
  // WRITEABLE during the migration window (so the M1 read shim has
  // something to read). A future slice should remove the write path
  // entirely.
  'src/services/session/session-manager.ts',
  // skill-presence-service.ts: setSkillPresence still writes the legacy
  // single-file active-skill marker. Same migration-window justification
  // as session-manager.ts.
  'src/services/skills/skill-presence-service.ts'
];

function findLegacySingleFileWrites(file: string): Array<{ line: number; text: string; reason: string }> {
  const rel = file.replace(/\\/g, '/');
  if (ALLOWED_LEGACY_SINGLE_FILE_WRITES.some((allow) => rel.endsWith(allow))) return [];

  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const violations: Array<{ line: number; text: string; reason: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // Detect: writeFileSync(<path> that ends with session.json / active-skill.json
    // (without `<callerId>` interpolation). The new per-caller files are
    // `active-skill-${callerId}.json` (template-literal interpolation);
    // the legacy single-file path is just `active-skill.json` or
    // `session.json` (no callerId).
    //
    // Pattern A: writeFileSync(<path>, ..., 'utf8') where <path> is a
    //            variable ending in `session.json` or `active-skill.json`
    //            and the variable name suggests it's the legacy single-file
    //            path (e.g. `presencePath`, `sessionFile`, `bindingPath`).
    const writeFsMatch = /writeFileSync\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,/.exec(line);
    if (writeFsMatch) {
      const varName = writeFsMatch[1];
      // Heuristic: the variable name contains "session", "presence",
      // "binding", or "activeSkill" AND the file's surrounding
      // function constructs a path that is NOT the per-caller form.
      // For simplicity (and to keep this scan maintainable), we look
      // for `varName.endsWith('session.json')` or
      // `varName.endsWith('active-skill.json')` in any earlier line of
      // the same function. If found AND it's NOT the per-caller
      // template (`active-skill-${...}`), flag it.
      if (
        varName !== undefined &&
        (varName.toLowerCase().includes('presence') ||
          varName.toLowerCase().includes('session') ||
          varName.toLowerCase().includes('binding') ||
          varName.toLowerCase().includes('activeskill') ||
          varName.toLowerCase().includes('skill'))
      ) {
        // Walk backwards to find the variable's source.
        for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
          const prev = lines[j] ?? '';
          // Stop at function boundaries
          if (prev.includes('function ') || prev.includes('=> {')) break;
          if (prev.includes(varName) && /['"`][^'"`]*(\.json)['"`]/.test(prev)) {
            // Is the path a per-caller form? It is if it contains a
            // template interpolation like `${callerId}` or `active-skill-${...}`.
            const isPerCaller =
              prev.includes('${callerId}') ||
              prev.includes('${peakSessionId}') ||
              prev.includes('active-skill-') ||
              prev.includes('callers/') ||
              prev.includes('callers\\');
            if (!isPerCaller) {
              violations.push({
                line: i + 1,
                text: line.trim(),
                reason: `write to legacy single-file path via ${varName} (slice 020 caller-keyed migration shim expects per-caller file)`
              });
            }
            break;
          }
        }
      }
    }
  }
  return violations;
}

describe('caller-keyed static scan (slice 020 — A4 / A8)', () => {
  test('no new code writes to the legacy single-file pointer paths', () => {
    const srcDir = join(process.cwd(), 'src');
    const files = listSrcFiles(srcDir);
    const violations: Array<{ file: string; line: number; text: string; reason: string }> = [];
    for (const file of files) {
      const hits = findLegacySingleFileWrites(file);
      for (const hit of hits) {
        violations.push({
          file: file.replace(/\\/g, '/'),
          line: hit.line,
          text: hit.text,
          reason: hit.reason
        });
      }
    }
    if (violations.length > 0) {
      const msg = violations
        .map((v) => `  - ${v.file}:${v.line}  ${v.text}\n    reason: ${v.reason}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} write(s) to legacy single-file pointer paths in src/. ` +
          `Slice 020 (caller-keyed session binding) requires new code to write per-caller files ` +
          `(.peaks/_runtime/callers/<callerId>.json or .peaks/_runtime/<peakSid>/active-skill-<callerId>.json) ` +
          `instead of the legacy single-file paths. Add the file to ALLOWED_LEGACY_SINGLE_FILE_WRITES ` +
          `with a migration-window justification, or refactor to the per-caller path:\n${msg}`
      );
    }
    expect(violations).toEqual([]);
  });

  test('PLATFORM_FALLBACKS table has exactly one entry (A5)', () => {
    // Re-import the table from the slice 020 foundation module and
    // assert the size. The test in caller-id-resolution.test.ts is
    // the unit-level assertion; this one is the static-scan level
    // (the docstring in src/services/session/platform-fallbacks.ts
    // declares the contract; this test enforces it).
    const tablePath = join(process.cwd(), 'src', 'services', 'session', 'platform-fallbacks.ts');
    expect(existsSync(tablePath)).toBe(true);
    const body = readFileSync(tablePath, 'utf8');
    // Strip commented-out future entries (lines starting with `//`).
    // The slice 020 contract allows the table to be 1 entry today;
    // future entries (Cursor, Windsurf, peaks-ide) require a contract
    // doc bump and a corresponding uncomment + this test re-pin.
    //
    // Each array element is a multi-line object: `{` on one line,
    // `envVar: '...'`, `description: '...'`, `addedIn: '...'`, `}`.
    // We count the literal `envVar:` lines that are NOT inside a
    // `//` comment. The object-literal `{` is on its own line so we
    // don't try to match the opening brace — we just count uncommented
    // `envVar:` lines.
    const lines = body.split(/\r?\n/);
    const activeEntries = lines.filter((l) => {
      const t = l.trim();
      if (t.startsWith('//')) return false;
      return /^\s*envVar:\s*['"][^'"]+['"]/.test(l);
    });
    expect(activeEntries).toHaveLength(1);
    expect(activeEntries[0]).toContain('CLAUDE_CODE_SESSION_ID');
  });
});
