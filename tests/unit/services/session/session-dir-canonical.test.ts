// tests/unit/services/session/session-dir-canonical.test.ts
//
// Repo-wide static scan for the canonical per-session workspace path
// (slice 005-session-runtime-dir-regression + slice 012 "5th writer").
//
// History. This file was deleted in f17aa377 ("delete 559 legacy unit tests
// and reset vitest config") while six places still asserted it was live —
// the `getSessionDir.ts` docstring and five `.peaks/memory/` files. Rebuilt
// as **S5** (user decision UD-1): a separate commit, NOT part of the
// `peaks-web` acceptance.
//
// Three invariants:
//
//  (a) `getSessionDir(root, sid)` returns `<root>/.peaks/_runtime/<sid>`.
//
//  (b) A static scan over `src/**` flags any direct join of `.peaks` +
//      `sessionId` that does NOT route through `getSessionDir`. The
//      back-compat **read** sites are excluded by an explicit allow-list
//      (the bug is write-paths only).
//
//  (c) A static scan over `skills/**` flags a session-scoped artifact path
//      (`<root>/.peaks/<sid>/...`, missing `_runtime/`) that a sub-agent
//      would follow verbatim. The 5th writer was the QA 3-way fan-out
//      contract `skills/bee/peaks-qa/references/qa-fanout-contract.md`,
//      which instructed sub-agents to write to `.peaks/<sid>/qa/...`
//      instead of `.peaks/_runtime/<sid>/qa/...`. Markdown is a writer in
//      spirit because the LLM follows it literally.
//
// Repairs applied when rebuilding, vs. `git show f17aa377^:<this file>`:
//
//  1. **The src scan could not fail for the bug class it exists for.** The
//     original matched only `join(..., '.peaks', sessionId)` — `sessionId`
//     as the FINAL argument. But the slice-005 regression wrote a *sub-path*
//     (`join(root, '.peaks', sessionId, 'qa', 'performance-findings.md')`),
//     i.e. `sessionId` mid-chain; its user-visible symptom was
//     `.peaks/<sid>/qa/performance-findings.md` at the project root. The
//     original pattern returned 0 hits on exactly the shape it was written
//     to catch. Now matches a `join(...)` chain that mentions `.peaks` and a
//     session-id token with the canonical `_runtime` segment missing in
//     between, wherever the token sits in the chain.
//  2. **The skills half could not see the bee tree.** The original walked
//     `skills/<skill>/references/*.md` — one level. The fan-out contracts
//     live at `skills/bee/<skill>/references/*.md`, two levels down. Now
//     walks `skills/**/*.md` recursively (161 files).
//  3. **The placeholder alternation was `<sid>` only**, although the
//     original's own comment claimed it handled `<sid>`, `<session-id>` and
//     `<sessionId>`. Widened to those three session-scoped shapes. Bare
//     `<id>` is deliberately NOT matched: it denotes a global SOP id
//     (`~/.peaks/sops/<id>/`), not a session, and matching it produced a
//     false positive at `skills/peaks-sop/references/sop-authoring.md:139`.
//  4. **Allow-list entries are now machine-checked to be load-bearing.** A
//     test asserts every `src/` entry actually suppresses a violation, so an
//     inert entry cannot accumulate (three entries in the original were
//     already dead). The two historical `skills/` entries were dropped
//     outright: later slices canonicalized both files, so the exemptions
//     only served to blind the scan to those paths.
//  5. **The slice-020 `PLATFORM_FALLBACKS.length === 1` assertion was
//     dropped.** The table was deleted in 4.0.8 by user decision C1
//     ("every caller resolution MUST go through the active IDE adapter").
//     The assertion pinned a contract the product deliberately reversed —
//     the code is right, the assertion was wrong. Unit coverage of caller
//     resolution lives in `caller-id-resolution.test.ts`.
//
// Dimensions covered:
//   - render:      the resolver's returned path shape
//   - behavior:    each scanner's accept/reject decision, on a tmp fixture
//   - integration: both scanners walk the real on-disk repo tree
//   - a11y:        OMITTED — no human-facing text or exit code in this surface

import { describe, expect, test } from 'vitest';
import { join } from 'node:path';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { getSessionDir } from '~/src/services/session/getSessionDir';

declareDimensions(
  'tests/unit/services/session/session-dir-canonical.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'static scans expose no human-facing text or exit code' }],
);

