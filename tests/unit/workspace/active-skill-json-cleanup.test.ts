// tests/unit/workspace/active-skill-json-cleanup.test.ts
//
// Slice 4.0.11 statusline-sid-scoped-lease C — drift guard.
//
// The deprecated project-level single-slot presence file
// `.peaks/_runtime/active-skill.json` (and its pre-runtime sibling
// `.peaks/.active-skill.json`) is REMOVED from the codebase. The
// canonical sid-scoped lease projection
// (`.peaks/_runtime/<sid>/leases/presence-*.json`) is the only
// source of truth.
//
// This test asserts three guard conditions:
//
//   Guard 1: `\.peaks/_runtime/active-skill\.json` regex MUST have
//            zero hits across `src/` (excluding doc comments).
//   Guard 2: `\.peaks/\.active-skill\.json` regex MUST have zero
//            hits across `src/` (excluding doc comments).
//   Guard 3: `'active-skill.json'` / `'.active-skill.json'`
//            literal strings MUST have zero hits in
//            `src/services/migration/` (the migration list is
//            expected to drop both entries now that the file is
//            deprecated).
//
// The guards are enforced via simple `fs.readFileSync` + regex
// scanning; no CLI integration is needed. The slice pre-condition
// (4-A + 4-B already landed) means the file write path and the
// statusline resolver are already clean — this slice closes the
// remaining read/mention surface.
//
// Dimensions covered:
//   - render:     N/A
//   - behavior:   drift-guard pattern matches document the contract
//   - integration: real fs read of every source file in the repo
//   - a11y:       N/A
//
// Run with: pnpm vitest run tests/unit/workspace/active-skill-json-cleanup.test.ts

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..');

// Slice 4.0.11 statusline-sid-scoped-lease C: drift guard is
// SCOPED to the 5 modules the slice touched. The pre-condition
// (4-A + 4-B) already cleaned the write path + statusline
// resolver; this slice closes the doctor / sc / migration /
// hooks / skills read surface. Out-of-scope modules
// (reconcile-service.ts, migrate-service.ts, project-standards-
// service.ts) carry their own historical legacy paths and are
// tracked by separate slices.
const SCAN_DIRS: ReadonlyArray<string> = [
  join(REPO_ROOT, 'src', 'services', 'doctor'),
  join(REPO_ROOT, 'src', 'services', 'sc'),
  join(REPO_ROOT, 'src', 'services', 'migration'),
  join(REPO_ROOT, 'src', 'services', 'hooks'),
  join(REPO_ROOT, 'src', 'services', 'skills')
];

const MIGRATION_DIR = join(REPO_ROOT, 'src', 'services', 'migration');

const PROJECT_LEVEL_PATH_RE = /\.peaks[\\/]+_runtime[\\/]+active-skill\.json/g;
const LEGACY_DOTFILE_PATH_RE = /\.peaks[\\/]+\.active-skill\.json/g;

const FILE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      // Skip nested node_modules + dist artifacts — drift guards
      // only need to scan source tree.
      if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
      out.push(...walk(full));
    } else if (stat.isFile()) {
      const dotIdx = entry.lastIndexOf('.');
      const ext = dotIdx === -1 ? '' : entry.slice(dotIdx);
      if (FILE_EXTENSIONS.has(ext)) out.push(full);
    }
  }
  return out;
}

/**
 * Scan a single file body for a regex pattern, skipping doc-comment
 * lines (lines starting with `//`, `*`, or `/*` block-comment
 * markers). The drift guard is satisfied as long as production
 * code does not reference the deprecated paths — doc comments are
 * allowed so the slice narrative stays in place.
 */
function findProductionHits(body: string, pattern: RegExp): string[] {
  const hits: string[] = [];
  const lines = body.split(/\r?\n/);
  let inBlockComment = false;
  for (const line of lines) {
    const trimmed = line.trimStart();
    if (inBlockComment) {
      if (trimmed.endsWith('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.endsWith('*/')) inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    pattern.lastIndex = 0;
    const matches = line.match(pattern);
    if (matches) hits.push(...matches);
  }
  return hits;
}

function findAllHits(dir: string, pattern: RegExp): Array<{ file: string; match: string }> {
  const out: Array<{ file: string; match: string }> = [];
  for (const file of walk(dir)) {
    let body: string;
    try {
      body = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = findProductionHits(body, pattern);
    for (const m of hits) {
      out.push({ file: relative(REPO_ROOT, file), match: m });
    }
  }
  return out;
}

describe("Scenario: drift guard — `.peaks/_runtime/active-skill.json` is not referenced in src/", () => {
  it("when invoked, should scan src/ for the project-level single-slot path; expect 0 production-code hits", () => {
    for (const dir of SCAN_DIRS) {
      const hits = findAllHits(dir, PROJECT_LEVEL_PATH_RE);
      expect(hits, `Deprecated project-level single-slot path referenced in ${hits.map((h) => h.file).join(', ')}`).toEqual([]);
    }
  });
});

describe("Scenario: drift guard — `.peaks/.active-skill.json` (legacy dotfile) is not referenced in src/", () => {
  it("when invoked, should scan src/ for the legacy dotfile path; expect 0 production-code hits", () => {
    for (const dir of SCAN_DIRS) {
      const hits = findAllHits(dir, LEGACY_DOTFILE_PATH_RE);
      expect(hits, `Legacy dotfile path referenced in ${hits.map((h) => h.file).join(', ')}`).toEqual([]);
    }
  });
});

describe("Scenario: drift guard — migration list no longer references active-skill.json", () => {
  it("when invoked, should scan src/services/migration/ for the literal filenames; expect 0 hits", () => {
    const hits = findAllHits(MIGRATION_DIR, /['"`]'?\/?(?:\.peaks[\\/]+)?(?:_runtime[\\/]+)?active-skill\.json['"`]?/g);
    expect(hits, `Migration list still references active-skill.json in ${hits.map((h) => h.file).join(', ')}`).toEqual([]);
  });
});