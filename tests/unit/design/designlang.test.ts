import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/design/designlang.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

import {
  buildDesignlangArgs,
  parseDesignlangEvidence,
  readGradeEvidence,
  runDesignlang
} from '../../../src/services/design/designlang.js';

import { isAlive } from './_fake-designlang.js';

const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-designlang-'));
const jsonScript = join(projectRoot, 'json.mjs');
const exitScript = join(projectRoot, 'exit.mjs');
const hangScript = join(projectRoot, 'hang.mjs');
const treeScript = join(projectRoot, 'tree.mjs');
const grandchildScript = join(projectRoot, 'grandchild.mjs');

/** Every child pid the tests learned about, so a failing test still reaps it. */
const pids: number[] = [];

beforeAll(() => {
  writeFileSync(
    jsonScript,
    [
      "process.stdout.write(JSON.stringify({ url: 'http://127.0.0.1:4321/', generatedAt: '2026-11-23T00:00:00.000Z' }));",
      'process.exit(0);'
    ].join('\n')
  );
  writeFileSync(
    exitScript,
    [
      "process.stdout.write('partial output');",
      "process.stderr.write('extraction failed');",
      'process.exit(1);'
    ].join('\n')
  );
  writeFileSync(
    hangScript,
    [
      "import { writeFileSync } from 'node:fs';",
      'const [pidFile] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'setInterval(() => {}, 1000);'
    ].join('\n')
  );
  writeFileSync(
    grandchildScript,
    [
      "import { writeFileSync } from 'node:fs';",
      'const [pidFile] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'setInterval(() => {}, 1000);'
    ].join('\n')
  );
  writeFileSync(
    treeScript,
    [
      "import { spawn } from 'node:child_process';",
      "import { writeFileSync } from 'node:fs';",
      'const [pidFile, grandPidFile, grandScript] = process.argv.slice(2);',
      'writeFileSync(pidFile, String(process.pid));',
      'spawn(process.execPath, [grandScript, grandPidFile], {',
      '  stdio: "ignore",',
      // Windows: a detached grandchild escapes the runner's job object, which is
      // exactly the orphan `taskkill /T` exists to reap. POSIX: keeping it in the
      // child's process group is what the group kill reaps.
      '  detached: process.platform === "win32"',
      '});',
      'setInterval(() => {}, 1000);'
    ].join('\n')
  );
});

afterEach(() => {
  for (const pid of pids.splice(0)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // It exited between the probe and the signal.
    }
  }
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function sleep(ms: number): Promise<void> {
  return new Promise((settle) => {
    setTimeout(settle, ms);
  });
}

/** Poll a predicate until it holds, or fail with the last observed state. */
async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error('condition was not met before the timeout');
}

