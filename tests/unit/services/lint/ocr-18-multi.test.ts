import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectLanguages, runOcr18Multi } from '../../../../src/services/lint/ocr-18-multi.js';

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

/**
 * The npx resolver is mocked to a sentinel so the regression this guards —
 * spawning the bare `npx` PATH shim instead of the resolved invocation — is
 * observable on every platform, not only on Windows.
 */
const { SENTINEL_COMMAND, SENTINEL_PREFIX } = vi.hoisted(() => ({
  SENTINEL_COMMAND: '/sentinel/node',
  SENTINEL_PREFIX: ['/sentinel/npx-cli.js']
}));

vi.mock('../../../../src/services/lint/npx-resolver.js', () => ({
  resolveNpxInvocation: (npxArgs: readonly string[]) => ({
    command: SENTINEL_COMMAND,
    args: [...SENTINEL_PREFIX, ...npxArgs],
    baseEnv: {}
  }),
  resolveNpmInvocation: (npmArgs: readonly string[]) => ({
    command: SENTINEL_COMMAND,
    args: [...SENTINEL_PREFIX, ...npmArgs],
    baseEnv: {}
  })
}));

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr?: string;
  signal?: NodeJS.Signals;
  error?: NodeJS.ErrnoException;
};

type GitResult = {
  status?: number | null;
  stdout?: string;
  stderr?: string;
  error?: NodeJS.ErrnoException;
};

/**
 * The adapter spawns BOTH `git` (language detection) and the resolved npx
 * invocation (the review). Routing by command keeps the spawn COUNT meaningful:
 * AC-3 is about review invocations, not about how detection was implemented.
 */
function routeSpawn(options: { git?: GitResult[]; ocr?: SpawnResult[] } = {}): void {
  const gitQueue = [...(options.git ?? [])];
  const ocrQueue = [...(options.ocr ?? [])];
  childMock.spawnSync.mockImplementation((command: unknown) => {
    if (command === 'git') {
      const next = gitQueue.shift() ?? {};
      return {
        status: next.status ?? 0,
        stdout: next.stdout ?? '',
        stderr: next.stderr ?? '',
        ...(next.error !== undefined ? { error: next.error } : {})
      };
    }
    return ocrQueue.shift() ?? { status: 0, stdout: '{"comments":[]}', stderr: '' };
  });
}

/** The argv of the first spawn of a kind; `[]` when there was none. */
function firstArgs(spawns: Array<[unknown, string[], Record<string, unknown>]>): string[] {
  return spawns[0]?.[1] ?? [];
}

function spawnsOf(command: string): Array<[unknown, string[], Record<string, unknown>]> {
  return (
    childMock.spawnSync.mock.calls as Array<[unknown, string[], Record<string, unknown>]>
  ).filter((call) => (command === 'git' ? call[0] === 'git' : call[0] !== 'git'));
}

const ocrSpawns = (): Array<[unknown, string[], Record<string, unknown>]> => spawnsOf('ocr');
const gitSpawns = (): Array<[unknown, string[], Record<string, unknown>]> => spawnsOf('git');

function comment(path: string, severity = 'high') {
  return {
    path,
    content: `issue in ${path}`,
    start_line: 1,
    end_line: 1,
    severity,
    category: 'bug'
  };
}

