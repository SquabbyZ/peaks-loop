// tests/unit/hooks/code-gate-qa-final-verification.test.ts
//
// The final independent QA pass over rid `2026-10-22-code-gate-relative-base`.
//
// The three suites this slice ships (`code-gate-relative-base`,
// `code-gate-relative-base-shell`, `code-gate-canonical-spelling`) are the
// ACCEPTANCE INSTRUMENT: they are what the slice is judged by, and QA does not
// edit them. This file is QA's own, and it pins the shapes the shipped suites
// leave open — the ones the code review recorded as LOW 4:
//
//   (a) the base is a junction inside the project that points OUTSIDE it
//       (the divergence the security audit records as a new false deny)
//   (b) the base is a directory that is NOT a hard-blocked family, and the
//       spelling NAMES a family (the direction that moved deny -> allow)
//   (c) an ABSOLUTE path inside the project (the recorded §19.2 divergence)
//
// and the macOS shape, CONSTRUCTED rather than waited for: one directory named
// two ways must reach one verdict.
//
// Dimensions covered:
//   - behavior:   the pure decision, over the shapes above
//   - integration: the shell sibling, spawned with a payload
//   - a11y:       the reason a denial names
//
// This is a construction of the same shape macOS CI produced — a directory
// named two ways — NOT a macOS run. The host here is Windows.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { decideGateAction } from '~/src/services/hooks/pre-tool-code-gate';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/hooks/code-gate-qa-final-verification.test.ts',
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
  /** The SAME directory, spelled through a junction. */
  readonly alias: string;
  /** A junction INSIDE the project that points OUTSIDE it. */
  readonly outward: string;
}

const projects: Project[] = [];

function makeProject(): Project {
  const base = mkdtempSync(join(tmpdir(), 'peaks-qa-final-'));
  const real = join(base, 'real');
  mkdirSync(join(real, '.peaks'), { recursive: true });
  writeFileSync(join(real, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  writeFileSync(join(real, 'package.json'), JSON.stringify({ name: 'project' }));
  for (const dir of ['src/deep', 'docs', 'other']) {
    mkdirSync(join(real, dir), { recursive: true });
  }
  writeFileSync(join(real, 'src', 'deep', 'x.ts'), 'x');
  writeFileSync(join(real, 'docs', 'x.ts'), 'x');
  // A directory OUTSIDE the project, holding a `src/` of its own.
  const outside = join(base, 'outside');
  mkdirSync(join(outside, 'src'), { recursive: true });
  writeFileSync(join(outside, 'src', 'x.ts'), 'x');
  const alias = join(base, 'alias');
  symlinkSync(real, alias, 'junction');
  const outward = join(real, 'outward');
  symlinkSync(outside, outward, 'junction');
  const project: Project = { base, real, alias, outward };
  projects.push(project);
  return project;
}

function payload(filePath: string, cwd?: string): string {
  return JSON.stringify({
    tool: 'Edit',
    input: { file_path: filePath },
    ...(cwd === undefined ? {} : { cwd })
  });
}

function runShell(stdin: string, cwd: string): { status: number | null; stderr: string } {
  const run = spawnSync('bash', [HOOK_SCRIPT], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    input: stdin
  });
  return { status: run.status, stderr: run.stderr ?? '' };
}

function shellVerdict(status: number | null): 'deny' | 'allow' {
  return status === 2 ? 'deny' : 'allow';
}

afterEach(() => {
  while (projects.length > 0) {
    const project = projects.pop();
    if (project === undefined) continue;
    unlinkSync(project.alias);
    unlinkSync(project.outward);
    rmSync(project.base, { recursive: true, force: true });
  }
});

describe('behavior — the verdict follows the directory, not the spelling', () => {
  it('when one directory is named two ways, should reach one verdict on every spelling', () => {
    // given: one project directory, named two ways, holding a file in `src/`
    // when: the verdict is taken with each spelling of the root and of the base
    // then: every row denies, because the file is inside the `src/` family
    const project = makeProject();

    const spellings: ReadonlyArray<{ root: string; base: string }> = [
      { root: project.real, base: join(project.real, 'src') },
      { root: project.alias, base: join(project.alias, 'src') },
      { root: project.alias, base: join(project.real, 'src') },
      { root: project.real, base: join(project.alias, 'src') }
    ];

    for (const row of spellings) {
      const verdict = decideGateAction('Edit', { file_path: 'deep/x.ts' }, null, {
        projectRoot: row.root,
        toolCwd: row.base
      });

      expect(verdict.action, `root: ${row.root}, base: ${row.base}`).toBe('deny');
    }
  });

  it('when the base is a directory that is not a family, should allow a spelling that names one', () => {
    // given: the base is `<root>/docs`, a directory that is not a family
    // when: the spelling NAMES a family (`src/x.ts`)
    // then: the verdict allows — the file lands at `docs/src/x.ts`, which is
    //   outside every hard-blocked family, and the ruling says the verdict
    //   follows the file rather than the spelling
    const project = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'src/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: join(project.real, 'docs')
    });

    expect(verdict.action).toBe('allow');
  });

  it('when the base is a junction pointing outside the project, should allow the file that lands outside it', () => {
    // given: the base is a junction INSIDE the project that points outside it
    // when: the spelling names a family (`src/x.ts`)
    // then: the verdict allows — the file really lands outside the project,
    //   outside every family, so no blocked file is reachable
    const project = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'src/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: project.outward
    });

    expect(verdict.action).toBe('allow');
  });

  it('when the spelling is a `./`-doubled echo, should deny the file it lands in', () => {
    // given: the call runs in the project root
    // when: the spelling is `.//src/x.ts`
    // then: the verdict denies — the strip of the leading `./` must not turn
    //   the spelling into an absolute one
    const project = makeProject();

    const verdict = decideGateAction('Edit', { file_path: './/src/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: project.real
    });

    expect(verdict.action).toBe('deny');
  });
});

