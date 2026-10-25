// tests/unit/benchmarks/phase-a-baseline-gate.test.ts
//
// The Phase A ship gate's STATE MODEL: the three states, their exit codes, the §5.2
// thresholds, and the entry-point detection that used to make the runner a silent
// no-op on Windows.
//
// WHY THIS FILE EXISTS. The runner used to answer "measured and failed" for a gate
// that was never measured (`passesGate: false` for a gate with no measurement), and
// its entry-point guard compared `import.meta.url` with `file://${argv[1]}` — never
// equal on Windows, so on win32 the runner printed nothing, wrote nothing and exited
// 0. Both are pinned here as the BEHAVIOUR of the exported functions, not as text.
//
// Dimensions covered: render (the shape of the result), behavior (the state model,
// the thresholds, the entry-point detection), a11y (the exit codes a caller reads and
// the sentence a human reads).
// Dimensions omitted: integration — this file touches no file system and spawns no
// process; what a run does on disk is measured in
// `tests/unit/benchmarks/phase-a-baseline-runner.test.ts`.

import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  CONTEXT_SAVING_TARGET_PCT,
  EXIT_CODES,
  EXIT_NOT_MEASURED,
  FAN_OUT_N,
  isEntryPoint,
  phaseAThresholds,
  QA_VERDICT_RATE_TARGET,
  runBaseline,
  TOKEN_COST_SAVING_TARGET_PCT,
  WALL_TIME_SAVING_TARGET_PCT,
  type PhaseAMeasurement
} from '../../../benchmarks/runtime-detached/baseline.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const BASELINE_PATH = resolve(REPO_ROOT, 'benchmarks', 'runtime-detached', 'baseline.ts');

declareDimensions(
  'tests/unit/benchmarks/phase-a-baseline-gate.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        "no file system and no process: the runner's effect on disk is measured in phase-a-baseline-runner.test.ts"
    }
  ]
);

/** The Windows rule for a file URL: `D:\dir\file.ts` is `file:///D:/dir/file.ts`. */
const windowsFileUrl = (path: string): URL => new URL(`file:///${path.replace(/\\/g, '/')}`);

/** A measurement of both arms in which every §5.2 rail is met. */
const PASSING_MEASUREMENT: PhaseAMeasurement = {
  fanOutN: 5,
  measuredAt: '2026-10-25T00:00:00.000Z',
  inProcess: { contextTokens: 1000, wallTimeMs: 10_000, tokenCost: 100, qaVerdictRate: 0.8 },
  detached: { contextTokens: 300, wallTimeMs: 6000, tokenCost: 70, qaVerdictRate: 0.85 }
};

