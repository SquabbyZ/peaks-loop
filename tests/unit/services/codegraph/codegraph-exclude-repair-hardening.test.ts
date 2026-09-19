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

import {
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-exclude-repair-hardening.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the module returns a plan/outcome; it prints nothing' }]
);

const fsRef = vi.hoisted(() => ({ actual: null as null | typeof import('node:fs') }));

/** Rename observation + one-shot failure injection. */
const renameHook = vi.hoisted(() => ({
  calls: [] as Array<{ from: string; to: string }>,
  failOn: null as null | string,
  armed: false
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
    }
  };
});

import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  applyCodegraphConfigRepair,
  repairCodegraphExclude
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
      rulesToRemove: ['**/a/**']
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
      rulesToRemove: ['**/a/**', '**/b/**']
    });

    expect(plan.removedRules).toEqual(['**/b/**', '**/a/**']);
    expect(plan.exclude).toEqual(['**/keep/**']);
  });
});

// ── F1 — render ──────────────────────────────────────────────────────

describe('applyCodegraphConfigRepair — the file keeps its shape', () => {
  it('should leave a single-line (minified) config single-line', () => {
    const projectRoot = makeProjectRoot();
    const original = '{"include":["**/*.ts"],"exclude":["**/vendor/**","**/dist/**"]}\n';
    seedConfig(projectRoot, original);

    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

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

    applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    expect(after).toContain('\n    "exclude"');
    expect(after).toBe(
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/dist/**'] }, null, 4)}\n`
    );
  });
});

// ── F3 — integration ─────────────────────────────────────────────────

describe('applyCodegraphConfigRepair — the rewrite is atomic', () => {
  it('should write through a same-directory temp file and rename it over the target', () => {
    const projectRoot = makeProjectRoot();
    const configPath = seedConfig(
      projectRoot,
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] }, null, 2)}\n`
    );

    renameHook.armed = true;
    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

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

    expect(() =>
      applyCodegraphConfigRepair(projectRoot, {
        rulesToRemove: ['**/vendor/**'],
        includePatternsToAdd: []
      })
    ).toThrow(/injected rename failure/);

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

describe('applyCodegraphConfigRepair — concurrent writers get distinct temp paths (N5)', () => {
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
    expect(
      applyCodegraphConfigRepair(projectRoot, {
        rulesToRemove: ['**/vendor/**'],
        includePatternsToAdd: []
      }).applied
    ).toBe(true);
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

// ── slice-002 repair round — the backup is NOT written through a link ─

/**
 * The hazard these cases close (security H1): the backup path
 * `<root>/.codegraph/config.json.bak` is FIXED, and the write was a plain
 * `writeFileSync(..., 'utf8')` — flag `'w'`, i.e. `O_WRONLY|O_CREAT|O_TRUNC`,
 * which FOLLOWS a symlink and TRUNCATES the inode a hard link shares. Since
 * `.codegraph/config.json.bak` is committable in a consumer repo (nothing
 * ignores it), a repository could ship that path as a link to any file plus a
 * `config.json` that merely OMITS an extension — the default state of every
 * pre-slice config — and the next repair-seam run would write the whole
 * attacker-authored config file through the link, as the victim.
 *
 * Both directions are asserted here, because "refused" alone is satisfiable by
 * an implementation that refuses everything (which would break the legitimate
 * second repair):
 *   - injection: a link at the backup path ⇒ the write is refused, the victim
 *     is byte-identical and the config was not published either;
 *   - clean control: an ordinary repair ⇒ the backup IS written, byte-exact;
 *     and a stale REGULAR file left by a previous repair is replaced, not
 *     refused.
 */
describe('applyCodegraphConfigRepair — the backup refuses to be written through a link', () => {
  const TWO_AXIS = { rulesToRemove: ['**/vendor/**'], includePatternsToAdd: ['**/*.mjs'] };

  function seedRepairFixture(): { projectRoot: string; configPath: string; original: string } {
    const projectRoot = makeProjectRoot();
    const original = `${JSON.stringify(
      { include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] },
      null,
      2
    )}\n`;
    const configPath = seedConfig(projectRoot, original);
    return { projectRoot, configPath, original };
  }

  it('should refuse a HARD LINK planted at the backup path, leaving the victim intact', () => {
    const { projectRoot, configPath, original } = seedRepairFixture();
    // The victim is any file the attacker wants overwritten — here, a file
    // that shares the backup path's inode.
    const victimPath = join(projectRoot, 'victim.txt');
    writeFileSync(victimPath, 'ORIGINAL VICTIM\n', 'utf8');
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    linkSync(victimPath, backupPath);

    // The injection really is a hard link: same inode, link count 2.
    expect(lstatSync(backupPath).nlink).toBe(2);

    expect(() => applyCodegraphConfigRepair(projectRoot, TWO_AXIS)).toThrow(
      /refusing to write through/
    );

    // …and NOTHING was written: the victim still holds its own bytes, and the
    // config was not published either (the refusal happens before the rewrite).
    expect(readFileSync(victimPath, 'utf8')).toBe('ORIGINAL VICTIM\n');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('should refuse a SYMBOLIC LINK planted at the backup path, leaving the victim intact', () => {
    const { projectRoot, configPath, original } = seedRepairFixture();
    const victimPath = join(projectRoot, 'victim.txt');
    writeFileSync(victimPath, 'ORIGINAL VICTIM\n', 'utf8');
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;

    // Capability check, not a silent pass: creating a file symlink needs
    // developer mode (or elevation) on Windows. Where that is unavailable the
    // hard-link case above is the executed evidence and this one records that
    // the platform refused to build the fixture.
    try {
      symlinkSync(victimPath, backupPath, 'file');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
        expect(lstatSync(backupPath, { throwIfNoEntry: false })).toBeUndefined();
        return;
      }
      throw error;
    }

    expect(lstatSync(backupPath).isSymbolicLink()).toBe(true);
    expect(() => applyCodegraphConfigRepair(projectRoot, TWO_AXIS)).toThrow(
      /refusing to write through/
    );
    expect(readFileSync(victimPath, 'utf8')).toBe('ORIGINAL VICTIM\n');
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('should refuse a DIRECTORY occupying the backup path, leaving the config intact', () => {
    const { projectRoot, configPath, original } = seedRepairFixture();
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    mkdirSync(backupPath);

    // Not a link, but not writable-as-a-backup either: `rename` onto a
    // non-empty directory fails with an opaque errno, so the guard names the
    // real reason instead.
    expect(() => applyCodegraphConfigRepair(projectRoot, TWO_AXIS)).toThrow(
      /refusing to write at a directory/
    );
    expect(readFileSync(configPath, 'utf8')).toBe(original);
  });

  it('should still write the backup on an ordinary repair — the clean control', () => {
    const { projectRoot, configPath, original } = seedRepairFixture();
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;

    const outcome = applyCodegraphConfigRepair(projectRoot, TWO_AXIS);

    expect(outcome.applied).toBe(true);
    expect(existsSync(backupPath)).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe(original);
    // A regular file with one link, written through the same CSPRNG temp +
    // rename as the config itself — the "was this ever written?" probe the
    // refusal above must not be confused with.
    expect(lstatSync(backupPath).isSymbolicLink()).toBe(false);
    expect(lstatSync(backupPath).nlink).toBe(1);
  });

  it('should REPLACE a previous backup left as a regular file, not refuse it', () => {
    const { projectRoot, configPath, original } = seedRepairFixture();
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    // A repair that ran earlier, or a hand-written copy. Refusing this would
    // break the legitimate "the project drifted and was repaired twice" path —
    // which is why the guard is a LINK test, not an `O_EXCL` existence test.
    writeFileSync(backupPath, 'STALE BACKUP FROM AN EARLIER REPAIR\n', 'utf8');

    const outcome = applyCodegraphConfigRepair(projectRoot, TWO_AXIS);

    expect(outcome.applied).toBe(true);
    expect(readFileSync(backupPath, 'utf8')).toBe(original);
  });
});

// ── slice-002 — BOTH axes move in ONE rewrite ────────────────────────

describe('applyCodegraphConfigRepair — two axes, one write', () => {
  /**
   * The window this closes: a caller that widened `include` in one write and
   * dropped the newly-offending `exclude` rules in a second would leave the
   * config on disk in a state worse than it started (the widened include
   * admits a file that a surviving rule then hides from the index), and would
   * need two backups to stay rollback-exact. One rewrite has neither problem,
   * so "exactly one rename" is the assertion that matters.
   */
  it('should rewrite include and exclude in a single atomic rename, with one byte-exact backup', () => {
    const projectRoot = makeProjectRoot();
    const original = `${JSON.stringify(
      {
        version: 1,
        rootDir: '.',
        include: ['**/*.ts'],
        exclude: ['**/tool.mjs', '**/node_modules/**'],
        languages: ['typescript'],
        frameworks: [],
        maxFileSize: 1048576,
        extractDocstrings: true,
        trackCallSites: false
      },
      null,
      2
    )}\n`;
    const configPath = seedConfig(projectRoot, original);

    renameHook.armed = true;
    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/tool.mjs'],
      includePatternsToAdd: ['**/*.mjs']
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) {
      // Narrowing, not decoration: the outcome is a discriminated union and
      // the counts only exist on the applied arm, so the belief is asserted
      // once here and every field below is typed.
      throw new Error('expected the writer to apply a two-axis repair');
    }
    expect(outcome.removedRules).toEqual(['**/tool.mjs']);
    expect(outcome.addedIncludePatterns).toEqual(['**/*.mjs']);
    expect(outcome.includeCountBefore).toBe(1);
    expect(outcome.includeCountAfter).toBe(2);
    expect(outcome.excludeCountBefore).toBe(2);
    expect(outcome.excludeCountAfter).toBe(1);

    // ONE rename over the target — not one per axis.
    const renames = renameHook.calls.filter((call) => call.to === configPath);
    expect(renames).toHaveLength(1);

    // ONE backup, byte-exact, taken from the PRE-repair file.
    const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
    expect(readFileSync(backupPath, 'utf8')).toBe(original);

    // Both axes landed, and nothing else in the file moved: the textual
    // halves outside the two changed arrays are byte-identical.
    const after = readFileSync(configPath, 'utf8');
    const sliceOutsideArrays = (text: string): { prefix: string; suffix: string } => {
      const includeStart = text.indexOf('"include"');
      const includeEnd = text.indexOf(']', includeStart);
      const excludeStart = text.indexOf('"exclude"');
      const excludeEnd = text.indexOf(']', excludeStart);
      return {
        prefix: text.slice(0, includeStart),
        suffix: text.slice(includeEnd + 1, excludeStart) + text.slice(excludeEnd + 1)
      };
    };
    expect(sliceOutsideArrays(after)).toEqual(sliceOutsideArrays(original));
    expect(JSON.parse(after)).toEqual({
      version: 1,
      rootDir: '.',
      include: ['**/*.ts', '**/*.mjs'],
      exclude: ['**/node_modules/**'],
      languages: ['typescript'],
      frameworks: [],
      maxFileSize: 1048576,
      extractDocstrings: true,
      trackCallSites: false
    });
  });
});