describe('Scenario: render — the designlang argument vectors', () => {
  it('when drift is requested, should pass the page, tokens, and json flag', () => {
    // given: a loopback URL and a local tokens file
    // when: the drift arguments are built
    // then: the vector matches the measured `designlang drift` surface
    const args = buildDesignlangArgs({
      kind: 'drift',
      url: 'http://127.0.0.1:4321/',
      tokensPath: '/t/design-tokens.json'
    });
    expect(args).toEqual([
      'drift',
      'http://127.0.0.1:4321/',
      '--tokens',
      '/t/design-tokens.json',
      '--json'
    ]);
  });

  it('when verify-ui is requested, should pass the page, brand, and json flag', () => {
    // given: a loopback URL and a local brand file
    // when: the verify-ui arguments are built
    // then: the vector matches the measured `designlang verify-ui` surface
    const args = buildDesignlangArgs({
      kind: 'verify-ui',
      url: 'http://127.0.0.1:4321/',
      brandPath: '/t/DESIGN.md'
    });
    expect(args).toEqual([
      'verify-ui',
      'http://127.0.0.1:4321/',
      '--brand',
      '/t/DESIGN.md',
      '--json'
    ]);
  });

  it('when slop is requested, should add --brand only when a brand is supplied', () => {
    // given: slop calls with and without a brand file
    // when: the slop arguments are built
    // then: the bare vector omits --brand and the branded one carries it
    expect(buildDesignlangArgs({ kind: 'slop', url: 'http://127.0.0.1:4321/' })).toEqual([
      'slop',
      'http://127.0.0.1:4321/',
      '--json'
    ]);
    expect(
      buildDesignlangArgs({
        kind: 'slop',
        url: 'http://127.0.0.1:4321/',
        brandPath: '/t/DESIGN.md'
      })
    ).toEqual(['slop', 'http://127.0.0.1:4321/', '--brand', '/t/DESIGN.md', '--json']);
  });

  it('when grade is requested, should select json and name the output directory', () => {
    // given: a loopback URL and an output directory
    // when: the grade arguments are built
    // then: the vector selects the written json report, not stdout
    const args = buildDesignlangArgs({
      kind: 'grade',
      url: 'http://127.0.0.1:4321/',
      outDir: '/t/grade-out'
    });
    expect(args).toEqual([
      'grade',
      'http://127.0.0.1:4321/',
      '--format',
      'json',
      '--out',
      '/t/grade-out'
    ]);
  });

  it('when stats is requested, should ask for the json variant of the page read', () => {
    // given: a loopback URL
    // when: the stats arguments are built
    // then: the vector matches the `designlang stats --as-json` surface the spike ran
    const args = buildDesignlangArgs({ kind: 'stats', url: 'http://127.0.0.1:4321/' });
    expect(args).toEqual(['stats', 'http://127.0.0.1:4321/', '--as-json']);
  });

  it('when the probe capture is requested, should split identity JSON from the screenshot', () => {
    // given: a loopback URL and one output directory
    // when: the identity and screenshot argument vectors are built
    // then: neither run combines `--json` with `--screenshots` (round 4 overran 120 s)
    const identity = buildDesignlangArgs({
      kind: 'extract',
      url: 'http://127.0.0.1:4321/',
      outDir: '/t/probe'
    });
    expect(identity).toEqual([
      'http://127.0.0.1:4321/',
      '--json',
      '--no-history',
      '-o',
      '/t/probe',
      '--quiet'
    ]);
    const screenshot = buildDesignlangArgs({
      kind: 'screenshots',
      url: 'http://127.0.0.1:4321/',
      outDir: '/t/probe'
    });
    expect(screenshot).toEqual([
      'http://127.0.0.1:4321/',
      '--screenshots',
      '--no-history',
      '-o',
      '/t/probe',
      '--quiet'
    ]);
    expect(identity).not.toContain('--screenshots');
    expect(screenshot).not.toContain('--json');
  });

  it('when any subcommand is built, should never force the system-chrome channel', () => {
    // given: every check kind the adapter wraps
    // when: each argument vector is built
    // then: `--system-chrome` (an extract-root-only flag per the spike) is absent
    const vectors = [
      buildDesignlangArgs({ kind: 'drift', url: 'u', tokensPath: 't' }),
      buildDesignlangArgs({ kind: 'verify-ui', url: 'u', brandPath: 'b' }),
      buildDesignlangArgs({ kind: 'slop', url: 'u' }),
      buildDesignlangArgs({ kind: 'grade', url: 'u', outDir: 'o' }),
      buildDesignlangArgs({ kind: 'stats', url: 'u' })
    ];
    for (const vector of vectors) {
      expect(vector).not.toContain('--system-chrome');
    }
  });
});