describe('Phase A baseline gate — behavior', () => {
  it('when the gate has no measurement, should report the not-measured state with no verdict', () => {
    // given: a runner asked to evaluate the gate with nothing measured
    // when: the gate is evaluated
    // then: the state says "not measured" and the verdict is null, not false
    const result = runBaseline();

    expect(result.state).toBe('not-measured');
    expect(result.passesGate).toBeNull();
    expect(result.exitCode).toBe(EXIT_NOT_MEASURED);
  });

  it('when both arms are measured and every rail is met, should report measured-and-passed', () => {
    // given: a measurement of both arms in which every §5.2 rail is met
    // when: the gate is evaluated
    // then: the state is measured-and-passed and the verdict is true
    const result = runBaseline(PASSING_MEASUREMENT);

    expect(result.state).toBe('measured-and-passed');
    expect(result.passesGate).toBe(true);
    expect(result.exitCode).toBe(EXIT_CODES['measured-and-passed']);
  });

  it('when one rail is missed, should report measured-and-failed and name the rail', () => {
    // given: a measurement whose detached arm saves only 50 % of the orchestrator context
    // when: the gate is evaluated
    // then: the state is measured-and-failed and the summary names the missed rail
    const measurement: PhaseAMeasurement = {
      ...PASSING_MEASUREMENT,
      detached: { ...PASSING_MEASUREMENT.detached, contextTokens: 500 }
    };
    const result = runBaseline(measurement);

    expect(result.state).toBe('measured-and-failed');
    expect(result.passesGate).toBe(false);
    expect(result.exitCode).toBe(EXIT_CODES['measured-and-failed']);
    expect(result.summary).toContain('orchestrator-context-saving');
  });

  it('when the §5.2 thresholds are read, should pin the plan of record targets', () => {
    // given: the threshold constants the runner exports
    // when: the §5.2 targets are read
    // then: they are the plan of record's 60 / 30 / 20 at N=5, plus the QA comparison
    expect(CONTEXT_SAVING_TARGET_PCT).toBe(60);
    expect(WALL_TIME_SAVING_TARGET_PCT).toBe(30);
    expect(TOKEN_COST_SAVING_TARGET_PCT).toBe(20);
    expect(QA_VERDICT_RATE_TARGET).toBe('>= in-process baseline');
    expect(FAN_OUT_N).toBe(5);
  });

  it('when the entry point is a windows-shaped path, should detect it', () => {
    // given: the module URL and the argv path a Windows process would carry
    // when: the entry point is tested
    // then: the windows-shaped module URL matches the windows-shaped argv path
    const moduleUrl: string =
      'file:///D:/projects/peaks-loop/benchmarks/runtime-detached/baseline.ts';
    const argvPath: string = 'D:\\projects\\peaks-loop\\benchmarks\\runtime-detached\\baseline.ts';

    expect(isEntryPoint(moduleUrl, argvPath, windowsFileUrl)).toBe(true);
  });

  it('when the entry point is a windows-shaped path, should not be caught by the naive file:// comparison', () => {
    // given: the same windows-shaped module URL and argv path
    // when: the OLD comparison is evaluated
    // then: it does not match — the defect this runner was built on
    const moduleUrl: string =
      'file:///D:/projects/peaks-loop/benchmarks/runtime-detached/baseline.ts';
    const argvPath: string = 'D:\\projects\\peaks-loop\\benchmarks\\runtime-detached\\baseline.ts';

    expect(moduleUrl === `file://${argvPath}`).toBe(false);
  });

  it('when the module is the program the process was started with, should detect the entry point', () => {
    // given: this repository's own baseline runner path
    // when: the entry point is tested with the platform's own URL rules
    // then: the module URL matches the path — on win32, darwin and linux alike
    expect(isEntryPoint(pathToFileURL(BASELINE_PATH).href, BASELINE_PATH)).toBe(true);
  });
});

describe('Phase A baseline gate — render', () => {
  it('when the thresholds are listed, should carry the §5.2 reference and the unmeasured shape', () => {
    // given: the four §5.2 rails of an unmeasured gate
    // when: the thresholds are listed
    // then: each carries the spec reference, and none of them claims a verdict
    const thresholds = phaseAThresholds(null);

    expect(thresholds).toHaveLength(4);
    expect(thresholds.map((rail) => rail.target)).toEqual([60, 30, 20, null]);
    for (const rail of thresholds) {
      expect(rail.specRef).toContain('§5.2');
      expect(rail.measured).toBeNull();
      expect(rail.verified).toBeNull();
    }
  });

  it('when the gate is unresolved, should name the missing capability in the result', () => {
    // given: an unmeasured gate
    // when: the result is inspected
    // then: it names what is missing instead of reporting a failure
    const result = runBaseline();

    expect(result.missingCapability?.what).toContain('E2E harness');
    expect(result.missingCapability?.requiredVendors).toEqual(['claude', 'codex']);
    expect(result.summary).toContain('UNVERIFIED, not failed');
  });
});

describe('Phase A baseline gate — a11y', () => {
  it('when the gate is unresolved, should exit with a code that is not the passed code', () => {
    // given: the exit code of each gate state
    // when: the unresolved state is compared with the passed state
    // then: a caller that checks only the exit code cannot read "unresolved" as "passed"
    expect(EXIT_NOT_MEASURED).not.toBe(0);
    expect(EXIT_NOT_MEASURED).not.toBe(EXIT_CODES['measured-and-passed']);
    expect(EXIT_CODES['measured-and-failed']).not.toBe(EXIT_CODES['measured-and-passed']);
  });

  it('when the gate is unresolved, should say so in plain words on the summary', () => {
    // given: an unmeasured gate
    // when: the summary is read
    // then: it says NOT MEASURED, names the comparison, and says nothing was passed
    const summary = runBaseline().summary;

    expect(summary).toContain('NOT MEASURED');
    expect(summary).toContain('§5.2');
    expect(summary).toContain('not failed');
  });
});
