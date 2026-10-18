// tests/unit/vitest-concurrency-guard.test.ts
//
// Drift guard for the vitest worker-concurrency cap added in 4.0.17
// (slice `.peaks/_runtime/2026-08-06-session-cacde8/rd/requests/012-2026-08-06-fix-pre-existing-test-timeouts.md`).
//
// Why this test file exists:
//   Uncapped `pool: 'forks'` + `fileParallelism: true` on a 16-core box spawns
//   ~15 fork workers. Two test files additionally spawn real `node` subprocesses
//   (`statusline-cli-integration.test.ts` × 24, `bump-version-ac7.test.ts` × 8),
//   pushing runnable processes past core count. `testTimeout` measures wall clock,
//   so descheduled tests burn their 30 s budget while doing zero work. Measured
//   oversubscription was 8.8× (aggregate test time 3359 s vs wall 383 s on 16 cores).
//   The decisive counter-example: `batch-counter.test.ts` has zero subprocesses,
//   is pure sync fs, and carries an explicit `{ timeout: 90_000 }` override —
//   it still timed out in the full suite while completing in 18 s in isolation.
//   Validation: `--maxWorkers=6` (no other change) takes 17 timeouts → 0,
//   705 → 722 pass, wall 383.67 s → 362.21 s. The cap is **failure-prone**:
//   a contributor who deletes it restores the defect silently. This guard
//   makes the cap durable.
//
// Dimensions covered:
//   - render:    vitest.config.ts contains `maxWorkers` and the cap formula
//   - behavior:  cap is populated (not undefined) and within a sane bound
//   - integration: PEAKS_VITEST_MAX_WORKERS env var override is honored
//   - a11y:      n/a (config drift guard)
//
// 2026-10-19 (rid-concurrency-guard-dimensions): the `behavior` and
// `integration` dimensions above were claims with nothing behind them — every
// test matched strings in vitest.config.ts, so a cap of any value and an
// ignored env var both stayed green. The two Scenario blocks at the bottom
// EVALUATE `vitest.workers.ts` itself instead: one reads the exported bound,
// the other re-evaluates the module under each documented env shape.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const vitestConfigPath = resolve(__dirname, '..', '..', 'vitest.config.ts');
const configText = readFileSync(vitestConfigPath, 'utf8');

const OVERRIDE_ENV = 'PEAKS_VITEST_MAX_WORKERS';

// Sane bound for the FIXED default, named so the assertion cannot drift with
// the value it is supposed to constrain.
//
// Lower bound 1: `maxWorkers` is a worker COUNT, and `parseOverride` already
// refuses anything below 1. A default below 1 would admit exactly the value
// the override path rejects, so the two paths must agree on the floor.
//
// Upper bound 8: 8 is the loudest schedule this repository has measured
// evidence for — the 2026-07-30 halved `floor(cpus/2)` schedule on the 16-core
// host (17 timeouts -> 0, 705 -> 722 passing) — and `package.json`'s
// `test:fast` pins `--maxWorkers=8` as the EXPLICIT opt-in for callers who want
// the speed back. A fixed default at 8 or above would make that opt-in
// meaningless and put the default back into the oversubscription regime the
// cap exists to leave (measured 15 forked workers, 8.8x aggregate/wall).
const SANE_MIN_WORKERS = 1;
const SANE_MAX_WORKERS = 8;

// Evaluate the policy module afresh under one env value. A plain import would
// be evaluated once and cached, so every later case would read the FIRST value
// and the override assertions below would pass vacuously. `resetModules`
// clears the registry between cases; `stubEnv(name, undefined)` DELETES the
// key, which is the only shape that reaches `parseOverride` as `undefined`.
async function loadWorkerPolicy(override: string | undefined): Promise<{
  DEFAULT_MAX_WORKERS: number;
  maxWorkers: number;
}> {
  vi.resetModules();
  vi.stubEnv(OVERRIDE_ENV, override);
  try {
    return await import('../../vitest.workers.js');
  } finally {
    vi.unstubAllEnvs();
  }
}

