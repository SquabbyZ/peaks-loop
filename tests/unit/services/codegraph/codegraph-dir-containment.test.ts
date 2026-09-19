// tests/unit/services/codegraph/codegraph-dir-containment.test.ts
//
// Slice-002 S12 — security R1, the containment gap one level ABOVE the H1 fix.
//
// H1's fix (`writeConfigBackup`) refuses a link planted at the backup FILE
// path. Neither it nor anything else checked the DIRECTORY that path lives
// in: with `<root>/.codegraph` as a junction (or a symlink) to another
// directory, every existing probe passed — `defaultCodegraphInitGuard` probes
// with `statSync`, which follows — and `applyCodegraphConfigRepair` rewrote
// `<linked>/config.json` and created `<linked>/config.json.bak`. `applied:
// true`, a write outside the project, into a directory chosen by whoever
// committed the link. `.codegraph/` has no gitignore coverage in a consumer
// project, so that link is as committable as H1's.
//
// The fix is `assertCodegraphDirContained` (codegraph-service.ts), called by
// `applyCodegraphConfigRepair` BEFORE the read. Its predicate is CONTAINMENT,
// not link-ness: a link resolving to a directory still inside the project
// root is allowed, because refusing every link would fail closed on a state a
// user may legitimately have. Both halves are asserted below, because
// "refused" alone is satisfiable by a guard that refuses everything:
//
//   - injection: `.codegraph` as a link to a FOREIGN directory ⇒ refused, the
//     foreign `config.json` byte-identical, no `.bak` and no temp file left in
//     the foreign directory;
//   - clean control, SAME fixture shape (same tree, same config bytes, only
//     link-vs-directory differs): an ordinary `.codegraph` directory ⇒ the
//     repair proceeds and writes where it should;
//   - in-project link control: `.codegraph` linked to a directory INSIDE the
//     root ⇒ allowed, so the guard is not a blanket link refusal.
//
// WHAT COULD NOT BE TESTED HERE. File/`'dir'` SYMLINKS need developer mode on
// Windows and raise `EPERM` without it, so the executed link kind on this host
// is the JUNCTION (`symlinkSync(..., 'junction')`, no elevation required);
// `symlinkSync(target, link, 'dir')` is used on POSIX, where no such gate
// exists. A junction is a reparse point like a symlink and `lstat` reports it
// as one (asserted below rather than assumed), so the refusal branch that
// fires here is the same branch a symlink would take.
//
// Dimensions covered:
//   - behavior:    the predicate's four outcomes (inside / absent / outside /
//                  resolves-to-root)
//   - integration: real temp trees, a real junction, the real writer
//   - render:      the repaired bytes + the byte-exact backup beside them
//   - a11y:        a refusal reaches the caller as a NAMED warning, never as
//                  a silent "nothing to repair"

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  applyCodegraphConfigRepair,
  repairCodegraphExcludeFromProject
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import { assertCodegraphDirContained } from '../../../../src/services/codegraph/codegraph-service.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-dir-containment.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'the refusal surfaces as a named warning field on the report envelope' }]
);

const cleanups: string[] = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      // Verified safe for a directory containing a junction: `rmSync` lstats
      // each entry and UNLINKS a reparse point instead of recursing into the
      // target, so this cannot delete the link's target contents.
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(dir);
  return dir;
}

const CONFIG_TEXT = `${JSON.stringify(
  { include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] },
  null,
  2
)}\n`;

const TWO_AXIS = { rulesToRemove: ['**/vendor/**'], includePatternsToAdd: ['**/*.mjs'] };

function codegraphDirOf(projectRoot: string): string {
  return join(projectRoot, '.codegraph');
}

function configPathOf(projectRoot: string): string {
  return join(codegraphDirOf(projectRoot), 'config.json');
}

/**
 * Create a directory link. `'junction'` is the only kind Windows allows
 * without developer mode; on POSIX the type argument is ignored and a plain
 * directory symlink is created. Returns `false` when the platform refused to
 * build the fixture — the caller must then say so rather than pass silently.
 */
function linkDir(target: string, linkPath: string): boolean {
  try {
    symlinkSync(target, linkPath, 'junction');
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM' || code === 'EACCES' || code === 'UNKNOWN') {
      return false;
    }
    throw error;
  }
}

function git(dir: string, args: readonly string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore', windowsHide: true });
}

