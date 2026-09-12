// tests/unit/services/codegraph/codegraph-exclude-repair-hardening.test.ts
//
// Three hardening defects in `src/services/codegraph/codegraph-exclude-repair.ts`
// (slice S1 of rid-2026-09-12-defect-remediation). Each one is a way the
// writer misdescribed or mishandled the third-party file it edits:
//
//   F1 — a single-line (minified) `config.json` came back pretty-printed
//        with two-space indent, contradicting `detectIndent`'s own
//        promise to keep the file's shape. Upstream's default template
//        is pretty, so only a hand-minified config hit this.
//   F2 — `removedRules` was a plain `filter`, so a rule listed twice in
//        `exclude` was COUNTED twice. The dedupe result was right; the
//        count reported to the user (and to the warning text) was not.
//   F3 — the rewrite was copy-then-write (`writeFileSync(configPath, …)`
//        straight onto the target), so a crash or a full disk between
//        the two writes could leave a third-party tool's config
//        truncated. It is now a same-directory temp file + `renameSync`.
//
// `node:fs` is mocked in this file ONLY to observe and to interrupt the
// rename. `renameSync` is the sole hooked call; everything else is the
// real implementation, and all temp dirs are real.
//
// Dimensions covered:
//   - render:      the serialized config bytes (compact vs indented)
//   - behavior:    `removedRules` dedupe + the write-failure path
//   - integration: real fs, real rename, real backup file
//   - a11y:        omitted — no user-facing text or exit code here

import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-exclude-repair-hardening.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a plan/outcome; it prints nothing' }],
);

const fsRef = vi.hoisted(() => ({ actual: null as null | typeof import('node:fs') }));