describe('vitest config — worker concurrency cap (4.0.17 starvation fix)', () => {
  it('when read, vitest.config.ts declares maxWorkers', () => {
    // Either object form `maxWorkers: N` or shorthand `maxWorkers,` (used here).
    expect(configText).toMatch(/maxWorkers/);
  });

  it('when read, vitest.config.ts wires maxWorkers into the test block', () => {
    // The cap must be passed to the test config, not just declared as a const.
    expect(configText).toMatch(/maxWorkers,?\s*$/m);
  });

  it('when read, vitest.config.ts references the starvation root-cause comment', () => {
    // The block comment explaining the 8.8× oversubscription must be present,
    // so a future reader can verify the cap is intentional rather than cargo.
    expect(configText).toMatch(/oversubscription/);
  });

  it('when read, vitest.config.ts honors PEAKS_VITEST_MAX_WORKERS env override', () => {
    expect(configText).toMatch(/PEAKS_VITEST_MAX_WORKERS/);
  });

  it('when read, vitest.config.ts testTimeout stays at 30_000 (R1 anti-fake-green)', () => {
    // Raising testTimeout is the false-pass trap. The cap must remain the fix,
    // not a wider timeout. If this test fails, the slice was reverted to the
    // band-aid that hides the underlying starvation.
    expect(configText).toMatch(/testTimeout:\s*30_000/);
    expect(configText).toMatch(/hookTimeout:\s*30_000/);
  });

  it('when read, vitest.config.ts keeps pool:"forks" + fileParallelism:true (no regression to old buggy config)', () => {
    expect(configText).toMatch(/pool:\s*['"]forks['"]/);
    expect(configText).toMatch(/fileParallelism:\s*true/);
  });

  it('when the wiring is COMMENTED OUT (not deleted), the cap must not clear', () => {
    // The negative arm for the shape the six assertions above cannot see.
    //
    // `/maxWorkers,?\s*$/m` (line 42) matches `    // maxWorkers,` exactly as
    // readily as `    maxWorkers,` — the `//` prefix is not excluded. Measured
    // 2026-09-18 (slice rid-c2-mutation-control-audit): changing vitest.config.ts
    // line 70 from `maxWorkers,` to `// maxWorkers,` left ALL SIX assertions
    // green. The same file flags the identical defect class over
    // `.gitignore` — `top-level-change-id-guard.test.ts` ships an explicit
    // anti-control for a commented-out rule, because "a substring is not a
    // rule". This is that anti-control for this file.
    //
    // The rule is `maxWorkers` declared on an ACTIVE line. The two mutations
    // are the two ways a human disables it, and both must go red:
    //   - commented out  (`// maxWorkers,`)  -> not an active line  -> RED
    //   - deleted whole  (line removed)      -> not an active line  -> RED
    // The contrast that makes it a control rather than a second copy of the
    // substring check: asserting the ACTIVE lines, not the file text.
    const activeWiring = configText
      .split(/\r?\n/)
      .filter((line) => !/^\s*\/\//.test(line))
      .some((line) => /maxWorkers,?\s*$/.test(line));

    expect(activeWiring, 'the worker cap must be wired on a line the config actually reads').toBe(
      true
    );
  });
});

// ── behavior: the cap value itself ───────────────────────────────────

describe('Scenario: behavior — the worker cap value itself', () => {
  it('when no override is set, should resolve maxWorkers to a positive integer inside the sane bound', async () => {
    // given: PEAKS_VITEST_MAX_WORKERS is unset
    // when: the single-source-of-truth policy module is evaluated
    // then: the default is an integer in [1, 8] and maxWorkers is exactly it
    const policy = await loadWorkerPolicy(undefined);

    expect(
      Number.isInteger(policy.DEFAULT_MAX_WORKERS),
      'the cap is a worker count, so a fraction is not a valid default'
    ).toBe(true);
    expect(policy.DEFAULT_MAX_WORKERS).toBeGreaterThanOrEqual(SANE_MIN_WORKERS);
    expect(policy.DEFAULT_MAX_WORKERS).toBeLessThanOrEqual(SANE_MAX_WORKERS);
    expect(policy.maxWorkers).toBe(policy.DEFAULT_MAX_WORKERS);
  });
});

// ── integration: the env override ────────────────────────────────────

describe('Scenario: integration — PEAKS_VITEST_MAX_WORKERS is honored', () => {
  it('when the override is a positive integer or a decimal, should use it (floored) instead of the default', async () => {
    // given: the default resolved with no override, and probes derived from it
    //        so neither probe can equal the default (an ignored env stays red)
    // when: the module is evaluated with `<default + 1>` and `<default + 1>.9`
    // then: the integer is honored and the decimal is floored, never rounded
    const baseline = await loadWorkerPolicy(undefined);
    const probe = baseline.DEFAULT_MAX_WORKERS + 1;
    const integer = await loadWorkerPolicy(String(probe));
    const decimal = await loadWorkerPolicy(`${probe}.9`);

    expect(integer.maxWorkers, `override ${probe}`).toBe(probe);
    expect(decimal.maxWorkers, `override ${probe}.9`).toBe(probe);
  });

  it('when the override is zero, negative, non-numeric, empty or unset, should fall back to the default', async () => {
    // given: each documented shape `parseOverride` must refuse
    // when: the policy module is evaluated under it
    // then: maxWorkers is the fixed default, never the rejected value
    for (const raw of ['0', '-2', 'abc', '', undefined]) {
      const policy = await loadWorkerPolicy(raw);
      expect(
        policy.maxWorkers,
        `override ${raw === undefined ? '<unset>' : JSON.stringify(raw)}`
      ).toBe(policy.DEFAULT_MAX_WORKERS);
    }
  });
});
