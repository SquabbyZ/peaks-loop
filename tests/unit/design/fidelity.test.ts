import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { AVAILABLE, UNAVAILABLE } from './_fake-designlang.js';
import { runDesignlang } from '../../../src/services/design/designlang.js';
import {
  type FidelityDeps,
  type RunFidelityInput,
  runFidelity
} from '../../../src/services/design/fidelity.js';

declareDimensions('tests/unit/design/fidelity.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BASELINE = 'http://127.0.0.1:4311/';
const CANDIDATE = 'http://127.0.0.1:4312/';

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-fidelity-'));
  roots.push(root);
  return root;
}

type FakeFidelity = {
  exitCode?: number;
  report?: unknown;
  stderr?: string;
  recordArgs?: string;
};

/** A stand-in designlang entry that records argv and optionally writes a report. */
function fakeEngine(name: string, options: FakeFidelity = {}): string {
  const dir = makeRoot();
  const path = join(dir, `${name}.mjs`);
  const lines = [
    "import { writeFileSync } from 'node:fs';",
    'const argv = process.argv.slice(2);',
    "const out = argv[argv.indexOf('-o') + 1];",
    ...(options.recordArgs === undefined
      ? []
      : [`writeFileSync(${JSON.stringify(options.recordArgs)}, JSON.stringify(argv));`]),
    ...(options.report === undefined
      ? []
      : [
          `writeFileSync(out + '/fidelity.json', ${JSON.stringify(JSON.stringify(options.report))});`
        ]),
    ...(options.stderr === undefined
      ? []
      : [`process.stderr.write(${JSON.stringify(options.stderr)});`]),
    `process.exit(${String(options.exitCode ?? 0)});`
  ];
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

function depsFor(entryPath: string, overrides: Partial<FidelityDeps> = {}): FidelityDeps {
  return {
    availability: { ...AVAILABLE, entryPath },
    isTrusted: () => true,
    probeStatus: async () => 200,
    run: (input) =>
      runDesignlang({ entryPath: input.entryPath, args: input.args, timeoutMs: input.timeoutMs }),
    ...overrides
  };
}

function inputFor(
  root: string,
  entryPath: string,
  overrides: Partial<RunFidelityInput> = {}
): RunFidelityInput {
  return {
    projectRoot: root,
    appRoot: root,
    sessionId: 'sid-1',
    baselineUrl: BASELINE,
    candidateUrl: CANDIDATE,
    deps: depsFor(entryPath),
    ...overrides
  };
}

const REPORT = {
  overall: 92,
  visual: 91,
  motion: 94,
  grade: 'A',
  generatedAt: '2026-11-24T00:00:00.000Z'
};

describe('Scenario: behavior — the threshold is validated before anything runs', () => {
  it('when min is NaN, should refuse instead of spawning with a no-op threshold', async () => {
    // given: a NaN threshold and a fake engine that would exit 0 with a report
    // when: the fidelity run is requested
    // then: the run is refused with a message naming --min and nothing is spawned
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine('nan-min', { report: { overall: 12, grade: 'F' }, recordArgs });

    const result = await runFidelity(inputFor(root, entry, { min: Number.NaN }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toContain('--min');
    }
    expect(existsSync(recordArgs)).toBe(false);
  });

  it('when min is above 100, should refuse the out-of-range threshold', async () => {
    // given: a threshold outside the 0..100 score range
    // when: the fidelity run is requested
    // then: the run is refused before the engine entry is executed
    const root = makeRoot();
    const entry = fakeEngine('min-101', { report: REPORT });

    const result = await runFidelity(inputFor(root, entry, { min: 101 }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('0..100');
  });
});

describe('Scenario: render — the score comes from the written report', () => {
  it('when the engine exits 1 below --min, should return the recorded score', async () => {
    // given: a fake engine that writes a 41-point report and exits 1
    // when: the fidelity run completes
    // then: the result carries that score and the report path, not a block
    const root = makeRoot();
    const entry = fakeEngine('below-min', { exitCode: 1, report: { ...REPORT, overall: 41 } });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score).toBe(41);
      expect(result.visual).toBe(91);
      expect(result.motion).toBe(94);
      expect(result.grade).toBe('A');
      expect(result.generatedAt).toBe('2026-11-24T00:00:00.000Z');
      expect(result.reportPath.endsWith('fidelity.json')).toBe(true);
      expect(existsSync(result.reportPath)).toBe(true);
    }
  });

  it('when a report field is not a number, should record it as null', async () => {
    // given: a report whose visual is a string and whose grade is a number
    // when: the report is parsed
    // then: only the numeric overall survives and the bad fields become null
    const root = makeRoot();
    const entry = fakeEngine('bad-fields', { report: { overall: 90, visual: '91', grade: 7 } });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score).toBe(90);
      expect(result.visual).toBeNull();
      expect(result.motion).toBeNull();
      expect(result.grade).toBeNull();
      expect(result.generatedAt).toBeNull();
    }
  });

  it('when the report omits overall, should refuse it as no evidence', async () => {
    // given: a report with no overall score
    // when: the fidelity run completes with exit 0
    // then: the run is blocked because a report without overall proves nothing
    const root = makeRoot();
    const entry = fakeEngine('no-overall', { report: { visual: 90, grade: 'A' } });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toContain('overall');
    }
  });
});