describe('detectLanguages', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  it('when a from/to range is given, should diff it and route each extension', () => {
    // given: a range touching two routed languages, one unsupported code format,
    // and one non-code file
    routeSpawn({ git: [{ stdout: 'src/a.py\nsrc/b.go\nsrc/c.mts\nREADME.md\nsrc/d.ts\n' }] });

    // when: the range is detected
    const detection = detectLanguages(process.cwd(), { from: 'main', to: 'HEAD' });

    // then: the diff is read with the requested range …
    expect(firstArgs(gitSpawns())).toEqual([
      'diff',
      '--name-only',
      '--diff-filter=ACMR',
      'main',
      'HEAD',
      '--'
    ]);
    // … and extensions map to languages, while everything else stays visible
    expect(detection.languages).toEqual(['go', 'python', 'typescript']);
    expect(detection.changedFileCount).toBe(5);
    expect(detection.unsupportedFiles).toEqual(['src/c.mts', 'README.md']);
  });

  it('when a ref is option-shaped, should refuse it before spawning git', () => {
    // given: a "ref" that would be read by git as a flag
    routeSpawn({ git: [{ stdout: 'src/a.py\n' }] });

    // when: detection runs
    // then: no valid revision starts with '-', so it is refused at the boundary
    expect(() => detectLanguages(process.cwd(), { from: '--output=/tmp/injected' })).toThrow(
      /invalid --from value/
    );
    expect(gitSpawns()).toHaveLength(0);
  });

  it('when no range is given, should read the workspace including untracked files', () => {
    // given: one tracked change against HEAD and one untracked source file
    routeSpawn({ git: [{ stdout: 'src/a.py\n' }, { stdout: 'src/new.go\n' }] });

    // when: the workspace is detected
    const detection = detectLanguages(process.cwd());

    // then: both halves are read — a new file is about to be reviewed too
    expect(gitSpawns().map((call) => call[1][0])).toEqual(['diff', 'ls-files']);
    expect(detection.languages).toEqual(['go', 'python']);
  });

  it('when a commit is given, should read that commit’s own diff', () => {
    // given: a single commit
    routeSpawn({ git: [{ stdout: 'src/a.java\n' }] });

    // when: it is detected
    const detection = detectLanguages(process.cwd(), { commit: 'abc123' });

    // then: `git show` is that review's exact diff, and it works for a root commit
    expect(firstArgs(gitSpawns())).toEqual([
      'show',
      '--pretty=format:',
      '--name-only',
      '--diff-filter=ACMR',
      'abc123'
    ]);
    expect(detection.languages).toEqual(['java']);
  });

  it('when git cannot answer, should throw instead of reporting nothing to review', () => {
    // given: a directory git refuses to read
    routeSpawn({ git: [{ status: 128, stderr: 'fatal: not a git repository' }] });

    // when: detection runs
    // then: the caller is told why, rather than being handed an empty range
    expect(() => detectLanguages(process.cwd(), { from: 'main' })).toThrow(/not a git repository/);
  });
});