describe('integration — the shell sibling on the recorded shapes', () => {
  it('when the spelling is a `./`-doubled echo, should deny it too', () => {
    // given: the call runs in the project root
    // when: the sibling is spawned with the spelling `.//src/x.ts`
    // then: the sibling denies — the two gates agree on that shape
    const project = makeProject();

    const run = runShell(payload('.//src/x.ts'), project.real);

    expect(shellVerdict(run.status)).toBe('deny');
  });

  it('when the path is absolute and inside the project, should deny it while the sibling allows it', () => {
    // given: the project, and a path that names a file inside `src/`
    // when: the file is named by its ABSOLUTE path
    // then: the Node command denies it and the sibling allows it — the
    //   recorded divergence, which the sibling cannot close because it has no
    //   project root in the payload's own spelling (§19.2)
    const project = makeProject();
    const absolute = join(project.real, 'src', 'deep', 'x.ts');

    const verdict = decideGateAction('Edit', { file_path: absolute }, null, {
      projectRoot: project.real,
      toolCwd: project.real
    });
    const run = runShell(payload(absolute), project.real);

    expect(verdict.action).toBe('deny');
    expect(shellVerdict(run.status)).toBe('allow');
  });

  it('when the base is a directory that is not a family, should agree with the Node command', () => {
    // given: the base is `<root>/docs`, and the spelling names a family
    // when: both gates are given the same payload, from that base
    // then: both allow — the direction that moved deny to allow is pinned
    //   here, so it cannot move again unnoticed
    const project = makeProject();
    const base = join(project.real, 'docs');

    const verdict = decideGateAction('Edit', { file_path: 'src/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: base
    });
    const run = runShell(payload('src/x.ts'), base);

    expect(verdict.action).toBe('allow');
    expect(shellVerdict(run.status)).toBe('allow');
  });
});

describe('a11y — the reason a denial names', () => {
  it('when the spelling names a family, should name the family and the file', () => {
    // given: the call runs in the project root
    // when: the spelling names the `src/` family
    // then: the reason names the family and the message names the file and
    //   the refusal code
    const project = makeProject();

    const verdict = decideGateAction('Edit', { file_path: 'src/deep/x.ts' }, null, {
      projectRoot: project.real,
      toolCwd: project.real
    });

    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    expect(verdict.filePath).toBe('src/deep/x.ts');
  });
});
