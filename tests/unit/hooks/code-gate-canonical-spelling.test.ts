// tests/unit/hooks/code-gate-canonical-spelling.test.ts
//
// The verdict must depend on WHICH DIRECTORY the file is in, not on HOW the
// path is written. One directory can be named two ways — a symlink, a
// junction, macOS's `/var` → `/private/var` — and the base and the project
// root used to be compared LEXICALLY, so a base spelled one way and a root
// spelled another way compared "outside the project". The gate then fell back
// to reading the path's SPELLING, which never reaches a deny family, and the
// edit was ALLOWED.
//
// The file every row below names is `<real>/src/deep/x.ts`: it is inside
// `src/`, which is hard-blocked, so every row must DENY.
//
// The mismatch is CONSTRUCTED here rather than waited for. The temporary
// directory carries no symlink on Windows or on Linux, so the defect was
// invisible there for a month and only surfaced on macOS CI.
//
// TWO shapes are covered. The first is the base and the root naming ONE
// directory two ways (the macOS shape). The second is the BASE ITSELF being
// a symlink INSIDE the project that points at a hard-blocked directory: the
// call runs in `link/`, `link/` points at `src/`, and the file it writes
// lands in `src/` — so the lexical reading says `link/deep/x.ts` (no family)
// while the canonical one says `src/deep/x.ts` (a family). The verdict is
// the STRICTEST of the two readings, because a wrongly allowed edit is a
// hole in the gate and a wrongly refused one is only an inconvenience.
//
// Dimensions covered:
//   - behavior:   the pure decision, and the base the payload names
//   - integration: the Node command and the shell sibling, on one payload
//   - a11y:       the reason a denial names

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGateAction } from '~/src/services/hooks/pre-tool-code-gate';
import { resolveToolCallBaseDir } from '~/src/services/hooks/hook-payload-cwd';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-canonical-spelling.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'neither gate writes stdout text; the Node command’s JSON envelope belongs to its own suite'
    }
  ]
);

const ROOT = resolve(__dirname, '..', '..', '..');
const HOOK_SCRIPT = resolve(ROOT, 'src', 'services', 'hooks', 'pre-tool-code-gate.sh');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

interface Project {
  /** The temporary directory the case was built in. */
  readonly base: string;
  /** The project directory, spelled the way the filesystem spells it. */
  readonly real: string;
  /** The SAME directory, spelled through a link. */
  readonly link: string;
}

const projects: Project[] = [];

/**
 * A project with a symlink INSIDE it that points at a hard-blocked
 * directory.
 *
 * The link is a JUNCTION on Windows and a symlink on POSIX, like the one
 * above: a junction needs no elevation, so the case runs the same way on
 * every platform.
 */
interface LinkedProject {
  /** The temporary directory the case was built in. */
  readonly base: string;
  /** The project directory, spelled the way the filesystem spells it. */
  readonly real: string;
  /** The junction inside the project, removed before the tree goes. */
  readonly junction: string;
}

const linkedProjects: LinkedProject[] = [];

/**
 * A project directory, and a second spelling of it.
 *
 * The link is a JUNCTION on Windows and a symlink on POSIX: `symlinkSync`
 * reads the type on Windows only, and a junction needs no elevation, so the
 * case runs the same way on every platform.
 */
function makeProject(): Project {
  const base = mkdtempSync(join(tmpdir(), 'peaks-code-gate-canonical-'));
  const real = join(base, 'real');
  mkdirSync(join(real, '.peaks'), { recursive: true });
  writeFileSync(join(real, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(real, 'src', 'deep'), { recursive: true });
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'project' }));
  const link = join(base, 'link');
  symlinkSync(real, link, 'junction');
  const project: Project = { base, real, link };
  projects.push(project);
  return project;
}

/** The directory the call runs in, under the spelling the row names. */
function baseDir(project: Project, spelling: 'real' | 'link'): string {
  return join(spelling === 'real' ? project.real : project.link, 'src');
}

/**
 * A project whose OWN `link` points at its `src/`, so the directory the
 * call runs in is named `link` while the file it lands in lives under
 * `src`. The file every case below names is `<real>/src/deep/x.ts`.
 */
function makeLinkedProject(): LinkedProject {
  const base = mkdtempSync(join(tmpdir(), 'peaks-code-gate-linked-'));
  const real = join(base, 'real');
  mkdirSync(join(real, '.peaks'), { recursive: true });
  writeFileSync(join(real, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(real, 'src', 'deep'), { recursive: true });
  writeFileSync(join(real, 'src', 'deep', 'x.ts'), 'x');
  mkdirSync(join(real, 'docs'), { recursive: true });
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'project' }));
  const junction = join(real, 'link');
  symlinkSync(join(real, 'src'), junction, 'junction');
  const project: LinkedProject = { base, real, junction };
  linkedProjects.push(project);
  return project;
}