// `src/` files exempt from invariant (b). Every entry MUST be load-bearing —
// i.e. the file must contain a chain the scanner would otherwise flag — and
// that is asserted below, so an exemption cannot silently outlive its reason.
// Four entries are intentional legacy **reads**; one is a known scanner
// false positive that is tracked rather than papered over.
const ALLOWED_LEGACY_READ_PATHS: ReadonlyArray<string> = [
  // Intentional legacy read, top-level probe of a 3-umbrella search
  // (`.peaks/<sid>`, `.peaks/retrospective/<sid>`, `.peaks/_dogfood/<sid>`).
  // The other two umbrellas are separate trees, not the session workspace.
  'src/services/sc/sc-service.ts',
  // Intentional legacy read: `legacyMisplacedQaDir` is the pre-1.3.0
  // `.peaks/<sessionId>/qa/` fallback, tagged `'legacy'` so Gate C can warn.
  'src/services/workflow/artifact-paths.ts',
  // Intentional legacy read: the L2.2 audit gate must still read 2.8.0-era
  // design drafts from the legacy sibling dir when one exists.
  'src/services/audit/enforcers/design-draft-confirm.ts',
  // Not a write target: the legacy string is pushed onto a `migratedFiles`
  // report list describing where a file was moved FROM.
  'src/services/workspace/reconcile-migrate.ts',
  // Intentional legacy read: `legacySessionRoot` is tier 2 of the documented
  // pre-F3 back-compat fallback (`:455`), consumed by
  // `resolvePrerequisiteAbsolutePathWithFallback`.
  'src/services/artifacts/artifact-prerequisites.ts',
  // KNOWN SCANNER FALSE POSITIVE. `readSummary`'s `sessionId` parameter
  // actually holds a pre-joined `_runtime/<sid>` scope fragment, so the
  // composed path IS canonical — but the scanner cannot know that from a
  // line. Verified: dropping this entry re-flags `:309` only. Remove the
  // entry once that parameter is renamed to reflect what it holds.
  'src/services/artifacts/request-artifact-service.ts',
];

// `skills/` files exempt from invariant (c). Deliberately empty: the two
// historical entries (`skills/peaks-code/references/a2a-artifact-mapping.md`
// and `skills/bee/peaks-prd/SKILL.md`) were canonicalized by later slices and
// now emit zero violations, so the exemptions only hid those paths from the
// scan. Add an entry back — with a justification — if a legitimate
// legacy-shaped reference appears.
const ALLOWED_LEGACY_SKILL_PATHS: ReadonlyArray<string> = [];

/** Session-scoped `<...>` placeholder shapes. Bare `<id>` is excluded: it is
 *  a global SOP id, not a session id. */
const SESSION_PLACEHOLDER = '<(?:sid|session-id|sessionId)>';
/** Path segments that are legitimately NOT the per-session workspace. */
const NON_WORKSPACE_SEGMENTS = ['_runtime', '_sub_agents', 'retrospective', '_dogfood'];
/** Bare or dot-qualified session-id argument names (`meta.sessionId`, ...). */
const SESSION_ID_TOKEN = /\b(?:[A-Za-z_][A-Za-z0-9_]*\.)?sessionId\b/;

const isNonWorkspace = (gap: string): boolean =>
  NON_WORKSPACE_SEGMENTS.some((token) => gap.includes(token));

function listFiles(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listFiles(full, match));
    else if (match(entry)) out.push(full);
  }
  return out;
}

/**
 * Find a `join(...)` chain that names `.peaks` and then a session-id token
 * without the canonical `_runtime` segment (or another non-workspace
 * segment) in between. Guards the resolver itself and the allow-list.
 */
function findSessionDirJoinViolations(
  file: string,
  opts: { applyAllowList?: boolean } = {},
): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if (rel.endsWith('src/services/session/getSessionDir.ts')) return [];
  if ((opts.applyAllowList ?? true) && ALLOWED_LEGACY_READ_PATHS.some((a) => rel.endsWith(a))) {
    return [];
  }

  // Template-literal form `` `.peaks/${sessionId}` `` is gap-safe by
  // construction: the canonical shape (`.peaks/_runtime/${...}`) has
  // `_runtime` before the `${`, so it cannot match.
  const templatePattern = /`\.peaks\/\$\{[^}]*sessionId[^}]*\}`/;
  const violations: Array<{ line: number; text: string }> = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    for (const call of line.matchAll(/join\(([^)]*)\)/g)) {
      const pk = (call[1] ?? '').indexOf('.peaks');
      if (pk === -1) continue;
      const rest = (call[1] ?? '').slice(pk + '.peaks'.length);
      const token = SESSION_ID_TOKEN.exec(rest);
      if (token === null) continue;
      if (!isNonWorkspace(rest.slice(0, token.index))) {
        violations.push({ line: i + 1, text: trimmed });
      }
    }
    if (templatePattern.test(line) && !violations.some((v) => v.line === i + 1)) {
      violations.push({ line: i + 1, text: trimmed });
    }
  }
  return violations;
}

/** Find `<root>/.peaks/<sid>/...` paths a sub-agent would follow verbatim. */
function findSkillMarkdownLegacySessionPaths(
  file: string,
  opts: { applyAllowList?: boolean } = {},
): Array<{ line: number; text: string }> {
  const rel = file.replace(/\\/g, '/');
  if ((opts.applyAllowList ?? true) && ALLOWED_LEGACY_SKILL_PATHS.some((a) => rel.endsWith(a))) {
    return [];
  }

  const pattern = new RegExp(`\\.peaks(?:\\/([^\\s/]+))?\\/${SESSION_PLACEHOLDER}`);
  const violations: Array<{ line: number; text: string }> = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('<!--') || trimmed.endsWith('-->')) continue;
    const match = line.match(pattern);
    if (match === null) continue;
    if (!isNonWorkspace(match[1] ?? '')) violations.push({ line: i + 1, text: trimmed });
  }
  return violations;
}