describe('runOcr18Multi', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  it('when a change spans Python and Go, should spawn ocr exactly once (AC-3)', () => {
    // given: a Python+Go range whose review returns one finding per language
    routeSpawn({
      git: [{ stdout: 'src/a.py\nsrc/b.go\n' }],
      ocr: [
        {
          status: 0,
          stdout: JSON.stringify({
            status: 'success',
            comments: [comment('src/a.py', 'critical'), comment('src/b.go', 'low')]
          })
        }
      ]
    });

    // when: the multi-language review runs
    const result = runOcr18Multi({ cwd: process.cwd(), from: 'main', to: 'HEAD' });

    // then: ONE review covered both languages — two would cost two full reviews
    expect(ocrSpawns()).toHaveLength(1);
    expect(firstArgs(ocrSpawns())).toEqual(
      expect.arrayContaining(['review', '--from', 'main', '--to', 'HEAD', '--format', 'json'])
    );
    // then: no language flag is emitted — the real binary has none
    expect(firstArgs(ocrSpawns())).not.toContain('--filter-language');
    // then: findings are grouped per language with a count
    expect(result.state).toBe('ok');
    expect(result.detected).toEqual(['go', 'python']);
    expect(Object.fromEntries(result.languages.map((r) => [r.language, r.count]))).toEqual({
      go: 1,
      python: 1
    });
    expect(result.summary?.total).toBe(2);
    expect(result.summary?.byLanguage.go).toBe(1);
    expect(result.summary?.byLanguage.python).toBe(1);
  });

  it('should keep the four outcomes distinguishable (AC-4)', () => {
    // given: one range holding a language with findings, a language that is
    // clean, and a file the CLI does not review as a routed language
    routeSpawn({
      git: [{ stdout: 'src/a.py\nsrc/b.go\nsrc/c.mts\n' }],
      ocr: [
        {
          status: 0,
          stdout: JSON.stringify({ status: 'success', comments: [comment('src/a.py')] })
        }
      ]
    });

    // when: it is reviewed
    const mixed = runOcr18Multi({ cwd: process.cwd(), from: 'main', to: 'HEAD' });

    // then: (1) findings and (2) a clean zero are different reports …
    const python = mixed.languages.find((report) => report.language === 'python');
    const go = mixed.languages.find((report) => report.language === 'go');
    expect(python?.count).toBe(1);
    expect(python?.findings).toHaveLength(1);
    expect(go?.count).toBe(0);
    expect(go?.findings).toEqual([]);
    // … (3) an unreviewable file is its own field, not a zero …
    expect(mixed.unsupportedFiles).toEqual(['src/c.mts']);

    // … (4) and "never ran" carries neither a report nor a zero to mistake for
    // a clean review
    routeSpawn({
      git: [{ stdout: 'src/a.py\n' }],
      ocr: [
        {
          status: null,
          stdout: '',
          error: Object.assign(new Error('spawn npx ENOENT'), {
            code: 'ENOENT'
          } as NodeJS.ErrnoException)
        }
      ]
    });
    const unavailable = runOcr18Multi({ cwd: process.cwd() });
    expect(unavailable.state).toBe('ocr18-missing');
    expect(unavailable.languages).toEqual([]);
    expect(unavailable.summary).toBeNull();

    // then: no two shapes collapse into the same one — they differ by the field
    // that carries the outcome (count / unsupportedFiles / state)
    expect([mixed.state, python?.count, go?.count]).toEqual(['ok', 1, 0]);
    expect(mixed.unsupportedFiles).toHaveLength(1);
    expect(unavailable.state).not.toBe(mixed.state);
    expect(unavailable.languages).toHaveLength(0);
  });

  it('when the range has no routed language, should skip the invocation and say so', () => {
    // given: a docs-only change plus an unsupported code extension
    routeSpawn({ git: [{ stdout: 'README.md\nsrc/a.mts\nsrc/b.yaml\n' }] });

    // when: it is reviewed
    const result = runOcr18Multi({ cwd: process.cwd() });

    // then: no OCR process was spawned to discover there is nothing to review
    expect(ocrSpawns()).toHaveLength(0);
    // then: the state says so, and the files are still accounted for
    expect(result.state).toBe('no-routed-language');
    expect(result.detected).toEqual([]);
    expect(result.languages).toEqual([]);
    expect(result.summary).toBeNull();
    expect(result.unsupportedFiles).toEqual(['README.md', 'src/a.mts', 'src/b.yaml']);
    expect(result.changedFileCount).toBe(3);
  });

  it('when an explicit list names a language the diff does not touch, should report it as a clean zero', () => {
    // given: a Python-only range, reviewed for Java explicitly
    routeSpawn({
      git: [{ stdout: 'src/a.py\n' }],
      ocr: [{ status: 0, stdout: '{"comments":[]}' }]
    });

    // when: the multi review runs
    const result = runOcr18Multi({ cwd: process.cwd(), languages: ['java'] });

    // then: one review ran (the diff had a routed language) …
    expect(ocrSpawns()).toHaveLength(1);
    // … the detected set is separate from the requested one …
    expect(result.detected).toEqual(['python']);
    // … and the requested language is a visible zero, not an absence
    expect(result.languages).toEqual([{ language: 'java', findings: [], count: 0 }]);
  });

  it('when a comment lands on an unrouted format, should report it rather than drop it', () => {
    // given: a review that flags a YAML file alongside the Python change
    routeSpawn({
      git: [{ stdout: 'src/a.py\n' }],
      ocr: [
        {
          status: 0,
          stdout: JSON.stringify({
            status: 'success',
            comments: [comment('src/a.py'), comment('config/app.yaml')]
          })
        }
      ]
    });

    // when: the multi review runs
    const result = runOcr18Multi({ cwd: process.cwd() });

    // then: the YAML finding is kept, attributed to nothing
    expect(result.unroutedFindings.map((finding) => finding.filePath)).toEqual(['config/app.yaml']);
    expect(result.languages.find((report) => report.language === 'python')?.count).toBe(1);
    expect(result.summary?.total).toBe(1);
  });

  it('when stdout is not JSON, should report execution-failed and keep the output', () => {
    // given: an unparseable review payload
    routeSpawn({ git: [{ stdout: 'src/a.py\n' }], ocr: [{ status: 0, stdout: 'boom' }] });

    // when: the multi review runs
    const result = runOcr18Multi({ cwd: process.cwd() });

    // then: the failure is visible, with nothing that could read as a zero
    expect(result.state).toBe('execution-failed');
    expect(result.languages).toEqual([]);
    expect(result.summary).toBeNull();
    expect(result.rawOutput).toContain('boom');
  });
});
