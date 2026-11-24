import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { AVAILABLE, UNAVAILABLE } from './_fake-designlang.js';
import {
  type DesignlangRunResult,
  runDesignlang
} from '../../../src/services/design/designlang.js';
import type { EngineAvailability } from '../../../src/services/design/engine-status.js';
import {
  type FidelityDeps,
  type RunFidelityInput,
  isValidFidelityMin,
  runFidelity
} from '../../../src/services/design/fidelity.js';

import type * as FidelityModuleTypes from '../../../src/services/design/fidelity.js';

type FidelityModule = typeof FidelityModuleTypes;

declareDimensions('tests/unit/design/fidelity-boundaries.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BASELINE = 'http://127.0.0.1:4311/';
const CANDIDATE = 'http://127.0.0.1:4312/';

const REPORT = {
  overall: 92,
  visual: 91,
  motion: 94,
  grade: 'A',
  generatedAt: '2026-11-24T00:00:00.000Z'
};

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-fidelity-b-'));
  roots.push(root);
  return root;
}

/**
 * The SUT is imported per test after `vi.resetModules()` so its module-level
 * constants (REPORT_FILE, the number/text readers) initialise INSIDE a test
 * body. Under Stryker's per-test coverage a module-scope initialiser runs
 * before any test, so a mutant in it would read as unexecuted.
 */
async function loadFidelity(): Promise<FidelityModule> {
  vi.resetModules();
  return import('../../../src/services/design/fidelity.js');
}

type FakeEngine = {
  exitCode?: number;
  report?: unknown;
  stderr?: string;
  recordArgs?: string;
};

/** A stand-in designlang entry that records argv and optionally writes a report. */
function fakeEngine(name: string, options: FakeEngine = {}): string {
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

/** A run that writes nothing; `stderr`/`timedOut` shape the block message. */
function silentRun(overrides: Partial<DesignlangRunResult> = {}): FidelityDeps['run'] {
  return async () => ({ exitCode: 0, stdout: '', stderr: '', timedOut: false, ...overrides });
}

describe('Scenario: behavior — the threshold boundary is 0..100 inclusive', () => {
  it('should accept the endpoints and refuse non-integers and out-of-range values', () => {
    // given: thresholds on and just outside the integer 0..100 range
    // when: each is validated
    // then: only 0, 90 and 100 are accepted
    expect(isValidFidelityMin(0)).toBe(true);
    expect(isValidFidelityMin(90)).toBe(true);
    expect(isValidFidelityMin(100)).toBe(true);
    for (const value of [-1, 101, 50.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(isValidFidelityMin(value)).toBe(false);
    }
  });

  it('when min is 101, should refuse with the exact threshold message', async () => {
    // given: an out-of-range threshold and a fake engine that would write a report
    // when: the fidelity run is requested
    // then: the refusal is the full pinned sentence naming 0..100 and the value
    const root = makeRoot();
    const entry = fakeEngine('min-101-exact', { report: REPORT });

    const result = await runFidelity(inputFor(root, entry, { min: 101 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toBe(
        'fidelity --min must be an integer 0..100; refusing 101 because designlang treats a ' +
          'non-numeric --min as no threshold.'
      );
    }
  });
});

describe('Scenario: render — the argv the engine receives', () => {
  it('should pass the exact fidelity vector, the output dir and --system-chrome', async () => {
    // given: an available system-chrome engine that records its argv
    // when: the fidelity run completes
    // then: every argv slot is the one the spike measured
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine('argv', { report: REPORT, recordArgs });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    const argv = JSON.parse(readFileSync(recordArgs, 'utf8')) as string[];
    expect(argv.slice(0, 7)).toEqual([
      'fidelity',
      BASELINE,
      '--clone',
      CANDIDATE,
      '--min',
      '90',
      '-o'
    ]);
    expect(argv[7]).toContain(join('.peaks', '_runtime', 'sid-1', 'design', 'fidelity'));
    expect(argv[8]).toBe('--system-chrome');
  });

  it('should report a path under the session design directory', async () => {
    // given: a fake engine that writes a report
    // when: the fidelity run completes
    // then: fidelity.json lives under <session>/design/fidelity/
    const root = makeRoot();
    const entry = fakeEngine('report-path', { report: REPORT });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reportPath).toContain(
        join('.peaks', '_runtime', 'sid-1', 'design', 'fidelity')
      );
      expect(result.reportPath.endsWith('fidelity.json')).toBe(true);
    }
  });

  it('should keep a padded text field verbatim and null only the blank one', async () => {
    // given: a report whose grade is padded and whose visual is a string
    // when: the report is read
    // then: the overall survives, the padded grade is kept verbatim and the string is null
    const root = makeRoot();
    const entry = fakeEngine('text-fields', {
      report: { overall: 92, visual: ' 91 ', grade: '  A  ' }
    });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score).toBe(92);
      expect(result.visual).toBeNull();
      expect(result.grade).toBe('  A  ');
    }
  });

  it('should treat a whitespace-only text field as absent', async () => {
    // given: a report whose grade and generatedAt are blank strings
    // when: the report is read
    // then: both blank fields become null instead of evidence
    const root = makeRoot();
    const entry = fakeEngine('blank-text', {
      report: { overall: 92, grade: '   ', generatedAt: '\t' }
    });

    const result = await runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.grade).toBeNull();
      expect(result.generatedAt).toBeNull();
    }
  });
});