function scanTree(
  root: string,
  files: string[],
  scan: (file: string) => Array<{ line: number; text: string }>,
): Array<{ file: string; line: number; text: string }> {
  const prefix = root.replace(/\\/g, '/') + '/';
  const violations: Array<{ file: string; line: number; text: string }> = [];
  for (const file of files) {
    for (const hit of scan(file)) {
      violations.push({ file: file.replace(/\\/g, '/').replace(prefix, ''), ...hit });
    }
  }
  return violations;
}

/** Build a throwaway tree containing exactly one deliberate violation each. */
function makeFixtureTree(): { root: string; srcFile: string; skillFile: string } {
  const root = mkdtempSync(join(tmpdir(), 'peaks-scan-fixture-'));

  const srcFile = join(root, 'src', 'services', 'example', 'writer.ts');
  mkdirSync(join(root, 'src', 'services', 'example'), { recursive: true });
  // The slice-005 shape: a sub-path under the legacy dir, sessionId mid-chain.
  writeFileSync(
    srcFile,
    `const p = join(root, '.peaks', sessionId, 'qa', 'performance-findings.md');\n`,
    'utf8',
  );

  // Two levels deep on purpose: the original one-level walker could not see
  // `skills/bee/<skill>/references/`, which is where the fan-out lives.
  const skillFile = join(root, 'skills', 'bee', 'peaks-qa', 'references', 'fanout.md');
  mkdirSync(join(root, 'skills', 'bee', 'peaks-qa', 'references'), { recursive: true });
  writeFileSync(skillFile, `Write evidence at .peaks/<sid>/qa/test-reports/<rid>.md\n`, 'utf8');

  return { root, srcFile, skillFile };
}

describe('Scenario: render — canonical resolver shape (invariant a)', () => {
  test('when invoked, should compose <root>/.peaks/_runtime/<sessionId> only', () => {
    const root = join('repo', 'project');
    const sid = '2026-06-06-session-5b1095';
    expect(getSessionDir(root, sid)).toBe(join(root, '.peaks', '_runtime', sid));
    // The legacy top-level layout must NOT be what this resolver returns.
    expect(getSessionDir(root, sid)).not.toBe(join(root, '.peaks', sid));
  });
});

describe('Scenario: behavior — each scanner rejects a deliberate violation (invariant b + c)', () => {
  test('src scanner flags a legacy sub-path join (sessionId mid-chain)', () => {
    const { root, srcFile } = makeFixtureTree();
    try {
      const violations = findSessionDirJoinViolations(srcFile);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('skills scanner flags a legacy .peaks/<sid>/ path but accepts the canonical form', () => {
    const { root, skillFile } = makeFixtureTree();
    try {
      const violations = findSkillMarkdownLegacySessionPaths(skillFile);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.line).toBe(1);

      writeFileSync(skillFile, `Write evidence at .peaks/_runtime/<sid>/qa/test-reports/<rid>.md\n`, 'utf8');
      expect(findSkillMarkdownLegacySessionPaths(skillFile)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scenario: integration — repo-wide static scans (invariant b + c)', () => {
  const root = process.cwd();

  test('no direct .peaks + sessionId join in src/ outside the resolver and allow-list', () => {
    const files = listFiles(join(root, 'src'), (name) => /\.(ts|mjs|js)$/.test(name));
    expect(files.length).toBeGreaterThan(0);
    expect(scanTree(root, files, findSessionDirJoinViolations)).toEqual([]);
  });

  test('no legacy session-scoped artifact path in skills/**/*.md', () => {
    const files = listFiles(join(root, 'skills'), (name) => name.endsWith('.md'));
    expect(files.length).toBeGreaterThan(0);
    expect(scanTree(root, files, findSkillMarkdownLegacySessionPaths)).toEqual([]);
  });

  test('every src allow-list entry is load-bearing and its file still exists', () => {
    for (const rel of ALLOWED_LEGACY_READ_PATHS) {
      const abs = join(root, rel);
      expect(existsSync(abs), rel).toBe(true);
      // Inert entries are a hole in the guard: exempting a clean file only
      // blinds the scan to that path. Every entry must suppress something.
      const unexempted = findSessionDirJoinViolations(abs, { applyAllowList: false });
      expect(unexempted.length, `${rel} is exempt but nothing was suppressed`).toBeGreaterThan(0);
      expect(findSessionDirJoinViolations(abs), rel).toEqual([]);
    }
  });

  test('every skills allow-list entry still exists (rename-rot guard)', () => {
    for (const rel of ALLOWED_LEGACY_SKILL_PATHS) {
      expect(existsSync(join(root, rel)), rel).toBe(true);
    }
  });
});
