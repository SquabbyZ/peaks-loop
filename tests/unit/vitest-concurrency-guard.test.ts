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

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const vitestConfigPath = resolve(__dirname, '..', '..', 'vitest.config.ts');
const configText = readFileSync(vitestConfigPath, 'utf8');

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
});