/**
 * A project whose `src` is a symlink to `shared/src` — the monorepo shape.
 *
 * The LEXICAL reading of `x.ts` is `src/x.ts` (a family) and the CANONICAL
 * one is `shared/src/x.ts` (no family). The verdict must not get LOOSER, so
 * the lexical reading stands and the file is denied.
 */
function makeMonorepoProject(): LinkedProject {
  const base = mkdtempSync(join(tmpdir(), 'peaks-code-gate-monorepo-'));
  const real = join(base, 'real');
  mkdirSync(join(real, '.peaks'), { recursive: true });
  writeFileSync(join(real, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  mkdirSync(join(real, 'shared', 'src'), { recursive: true });
  writeFileSync(join(real, 'shared', 'src', 'x.ts'), 'x');
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'project' }));
  const junction = join(real, 'src');
  symlinkSync(join(real, 'shared', 'src'), junction, 'junction');
  const project: LinkedProject = { base, real, junction };
  linkedProjects.push(project);
  return project;
}

/** The project root, under the spelling the row names. */
function rootDir(project: Project, spelling: 'real' | 'link'): string {
  return spelling === 'real' ? project.real : project.link;
}

/**
 * The two spellings of the ONE project directory, crossed with the two
 * spellings of the directory the call runs in. The first two rows agree and
 * the last two do not; the last two are the defect.
 */
const SPELLING_ROWS: ReadonlyArray<{ root: 'real' | 'link'; base: 'real' | 'link' }> = [
  { root: 'real', base: 'real' },
  { root: 'link', base: 'link' },
  { root: 'link', base: 'real' },
  { root: 'real', base: 'link' }
];

/** A tool call naming a path, and optionally the directory it runs in. */
function payload(filePath: string, cwd?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd })
  });
}