describe('Scenario: integration — the run directory and the report it reads', () => {
  it('should not read a previous run report as this run evidence', async () => {
    // given: one run that writes a report and a second run that writes nothing
    // when: both run against the same project and session
    // then: the second is blocked, because its run directory is fresh
    const root = makeRoot();
    const first = fakeEngine('fresh-first', { report: { ...REPORT, overall: 41 } });
    const second = fakeEngine('fresh-second');

    const one = await runFidelity(inputFor(root, first));
    const two = await runFidelity(inputFor(root, second));

    expect(one.ok).toBe(true);
    expect(two.ok).toBe(false);
    if (two.ok === false) expect(two.message).toContain('was not written');
  });

  it('should refuse a session id that is not a single path segment', async () => {
    // given: a session id that would climb out of the runtime tree
    // when: the fidelity run is requested
    // then: it is refused before the output directory is created or the engine runs
    const root = makeRoot();
    const recordArgs = join(root, 'escape-argv.json');
    const entry = fakeEngine('escape-session', { report: REPORT, recordArgs });

    const result = await runFidelity(inputFor(root, entry, { sessionId: 'a/b' }));

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
      expect(result.message).toBe(
        'Invalid session id a/b: the fidelity output must stay inside one runtime dir.'
      );
    }
    expect(existsSync(recordArgs)).toBe(false);
  });

  it('should default the spawn budget to 180 s and honour an explicit one', async () => {
    // given: an injected run that records its timeout, with and without an override
    // when: each run is requested
    // then: the default is 180000 and the override is passed through untouched
    const root = makeRoot();
    const seen: Array<number | undefined> = [];
    const capture: FidelityDeps['run'] = async (input) => {
      seen.push(input.timeoutMs);
      return { exitCode: 0, stdout: '', stderr: '', timedOut: false };
    };
    const entry = fakeEngine('timeout-capture');

    await runFidelity(inputFor(root, entry, { deps: depsFor(entry, { run: capture }) }));
    await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { run: capture }), timeoutMs: 5_000 })
    );

    expect(seen).toEqual([180_000, 5_000]);
  });
});

describe('Scenario: behavior — a report body that is not a JSON object is no evidence', () => {
  it('should refuse every non-object report body with the object message', async () => {
    // given: report bodies that are an array, null, a number and a string
    // when: each fidelity run completes
    // then: each is blocked and the detail says the report is not a JSON object
    for (const report of [[], null, 42, 'text']) {
      const root = makeRoot();
      const entry = fakeEngine(`non-object-${String(report)}`, { report });

      const result = await runFidelity(inputFor(root, entry));

      expect(result.ok).toBe(false);
      if (result.ok === false) {
        expect(result.code).toBe('DESIGN_FIDELITY_NO_EVIDENCE');
        expect(result.message).toContain('fidelity.json is not a JSON object');
      }
    }
  });
});

