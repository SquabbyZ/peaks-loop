// tests/unit/benchmarks/bench-scripts.test.ts
//
// The two benches are REACHABLE, and what they print is honest.
//
// WHY THIS FILE EXISTS. Neither bench had a `package.json` script, so neither could
// be run without knowing the tsx invocation — and the resource-budget bench printed
// `{"rssMb":101,"cpuPct":0.5,"passesGate":true}` for a number that was not a
// percentage and a sample taken before any work. This file runs the package scripts
// and pins what they say: the Phase A gate reports "not measured" with an exit code
// that is not success, and the resource bench names its unit and the population it
// sampled.
//
// Dimensions covered: render (the shape and the wording of the printed result),
// integration (the package scripts as real processes).
// Dimensions omitted: behavior — the gate's state model is pinned in
// `phase-a-baseline-gate.test.ts`; a11y — the exit codes and the human sentence are
// pinned in `phase-a-baseline-runner.test.ts`.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { EXIT_NOT_MEASURED } from '../../../benchmarks/runtime-detached/baseline.js';
// A TYPE-ONLY import: it puts the bench source inside the root tsc program (the root
// tsconfig includes src/ and tests/ only, so a file nothing imports is typechecked by
// nothing) without loading it at runtime — the bench is run as a process below, and
// loading it here would run its measurements inside the test worker.
import type { ResourceBudgetBenchResult } from '../../../benchmarks/runtime-detached/resource-budget-bench.js';

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');

declareDimensions(
  'tests/unit/benchmarks/bench-scripts.test.ts',
  ['render', 'integration'],
  [
    { dim: 'behavior', reason: 'the gate state model is pinned in phase-a-baseline-gate.test.ts' },
    {
      dim: 'a11y',
      reason: 'exit codes and the human sentence are pinned in phase-a-baseline-runner.test.ts'
    }
  ]
);

interface PackageJson {
  readonly scripts: Record<string, string>;
}

function packageJson(): PackageJson {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as PackageJson;
}

/**
 * Run a package script as a real process.
 *
 * The script's OWN command is executed, with `node` resolved to this process — the
 * same command `pnpm run <name>` would run, without pnpm's own startup in the way.
 */
function runPackageScript(name: string): { status: number | null; stdout: string; stderr: string } {
  const script = packageJson().scripts[name];
  if (typeof script !== 'string') throw new Error(`package.json has no script named "${name}"`);
  const parts = script.trim().split(/\s+/);
  const spawned = spawnSync(process.execPath, parts.slice(1), {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { status: spawned.status, stdout: spawned.stdout, stderr: spawned.stderr };
}

/** The last non-empty line of stdout — where a bench prints its JSON. */
function lastJsonLine(stdout: string): string {
  const lines = stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const last = lines[lines.length - 1];
  if (last === undefined) throw new Error('the script printed nothing on stdout');
  return last;
}

describe('the bench package scripts — render', () => {
  it('when the package scripts are read, should expose both bench scripts outside pretest', () => {
    // given: this repository's package.json
    // when: the scripts block is read
    // then: both benches are reachable and neither is wired into pretest
    const scripts = packageJson().scripts;

    expect(scripts['bench:phase-a']).toContain('benchmarks/runtime-detached/baseline.ts');
    expect(scripts['bench:resource-budget']).toContain(
      'benchmarks/runtime-detached/resource-budget-bench.ts'
    );
    expect(scripts['pretest']).not.toContain('bench');
  });
});

describe('the bench package scripts — integration', () => {
  it(
    'when the bench:phase-a script runs, should print the not-measured result and exit unresolved',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the bench:phase-a package script
      // when: it runs
      // then: it prints the structured not-measured result and exits with a code that is not success
      const run = runPackageScript('bench:phase-a');

      const parsed = JSON.parse(lastJsonLine(run.stdout)) as {
        state: string;
        exitCode: number;
        passesGate: boolean | null;
        missingCapability: { what: string } | null;
      };
      expect(parsed.state).toBe('not-measured');
      expect(parsed.passesGate).toBeNull();
      expect(parsed.exitCode).toBe(EXIT_NOT_MEASURED);
      expect(parsed.missingCapability?.what).toContain('E2E harness');
      expect(run.status).toBe(EXIT_NOT_MEASURED);
    }
  );

  it(
    'when the bench:resource-budget script runs, should name its unit and the population it sampled',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the bench:resource-budget package script
      // when: it runs
      // then: the result names the unit of every number, says what it sampled, and reports
      //       that the product rail itself was not measured
      const run = runPackageScript('bench:resource-budget');

      const parsed = JSON.parse(lastJsonLine(run.stdout)) as ResourceBudgetBenchResult;
      expect(parsed.unit.rssMb).toContain('mebibytes');
      expect(parsed.unit.cpuPct).toContain('percent of ONE CPU core');
      expect(parsed.unit.cpuCentiseconds).toContain('centiseconds');
      expect(parsed.threshold.maxCpuPct).toBe(5);
      expect(parsed.threshold.maxCpuPctMeans).toContain('NOT 5 centiseconds');
      expect(parsed.measurementScope).toContain('NOT the peaks runtime product');
      expect(parsed.samples.idleWindow.describes).toContain('idle');
      expect(parsed.samples.warmupWindow.windowMs).toBeGreaterThan(0);
      expect(parsed.productRail.state).toBe('not-measured');
      expect(parsed.productRail.missingCapability).toContain('detached dispatch');
      expect(parsed.exitCode).toBe(parsed.passesGate ? 0 : 1);
    }
  );
});