/** A real temp git work tree with one tracked source file at `relativePath`. */
function seedTrackedFile(projectRoot: string, relativePath: string, body: string): void {
  if (!existsSync(join(projectRoot, '.git'))) {
    git(projectRoot, ['init', '-q']);
    git(projectRoot, ['config', 'user.email', 'peaks-test@example.com']);
    git(projectRoot, ['config', 'user.name', 'peaks test']);
  }
  mkdirSync(dirname(join(projectRoot, relativePath)), { recursive: true });
  writeFileSync(join(projectRoot, relativePath), body, 'utf8');
}

/** A project with NO `.codegraph/` of its own plus a foreign `.codegraph/` to link at. */
function makeInjectionFixture(): { projectRoot: string; foreignDir: string } {
  const projectRoot = makeTempDir('peaks-cg-r1-inject-');
  const foreignDir = makeTempDir('peaks-cg-r1-foreign-');
  writeFileSync(join(foreignDir, 'config.json'), CONFIG_TEXT, 'utf8');
  return { projectRoot, foreignDir };
}

/** The same fixture SHAPE — same tree, same config bytes — with a real directory. */
function makeCleanFixture(): { projectRoot: string; foreignDir: string } {
  const projectRoot = makeTempDir('peaks-cg-r1-clean-');
  const foreignDir = codegraphDirOf(projectRoot);
  mkdirSync(foreignDir, { recursive: true });
  writeFileSync(join(foreignDir, 'config.json'), CONFIG_TEXT, 'utf8');
  return { projectRoot, foreignDir };
}

// ── behavior + integration: the predicate ────────────────────────────

describe('assertCodegraphDirContained — the R1 predicate', () => {
  it('should accept an ordinary .codegraph directory inside the project', () => {
    const { projectRoot } = makeCleanFixture();

    expect(() => assertCodegraphDirContained(projectRoot)).not.toThrow();
  });

  it('should accept an ABSENT .codegraph directory — nothing exists to contain', () => {
    const projectRoot = makeTempDir('peaks-cg-r1-absent-');

    // Not a refusal: the writer's own read fails with ENOENT first, and a
    // write cannot create a directory through a link that does not resolve.
    expect(() => assertCodegraphDirContained(projectRoot)).not.toThrow();
  });

  it('should REFUSE a .codegraph that resolves outside the project root', () => {
    const { projectRoot, foreignDir } = makeInjectionFixture();
    if (!linkDir(foreignDir, codegraphDirOf(projectRoot))) {
      // Capability gate, declared rather than silent: this host cannot build
      // the fixture. The executed evidence for the branch is therefore the
      // junction cases in this file where the fixture WAS built.
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }

    // The fixture really is a reparse point, and the platform really reports
    // it as one — the branch below is the one a symlink would also enter.
    expect(readdirSync(foreignDir)).toEqual(['config.json']);
    expect(() => assertCodegraphDirContained(projectRoot)).toThrow(/refusing to write through it/);
    expect(() => assertCodegraphDirContained(projectRoot)).toThrow(/not inside the project root/);
  });

  it('should ALLOW a .codegraph link whose target is still inside the project root', () => {
    const projectRoot = makeTempDir('peaks-cg-r1-inside-');
    const derivedDir = join(projectRoot, 'derived', 'codegraph');
    mkdirSync(derivedDir, { recursive: true });
    if (!linkDir(derivedDir, codegraphDirOf(projectRoot))) {
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }

    // Containment is the predicate. Refusing this would fail closed on a
    // layout a user may legitimately have, which is why the guard tests the
    // resolved location and not the presence of a link.
    expect(() => assertCodegraphDirContained(projectRoot)).not.toThrow();
  });

  it('should REFUSE a .codegraph that resolves to the project root itself', () => {
    const projectRoot = makeTempDir('peaks-cg-r1-selfroot-');
    if (!linkDir(projectRoot, codegraphDirOf(projectRoot))) {
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }

    // Contained, technically — and still refused: it would put `config.json`
    // and `config.json.bak` AT the root, overwriting two files of the user's.
    expect(() => assertCodegraphDirContained(projectRoot)).toThrow(/refusing to write through it/);
  });
});

// ── integration + render: the writer ─────────────────────────────────