describe('Scenario: behavior — the engine availability gate', () => {
  it('should name every availability code it has', async () => {
    // given: an engine that resolved to one and to two missing capabilities
    // when: each run is requested
    // then: the message repeats the joined codes verbatim
    const root = makeRoot();
    const entry = fakeEngine('codes');
    const one: EngineAvailability = { ...UNAVAILABLE };
    const two: EngineAvailability = {
      ...UNAVAILABLE,
      codes: ['DESIGN_ENGINE_VERSION_UNSUPPORTED', 'DESIGN_BROWSER_UNAVAILABLE']
    };

    const first = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { availability: one }) })
    );
    const second = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { availability: two }) })
    );

    expect(first.ok).toBe(false);
    if (first.ok === false) {
      expect(first.message).toBe(
        'designlang is unavailable (DESIGN_ENGINE_UNAVAILABLE); the fidelity comparison cannot run.'
      );
    }
    expect(second.ok).toBe(false);
    if (second.ok === false) {
      expect(second.message).toContain(
        'DESIGN_ENGINE_VERSION_UNSUPPORTED, DESIGN_BROWSER_UNAVAILABLE'
      );
    }
  });

  it('should fall back to the default code when the engine reports none', async () => {
    // given: an unavailable engine whose codes list is empty
    // when: the run is requested
    // then: the message still names DESIGN_ENGINE_UNAVAILABLE
    const root = makeRoot();
    const entry = fakeEngine('empty-codes');
    const availability: EngineAvailability = { ...UNAVAILABLE, codes: [] };

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { availability }) })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toContain('designlang is unavailable (DESIGN_ENGINE_UNAVAILABLE)');
    }
  });

  it('should block when the engine is available but has no entry path', async () => {
    // given: an availability record that claims available with a null entry path
    // when: the run is requested
    // then: the null entry still blocks instead of spawning nothing
    const root = makeRoot();
    const recordArgs = join(root, 'null-entry-argv.json');
    const entry = fakeEngine('null-entry', { report: REPORT, recordArgs });
    const availability: EngineAvailability = { ...AVAILABLE, available: true, entryPath: null };

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { availability }) })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.code).toBe('DESIGN_ENGINE_UNAVAILABLE');
    expect(existsSync(recordArgs)).toBe(false);
  });
});

describe('Scenario: a11y — the blocked message names the URL and the failure', () => {
  it('should name the HTTP status a probe answered with', async () => {
    // given: a baseline probe that answers 404
    // when: the run is requested
    // then: the message names the URL, the status and the 200 requirement
    const root = makeRoot();
    const entry = fakeEngine('probe-404-exact', { report: REPORT });

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { probeStatus: async () => 404 }) })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toBe(
        `The fidelity URL ${BASELINE} answered HTTP 404; both the baseline and the candidate ` +
          'must answer HTTP 200 before designlang runs.'
      );
    }
  });

  it('should say the run timed out and trim the stderr tail', async () => {
    // given: a run that timed out with padded stderr and wrote no report
    // when: the result is blocked
    // then: the message names the exit, the timeout and the trimmed stderr
    const root = makeRoot();
    const entry = fakeEngine('timed-out');

    const result = await runFidelity(
      inputFor(root, entry, {
        deps: depsFor(entry, {
          run: silentRun({ exitCode: 1, timedOut: true, stderr: '  boom\n' })
        })
      })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toBe(
        'designlang fidelity exited 1, timed out without a usable report ' +
          '(fidelity.json was not written): boom'
      );
    }
  });

  it('should add no stderr suffix when stderr was empty', async () => {
    // given: a silent failed run with no stderr
    // when: the result is blocked
    // then: the message ends at the missing-report detail, with no trailing colon
    const root = makeRoot();
    const entry = fakeEngine('no-stderr');

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { run: silentRun({ exitCode: 1 }) }) })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toContain(
        'exited 1 without a usable report (fidelity.json was not written)'
      );
      expect(result.message.endsWith('(fidelity.json was not written)')).toBe(true);
    }
  });

  it('should keep only the last 400 stderr characters', async () => {
    // given: a failed run whose stderr head sits more than 400 characters from the end
    // when: the result is blocked
    // then: the marker survives and the head of stderr is dropped
    const root = makeRoot();
    const entry = fakeEngine('long-stderr');
    const stderr = `HEAD${'H'.repeat(500)}TAIL`;

    const result = await runFidelity(
      inputFor(root, entry, { deps: depsFor(entry, { run: silentRun({ exitCode: 1, stderr }) }) })
    );

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.message).toContain('TAIL');
      expect(result.message).not.toContain('HEAD');
    }
  });
});

describe('Scenario: render — module constants initialise inside the test', () => {
  it('should write and read the report on a fresh import', async () => {
    // given: a fresh fidelity module and a fake engine that writes a full report
    // when: the fresh runner completes one comparison
    // then: the report file name and the number/text readers all resolved correctly
    const root = makeRoot();
    const entry = fakeEngine('fresh-module', { report: REPORT });
    const fresh = await loadFidelity();

    const result = await fresh.runFidelity(inputFor(root, entry));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.score).toBe(92);
      expect(result.visual).toBe(91);
      expect(result.motion).toBe(94);
      expect(result.grade).toBe('A');
      expect(result.generatedAt).toBe('2026-11-24T00:00:00.000Z');
      expect(result.reportPath.endsWith('fidelity.json')).toBe(true);
    }
  });
});