describe('Scenario: integration — exit 1 and exit 0 are judged by the artifact', () => {
  it('when the engine exits 1 without a report, should block', async () => {
    // given: a fake engine that fails before writing fidelity.json
    // when: the fidelity run completes
    // then: the exit code is not read as a score and the run is blocked
    const root = makeRoot();
    const entry = fakeEngine('exit1-no-report', {
      exitCode: 1,
      stderr: 'net::ERR_CONNECTION_REFUSED'
    });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toContain('exited 1');
      expect(result.message).toContain('net::ERR_CONNECTION_REFUSED');
    }
  });

  it('when the engine exits 0 without a report, should block', async () => {
    // given: a fake engine that exits successfully but writes nothing
    // when: the fidelity run completes
    // then: an exit 0 alone is never a pass
    const root = makeRoot();
    const entry = fakeEngine('exit0-no-report');

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toContain('was not written');
    }
  });

  it('when a URL does not answer HTTP 200, should block before spawning', async () => {
    // given: a probe that reports 404 for a dead route
    // when: the fidelity run is requested
    // then: no engine is spawned, because two 404 pages would score 100
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine('probe-404', { report: REPORT, recordArgs });

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { probeStatus: async () => 404 }) })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DESIGN_FIDELITY_URL_UNREACHABLE');
    expect(existsSync(recordArgs)).toBe(false);
  });

  it('when the engine reports a system browser, should pass --system-chrome', async () => {
    // given: an available engine whose browser kind is system-chrome
    // when: the fidelity run spawns the fake entry
    // then: the argv carries --system-chrome, and a bundled browser does not
    const root = makeRoot();
    const systemArgs = join(root, 'system.json');
    const bundledArgs = join(root, 'bundled.json');
    const systemEntry = fakeEngine('chrome-system', { report: REPORT, recordArgs: systemArgs });
    const bundledEntry = fakeEngine('chrome-bundled', { report: REPORT, recordArgs: bundledArgs });

    await runFidelity(inputFor(root, systemEntry));
    await runFidelity(
      inputFor(root, bundledEntry, {
        deps: depsFor(bundledEntry, {
          availability: { ...AVAILABLE, entryPath: bundledEntry, browserKind: 'bundled' }
        })
      })
    );

    expect(JSON.parse(readFileSync(systemArgs, 'utf8'))).toContain('--system-chrome');
    expect(JSON.parse(readFileSync(bundledArgs, 'utf8'))).not.toContain('--system-chrome');
  });

  it('when the engine is unavailable, should block without spawning', async () => {
    // given: a resolved engine that reports no entry path or browser
    // when: the fidelity run is requested
    // then: the run is blocked as DESIGN_ENGINE_UNAVAILABLE
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine('unavailable', { report: REPORT, recordArgs });

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { availability: UNAVAILABLE }) })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DESIGN_ENGINE_UNAVAILABLE');
    expect(existsSync(recordArgs)).toBe(false);
  });
});

describe('Scenario: a11y — blocked messages name the offending URL', () => {
  it('when the baseline URL is untrusted, should name it and spawn nothing', async () => {
    // given: a trust boundary that refuses the baseline host
    // when: the fidelity run is requested
    // then: the message names the URL and the refusal happens before any process
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine('untrusted', { report: REPORT, recordArgs });
    const result = await runFidelity(
      inputFor(root, entry, {
        deps: depsFor(entry, { isTrusted: (url) => url === CANDIDATE })
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_URL_UNTRUSTED');
      expect(result.message).toContain(BASELINE);
    }
    expect(existsSync(recordArgs)).toBe(false);
  });

  it('when the probe gets no answer, should say the URL did not answer', async () => {
    // given: a probe that returns null because the server refused the connection
    // when: the fidelity run is requested
    // then: the message names the URL and the missing response
    const root = makeRoot();
    const entry = fakeEngine('no-answer', { report: REPORT });

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { probeStatus: async () => null }) })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_URL_UNREACHABLE');
      expect(result.message).toContain(BASELINE);
      expect(result.message).toContain('did not answer');
    }
  });
});