/** Rename observation + one-shot failure injection. */
const renameHook = vi.hoisted(() => ({
  calls: [] as Array<{ from: string; to: string }>,
  failOn: null as null | string,
  armed: false,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  fsRef.actual = actual;
  return {
    ...actual,
    renameSync: (from: unknown, to: unknown): void => {
      const fromPath = String(from);
      const toPath = String(to);
      if (renameHook.armed) {
        renameHook.calls.push({ from: fromPath, to: toPath });
      }
      if (renameHook.armed && renameHook.failOn !== null && toPath === renameHook.failOn) {
        throw Object.assign(new Error('injected rename failure'), { code: 'EPERM' });
      }
      actual.renameSync(fromPath, toPath);
    },
  };
});

import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  applyCodegraphExcludeRepair,
  repairCodegraphExclude,
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';

const cleanups: string[] = [];

afterEach(() => {
  renameHook.armed = false;
  renameHook.failOn = null;
  renameHook.calls = [];
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-cg-repair-hardening-'));
  cleanups.push(dir);
  return dir;
}

function configPathOf(projectRoot: string): string {
  return join(projectRoot, '.codegraph', 'config.json');
}

function seedConfig(projectRoot: string, text: string): string {
  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(configPathOf(projectRoot), text, 'utf8');
  return configPathOf(projectRoot);
}

// ── F2 — behavior ────────────────────────────────────────────────────

describe('repairCodegraphExclude — removedRules is a set, not a filter', () => {
  it('should count a duplicated rule once', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/a/**', '**/a/**'],
      rulesToRemove: ['**/a/**'],
    });

    expect(plan.changed).toBe(true);
    // Before the fix this was ['**/a/**', '**/a/**'] — length 2.
    expect(plan.removedRules).toEqual(['**/a/**']);
    expect(plan.removedRules.length).toBe(1);
    // The dedupe result itself was already correct.
    expect(plan.exclude).toEqual([]);
  });

  it('should dedupe while keeping config order across several rules', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/b/**', '**/a/**', '**/b/**', '**/a/**', '**/keep/**'],
      rulesToRemove: ['**/a/**', '**/b/**'],
    });

    expect(plan.removedRules).toEqual(['**/b/**', '**/a/**']);
    expect(plan.exclude).toEqual(['**/keep/**']);
  });
});

// ── F1 — render ──────────────────────────────────────────────────────

describe('applyCodegraphExcludeRepair — the file keeps its shape', () => {
  it('should leave a single-line (minified) config single-line', () => {
    const projectRoot = makeProjectRoot();
    const original = '{"include":["**/*.ts"],"exclude":["**/vendor/**","**/dist/**"]}\n';
    seedConfig(projectRoot, original);

    const outcome = applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']);

    expect(outcome.applied).toBe(true);
    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    // Before the fix this was pretty-printed with two-space indent.
    expect(after.trimEnd().includes('\n')).toBe(false);
    expect(after).toBe('{"include":["**/*.ts"],"exclude":["**/dist/**"]}\n');
  });

  it('should preserve a non-default indent on a pretty config', () => {
    const projectRoot = makeProjectRoot();
    const original = `${JSON.stringify(
      { include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] },
      null,
      4
    )}\n`;
    seedConfig(projectRoot, original);

    applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']);

    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    expect(after).toContain('\n    "exclude"');
    expect(after).toBe(
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/dist/**'] }, null, 4)}\n`
    );
  });
});

// ── F3 — integration ─────────────────────────────────────────────────

describe('applyCodegraphExcludeRepair — the rewrite is atomic', () => {
  it('should write through a same-directory temp file and rename it over the target', () => {
    const projectRoot = makeProjectRoot();
    const configPath = seedConfig(
      projectRoot,
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] }, null, 2)}\n`
    );

    renameHook.armed = true;
    const outcome = applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']);

    expect(outcome.applied).toBe(true);
    const renames = renameHook.calls.filter((call) => call.to === configPath);
    expect(renames).toHaveLength(1);
    const tempPath = renames[0]?.from ?? '';
    // Same directory as the target ⇒ same filesystem ⇒ a real atomic rename.
    expect(dirname(tempPath)).toBe(dirname(configPath));
    // N5: the name is per-writer (pid + random), not the shared fixed
    // `${configPath}.tmp` that two overlapping writers once had to share.
    expect(basename(tempPath)).toMatch(/^config\.json\.\d+\.[0-9a-f]{12}\.tmp$/);
    // …and nothing is left behind.
    expect(existsSync(tempPath)).toBe(false);
  });

  it('should leave the target untouched and clean up the temp file when the rename fails', () => {
    const projectRoot = makeProjectRoot();
    const original = `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] }, null, 2)}\n`;
    const configPath = seedConfig(projectRoot, original);

    renameHook.armed = true;
    renameHook.failOn = configPath;

    expect(() => applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**'])).toThrow(
      /injected rename failure/
    );

    // The third-party config still holds its ORIGINAL bytes — not a prefix,
    // not a half-written rewrite.
    expect(readFileSync(configPath, 'utf8')).toBe(original);
    // The rollback copy is still there and still byte-exact.
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe(original);
    // The failure path cleans up after itself.
    const tempPath = renameHook.calls.find((call) => call.to === configPath)?.from ?? '';
    expect(tempPath).not.toBe('');
    expect(existsSync(tempPath)).toBe(false);
  });
});

// ── N5 — the temp path is per-writer ─────────────────────────────────

describe('applyCodegraphExcludeRepair — concurrent writers get distinct temp paths (N5)', () => {
  /**
   * Two independent repairs, each rewriting its own config, as two processes
   * would. With the old fixed `${filePath}.tmp` both writers named the SAME
   * temp file, so one `renameSync` could publish a file the other was still
   * writing — the half-written config the temp file exists to prevent. The
   * repair's own three callers (fresh `init`, pre-dispatch preflight,
   * post-slice autorefresh) can overlap, so this is reachable in practice.
   */
  function repairAndCaptureTemp(projectRoot: string): string {
    const configPath = seedConfig(
      projectRoot,
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] }, null, 2)}\n`
    );
    renameHook.armed = true;
    const before = renameHook.calls.length;
    expect(applyCodegraphExcludeRepair(projectRoot, ['**/vendor/**']).applied).toBe(true);
    const rename = renameHook.calls.slice(before).find((call) => call.to === configPath);
    expect(rename).toBeDefined();
    const tempPath = rename?.from ?? '';
    // Same directory ⇒ same filesystem ⇒ the rename cannot degrade to a copy.
    expect(dirname(tempPath)).toBe(dirname(configPath));
    // A fixed name would collide with the sibling writer below.
    expect(basename(tempPath)).not.toBe('config.json.tmp');
    expect(existsSync(tempPath)).toBe(false);
    return tempPath;
  }

  it('should give two overlapping repairs two different temp paths', () => {
    const first = repairAndCaptureTemp(makeProjectRoot());
    const second = repairAndCaptureTemp(makeProjectRoot());

    expect(first).not.toBe(second);
    // The pid is part of the name, so two PROCESSES cannot collide on it
    // either; the random suffix separates two writers inside one process.
    expect(basename(first)).toContain(String(process.pid));
  });
});