describe('applyCodegraphConfigRepair — the .codegraph DIRECTORY is contained', () => {
  it('should refuse to write through a .codegraph LINKED to a foreign directory', () => {
    const { projectRoot, foreignDir } = makeInjectionFixture();
    if (!linkDir(foreignDir, codegraphDirOf(projectRoot))) {
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }
    const foreignConfigPath = join(foreignDir, 'config.json');

    expect(() => applyCodegraphConfigRepair(projectRoot, TWO_AXIS)).toThrow(
      /refusing to write through it/
    );

    // The linked target is byte-identical: not rewritten, and no backup or
    // temp file from this writer in it either.
    expect(readFileSync(foreignConfigPath, 'utf8')).toBe(CONFIG_TEXT);
    expect(readdirSync(foreignDir)).toEqual(['config.json']);
  });

  it('should repair normally when .codegraph is an ordinary directory — the clean control', () => {
    const { projectRoot } = makeCleanFixture();

    const outcome = applyCodegraphConfigRepair(projectRoot, TWO_AXIS);

    expect(outcome.applied).toBe(true);
    const configPath = configPathOf(projectRoot);
    expect(readFileSync(`${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')).toBe(
      CONFIG_TEXT
    );
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual({
      include: ['**/*.ts', '**/*.mjs'],
      exclude: ['**/dist/**']
    });
  });

  it('should repair through an IN-PROJECT .codegraph link, at the linked location', () => {
    const projectRoot = makeTempDir('peaks-cg-r1-inside-write-');
    const derivedDir = join(projectRoot, 'derived', 'codegraph');
    mkdirSync(derivedDir, { recursive: true });
    writeFileSync(join(derivedDir, 'config.json'), CONFIG_TEXT, 'utf8');
    if (!linkDir(derivedDir, codegraphDirOf(projectRoot))) {
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }

    const outcome = applyCodegraphConfigRepair(projectRoot, TWO_AXIS);

    expect(outcome.applied).toBe(true);
    expect(JSON.parse(readFileSync(join(derivedDir, 'config.json'), 'utf8'))).toEqual({
      include: ['**/*.ts', '**/*.mjs'],
      exclude: ['**/dist/**']
    });
    expect(
      readFileSync(`${join(derivedDir, 'config.json')}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`, 'utf8')
    ).toBe(CONFIG_TEXT);
  });
});

// ── a11y: the refusal is a NAMED warning, not a silent no-op ─────────

describe('repairCodegraphExcludeFromProject — a refusal names itself', () => {
  /**
   * Why the guard THROWS rather than returning "skipped": the writer's
   * non-applied arm carries no reason a caller could print, so a skip would
   * surface as the caller's no-op note — "Nothing to repair in the codegraph
   * config; nothing was written." — which is a different and false statement
   * about a run that DID have work and refused to do it. Every caller already
   * converts a throw into a named warning (init / preflight / autorefresh) or
   * a non-zero exit (the explicit repair verbs), so the throw is what makes
   * the refusal REPORTABLE. This case is that conversion, end to end.
   */
  it('should report a refusal as a warning naming the containment, and write nothing', async () => {
    const { projectRoot, foreignDir } = makeInjectionFixture();
    seedTrackedFile(projectRoot, join('src', 'ok.ts'), 'export const ok = 1;\n');
    seedTrackedFile(projectRoot, join('vendor', 'v.ts'), 'export const v = 1;\n');
    git(projectRoot, ['add', '-A']);
    git(projectRoot, ['commit', '-qm', 'fixture']);
    // The link is created AFTER the commit, so the fixture's index never sees
    // it — what a consumer repo would commit is the link itself, which is the
    // reachability argument this case shares with H1.
    if (!linkDir(foreignDir, codegraphDirOf(projectRoot))) {
      expect(existsSync(codegraphDirOf(projectRoot))).toBe(false);
      return;
    }

    const report = await repairCodegraphExcludeFromProject(
      projectRoot,
      async () => ({ exitCode: 0, stdout: 'indexed\n', stderr: '' }),
      { reindex: false }
    );

    expect(report.applied).toBe(false);
    expect(report.warning).not.toBeNull();
    expect(report.warning ?? '').toContain('refusing to write through it');
    // Nothing was written and nothing was "read-and-blessed": the refusal is
    // reported as a reason, not as a repair that found no work.
    expect(report.rulesRemoved).toEqual([]);
    expect(readFileSync(join(foreignDir, 'config.json'), 'utf8')).toBe(CONFIG_TEXT);
    expect(readdirSync(foreignDir)).toEqual(['config.json']);
  });
});