/** The Node command, run in the directory the call runs in. */
function runCodeGate(
  root: string,
  stdin: string,
  cwd: string
): { status: number | null; stdout: string } {
  const run = spawnSync(
    process.execPath,
    [
      join(ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--dry-run',
      '--json'
    ],
    { cwd, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

/** The shell sibling, run in the directory the call runs in. */
function runShellSibling(stdin: string, cwd: string): { status: number | null; stderr: string } {
  const run = spawnSync('bash', [HOOK_SCRIPT], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    input: stdin
  });
  return { status: run.status, stderr: run.stderr ?? '' };
}

/** The verdict the Node command reached. */
function nodeVerdict(stdout: string): 'deny' | 'allow' {
  return stdout.includes('"action": "deny"') ? 'deny' : 'allow';
}

/** The verdict the shell sibling reached. */
function shellVerdict(status: number | null): 'deny' | 'allow' {
  return status === 2 ? 'deny' : 'allow';
}

afterEach(() => {
  while (projects.length > 0) {
    const project = projects.pop();
    if (project === undefined) continue;
    // The link is UNLINKED on its own first: a recursive remove that walks a
    // link can follow it to the directory it names.
    unlinkSync(project.link);
    rmSync(project.base, { recursive: true, force: true });
  }
  while (linkedProjects.length > 0) {
    const project = linkedProjects.pop();
    if (project === undefined) continue;
    unlinkSync(project.junction);
    rmSync(project.base, { recursive: true, force: true });
  }
});

describe('behavior — the verdict does not depend on the spelling', () => {
  it('when the root and the base name one directory two ways, should deny the file it lands in', () => {
    // given: one project directory, named two ways, holding a file in `src/`
    // when: the verdict is taken with each spelling of the root and of the base
    // then: every row denies, because the file is inside the `src/` family
    const project = makeProject();

    for (const row of SPELLING_ROWS) {
      const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
        projectRoot: rootDir(project, row.root),
        toolCwd: baseDir(project, row.base)
      });

      expect(verdict.action, `root: ${row.root}, base: ${row.base}`).toBe('deny');
      if (verdict.action !== 'deny') continue;
      expect(verdict.reason, `root: ${row.root}, base: ${row.base}`).toContain('src/');
    }
  });

  it('when the payload names the project directory by the other spelling, should use it as the base', () => {
    // given: one project directory, named two ways
    // when: the base a relative path is read against is resolved from a
    //   payload that names that directory by the other spelling
    // then: that directory is the base — it really is inside the project
    const project = makeProject();

    expect(
      resolveToolCallBaseDir({ cwd: baseDir(project, 'link') }, project.real, project.real)
    ).toBe(baseDir(project, 'link'));
    expect(
      resolveToolCallBaseDir({ cwd: baseDir(project, 'real') }, project.link, project.link)
    ).toBe(baseDir(project, 'real'));
  });
});

describe('behavior — the base is a symlink inside the project', () => {
  it('when the base points at a hard-blocked directory, should deny the file it lands in', () => {
    // given: a project whose own `link` points at its `src/`
    // when: the call runs in `link` and writes `deep/x.ts`
    // then: the verdict denies, because the file really lands in `src/`
    const project = makeLinkedProject();

    const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: project.junction
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
  });

  it('when the same file is named by its absolute path through the link, should deny it too', () => {
    // given: the same project
    // when: the same file is named by the ABSOLUTE path spelled through the
    //   link
    // then: the verdict denies — it is one file, spelled two ways
    const project = makeLinkedProject();

    const verdict = decideGateAction(
      'Edit',
      { file_path: join(project.junction, 'deep', 'x.ts') },
      null,
      { projectRoot: project.real, toolCwd: project.junction }
    );

    expect(verdict.action).toBe('deny');
  });

  it('when the canonical reading names no family, should keep the deny the lexical one gives', () => {
    // given: a project whose `src` is a symlink to `shared/src`
    // when: the call runs in `src` and writes `x.ts`
    // then: the verdict still denies — the canonical reading names no
    //   family, and the verdict must never get LOOSER
    const project = makeMonorepoProject();

    const verdict = decideGateAction('Edit', { file_path: 'x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: project.junction
    });

    expect(verdict.action).toBe('deny');
  });
});

describe('integration — the command the hook runs', () => {
  it(
    'when the command runs with a mismatched spelling, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: one project directory, named two ways
      // when: the command is run with one spelling as the project and the
      //   other as the directory the call runs in
      // then: every row denies, because the file the call writes is in `src/`
      const project = makeProject();

      for (const row of SPELLING_ROWS) {
        const { stdout } = runCodeGate(
          rootDir(project, row.root),
          payload('deep/x.ts'),
          baseDir(project, row.base)
        );

        expect(nodeVerdict(stdout), `root: ${row.root}, base: ${row.base}`).toBe('deny');
      }
    }
  );

  it(
    'when the payload states the directory under the other spelling, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: one project directory, named two ways, and a payload whose
      //   top-level `cwd` names the directory the call runs in
      // when: the command is run from the project root, so the gate's OWN
      //   working directory would land the file OUTSIDE any family
      // then: the verdict still denies, because the stated directory really
      //   is inside the project and the file lands in its `src/`
      const project = makeProject();

      for (const row of SPELLING_ROWS) {
        const { stdout } = runCodeGate(
          rootDir(project, row.root),
          payload('deep/x.ts', baseDir(project, row.base)),
          rootDir(project, row.root)
        );

        expect(nodeVerdict(stdout), `root: ${row.root}, base: ${row.base}`).toBe('deny');
      }
    }
  );

  it(
    'when the two gates are given the same mismatched payload, should reach the same verdict',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: one project directory, named two ways
      // when: the Node command and the shell sibling are both given the
      //   payload, from the directory the call runs in
      // then: both deny it, and name the family
      const project = makeProject();

      for (const row of SPELLING_ROWS) {
        const stdin = payload('deep/x.ts', baseDir(project, row.base));
        const cli = runCodeGate(rootDir(project, row.root), stdin, baseDir(project, row.base));
        const shell = runShellSibling(stdin, baseDir(project, row.base));

        expect(nodeVerdict(cli.stdout), `node: root ${row.root}, base ${row.base}`).toBe('deny');
        expect(shellVerdict(shell.status), `shell: root ${row.root}, base ${row.base}`).toBe(
          'deny'
        );
        expect(shell.stderr, `shell: root ${row.root}, base ${row.base}`).toContain('src/');
      }
    }
  );
});

describe('integration — the command the hook runs in a symlinked base', () => {
  it(
    'when the command runs in a junction that points at a hard-blocked directory, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a project whose own `link` points at its `src/`
      // when: the command runs IN that directory, so the file the call
      //   writes lands in `src/`
      // then: the command denies it
      const project = makeLinkedProject();

      const { stdout } = runCodeGate(project.real, payload('deep/x.ts'), project.junction);

      expect(nodeVerdict(stdout)).toBe('deny');
    }
  );

  it(
    'when the payload states a junction that points at a hard-blocked directory, should deny the file it lands in',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same project
      // when: the command runs from the project root and the payload states
      //   the directory the call runs in
      // then: the command denies it — the stated directory really is inside
      //   the project and the file lands in its `src/`
      const project = makeLinkedProject();

      const { stdout } = runCodeGate(
        project.real,
        payload('deep/x.ts', project.junction),
        project.real
      );

      expect(nodeVerdict(stdout)).toBe('deny');
    }
  );
});

describe('a11y — the reason a denial names the family', () => {
  it('when the root and the base are spelled differently, should name the family anyway', () => {
    // given: one project directory, named two ways
    // when: the verdict denies the file the call lands in
    // then: the reason names the `src/` family and the message names the file
    const project = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
      projectRoot: project.link,
      toolCwd: baseDir(project, 'real')
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });
});