describe('Scenario: integration — spawning the entry and reading grade output', () => {
  it(
    'when the entry prints json and exits 0, should capture stdout and the exit code',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a temp .mjs entry that prints one JSON document
      // when: it is spawned through the adapter
      // then: stdout is captured whole and the run is not marked timed out
      const result = await runDesignlang({ entryPath: jsonScript, args: [] });
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(JSON.parse(result.stdout.trim())).toEqual({
        url: 'http://127.0.0.1:4321/',
        generatedAt: '2026-11-23T00:00:00.000Z'
      });
    }
  );

  it(
    'when the entry exits 1, should report the code and keep both streams',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a temp .mjs entry that writes to both streams and exits 1
      // when: it is spawned through the adapter
      // then: the exit code and both streams survive for the caller
      const result = await runDesignlang({ entryPath: exitScript, args: [] });
      expect(result.exitCode).toBe(1);
      expect(result.timedOut).toBe(false);
      expect(result.stdout).toBe('partial output');
      expect(result.stderr).toBe('extraction failed');
    }
  );

  it(
    'when the entry hangs, should mark the run timed out and kill the child',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a temp .mjs entry that records its pid and never exits
      // when: the run budget elapses
      // then: the result is marked timed out and the child is gone
      const pidFile = join(projectRoot, 'hang.pid');
      const running = runDesignlang({ entryPath: hangScript, args: [pidFile], timeoutMs: 10_000 });
      const pid = await readPid(pidFile, 9_000);
      pids.push(pid);
      const result = await running;
      expect(result.timedOut).toBe(true);
      expect(result.exitCode).toBe(-1);
      await waitUntil(() => !isAlive(pid));
    }
  );

  it(
    'when a hung entry has spawned a grandchild, should kill the whole tree',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: an entry that spawns a browser-like grandchild and then hangs
      // when: the run budget elapses
      // then: the run is marked timed out and both pids are gone
      const pidFile = join(projectRoot, 'tree.pid');
      const grandPidFile = join(projectRoot, 'tree-grand.pid');
      const running = runDesignlang({
        entryPath: treeScript,
        args: [pidFile, grandPidFile, grandchildScript],
        timeoutMs: 10_000
      });
      const pid = await readPid(pidFile, 9_000);
      pids.push(pid);
      const grandPid = await readPid(grandPidFile, 9_000);
      pids.push(grandPid);
      const result = await running;
      expect(result.timedOut).toBe(true);
      await waitUntil(() => !isAlive(pid));
      await waitUntil(() => !isAlive(grandPid));
    }
  );

  it(
    'when the entry path does not exist, should keep the child exit and its message',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a path no file occupies (node itself still starts and fails)
      // when: the adapter spawns it
      // then: the nonzero exit and stderr survive for the caller to classify
      const missing = join(projectRoot, 'does-not-exist.mjs');
      const result = await runDesignlang({ entryPath: missing, args: [] });
      expect(result.exitCode).not.toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.stderr).not.toBe('');
      expect(result.stderr).toContain('does-not-exist');
    }
  );

  it('when only a previous run wrote a grade file, should report no evidence', async () => {
    // given: a persistent out dir whose only report is older than this run
    // when: the grade evidence is read
    // then: the stale report is refused instead of reused as this run's proof
    const outDir = mkdtempSync(join(projectRoot, 'stale-'));
    const stale = join(outDir, 'previous-run.grade.json');
    writeFileSync(stale, '{"generatedAt":"2026-11-22T00:00:00.000Z","overall":"A"}');
    const past = new Date('2020-01-01T00:00:00.000Z');
    utimesSync(stale, past, past);
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when several grade files exist, should read the newest one', async () => {
    // given: two written grade reports whose mtimes are set explicitly
    // when: the grade evidence is read
    // then: the newest file is parsed and the older one is ignored
    const outDir = mkdtempSync(join(projectRoot, 'grade-'));
    const older = join(outDir, 'old.grade.json');
    const newer = join(outDir, 'new.grade.json');
    writeFileSync(older, '{"title":"older"}');
    writeFileSync(
      newer,
      '{"title":"newer","overall":"A","generatedAt":"2026-11-23T00:00:00.000Z"}'
    );
    const past = new Date(Date.now() - 10_000);
    utimesSync(older, past, past);
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.raw).toEqual({
      title: 'newer',
      overall: 'A',
      generatedAt: '2026-11-23T00:00:00.000Z'
    });
  });

  it('when no grade file exists, should report DESIGN_RENDER_NO_EVIDENCE', async () => {
    // given: an output directory with no *.grade.json
    // when: the grade evidence is read
    // then: the absence is reported as no evidence, not a pass
    const outDir = mkdtempSync(join(projectRoot, 'empty-'));
    writeFileSync(join(outDir, 'design-language.md'), '# not a grade report');
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when a valid-evidence file lacks the grade suffix, should not read it', async () => {
    // given: an out dir whose only valid JSON evidence is named notes.md
    // when: the grade evidence is read
    // then: only *.grade.json files are report candidates
    const outDir = mkdtempSync(join(projectRoot, 'suffix-'));
    writeFileSync(join(outDir, 'notes.md'), '{"generatedAt":"2026-11-23T00:00:00Z"}');
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    expect(result.message).toContain('.grade.json');
  });

  it('when the out dir does not exist, should report no evidence instead of throwing', async () => {
    // given: a path that was never created
    // when: the grade evidence is read
    // then: the readdir failure degrades to the explicit no-evidence value
    const result = await readGradeEvidence(join(projectRoot, 'never-created'));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    expect(result.message).toContain('no *.grade.json report');
  });

  it('when the only report predates notBefore, should refuse it as stale', async () => {
    // given: a fresh file and an explicit notBefore beyond its mtime
    // when: the grade evidence is read
    // then: the file belongs to an earlier run and is refused
    const outDir = mkdtempSync(join(projectRoot, 'boundary-'));
    writeFileSync(
      join(outDir, 'run.grade.json'),
      '{"generatedAt":"2026-11-23T00:00:00Z","overall":"A"}'
    );
    const result = await readGradeEvidence(outDir, Date.now() + 60_000);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when a grade-named DIRECTORY exists, should ignore it and report no evidence', async () => {
    // given: an out dir whose only *.grade.json entry is a directory
    // when: the grade evidence is read
    // then: non-files are never read as reports
    const outDir = mkdtempSync(join(projectRoot, 'dir-entry-'));
    mkdirSync(join(outDir, 'fake.grade.json'));
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when the newest grade report is invalid, should refuse it without falling back', async () => {
    // given: an older valid report and a newer unparseable one
    // when: the grade evidence is read
    // then: the newest file is judged and fails as no evidence
    const outDir = mkdtempSync(join(projectRoot, 'invalid-newest-'));
    const older = join(outDir, 'old.grade.json');
    const newer = join(outDir, 'new.grade.json');
    writeFileSync(older, '{"generatedAt":"2026-11-23T00:00:00Z"}');
    writeFileSync(newer, '{ oops');
    const past = new Date(Date.now() - 10_000);
    utimesSync(older, past, past);
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });
});

describe('Scenario: a11y — the refusal text names the command', () => {
  it('when stdout has no evidence, should name the designlang subcommand', () => {
    // given: an empty stdout for the drift check
    // when: the parser refuses it
    // then: the message names `designlang drift` so the user knows what ran
    const result = parseDesignlangEvidence({ kind: 'drift', stdout: '' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain('designlang drift');
  });

  it('when a grade directory has no report, should name the directory', async () => {
    // given: an output directory with no grade report
    // when: the reader refuses it
    // then: the message carries the directory so the path can be checked
    const outDir = mkdtempSync(join(projectRoot, 'a11y-'));
    const result = await readGradeEvidence(outDir);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected no evidence');
    expect(result.message).toContain(outDir);
  });
});

/** Read the pid a hanging fixture wrote, once it has started. */
async function readPid(pidFile: string, timeoutMs: number): Promise<number> {
  await waitUntil(() => readablePid(pidFile), timeoutMs);
  return Number(readFileSync(pidFile, 'utf8').trim());
}

function readablePid(pidFile: string): boolean {
  try {
    return readFileSync(pidFile, 'utf8').trim() !== '';
  } catch {
    return false;
  }
}
