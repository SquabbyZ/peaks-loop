// tests/integration/readonly-surface/readonly-proof.test.ts
//
// The three-layer read-only proof (PRD rid-035 AC-3, AC-4, AC-6, AC-7) for the five
// curated argv of `contracts/readonly-argv-whitelist.json`.
//
// WHY THIS IS AN INTEGRATION TEST. Layers A and B require a REAL CLI process:
// layer B's instrumentation lives inside that process, and layer A's timeout leg
// (AC-7) can only be observed on a process the harness can kill. The launch shape
// stays platform-neutral by construction - `process.execPath` plus `bin/peaks.js`
// as array elements, with no `if (win32)` anywhere (PRD R1, spec §8.2).
//
//   A  state read-only   snapshot(project tree + fixture home, less the global log
//                        directory) is byte-identical before and after.
//   B  no side effects   the same argv, run with the spy preload installed INSIDE
//                        the CLI process, report zero spawn and zero network calls.
//                        Its injection control - the same spy counting a probe's
//                        calls - runs first, so a zero cannot mean "measured nothing".
//   C  it really did not happen   CI-only: inside a network-less namespace with the
//                        fixture made unwritable (on win32, honestly, only
//                        unMODIFIABLE - see `_proof-helpers.ts`). The arm PROVES both
//                        conditions before trusting any result, so setting the flag on
//                        an ordinary host fails instead of reporting a sandbox it was
//                        never in.
//
// A MISSING BUILD IS A FAILURE, NOT A SKIP (QA repair cycle 1, P1). Layers A and B
// run unconditionally. The precondition arm below fails when `dist/cli/index.js` is
// absent instead of moving the proof aside, because a proof that can vanish reports
// success exactly as loudly as a proof that ran. This file therefore does NOT use the
// repo's `PEAKS_BUILD_AVAILABLE` skip convention (`vitest.config.integration.ts` sets
// it from `bin/peaks.js` + `dist/cli/program.js`): that convention was measured to
// read "available" while this proof's own entry artifact was missing, which is the
// silent-skip being closed here. Layer C keeps its sandbox gate; a sandbox that was
// never requested is an honest, stated skip, not a hidden one.
//
// Dimensions covered: behavior, integration, a11y.
// Dimensions omitted: render - every output shape asserted here (a digest, a call
// counter, an exit code) belongs to the CLI's own suites, not to this proof.
//
// Run with: pnpm exec vitest run --config vitest.config.integration.ts tests/integration/readonly-surface

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../unit/_setup/4dim-template.js';
import { HEAVY_SUBPROCESS_TEST_TIMEOUT_MS } from '../../unit/_setup/subprocess-timeouts.js';
import { buildArgv } from '~/src/services/readonly-surface/argv-guard';
import { loadReadOnlyWhitelist } from '~/src/services/readonly-surface/readonly-whitelist';
import {
  ARGV_TIMEOUT_MS,
  DIST_ENTRY,
  LOG_DIR_RELATIVE,
  SPY_PRELOAD_URL,
  SPY_PROBE_PATH,
  createReadonlyFixture,
  diffTrees,
  digestTree,
  disposeFixture,
  isGlobalLog,
  measurePopulation,
  runCli,
  sandboxRequested,
  snapshotDigest,
  type ReadonlyFixture
} from './_proof-helpers.js';

declareDimensions(
  'tests/integration/readonly-surface/readonly-proof.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the CLI owns its envelope shapes; this file asserts state digests, call counters and exit codes.'
    }
  ]
);

const SANDBOX_REQUESTED = sandboxRequested();

let fixture: ReadonlyFixture;
let spyDir: string;

beforeAll(() => {
  // NO FIXTURE WITHOUT A BUILD (QA repair cycle 1, P1). Building the fixture here
  // when `dist/cli/index.js` is missing would throw inside this hook, and a throwing
  // file-level `beforeAll` turns EVERY arm below into a skip - the fail-open this
  // file exists to refuse, one layer up from where it was first found. Instead the
  // precondition arm below reports the real reason, and the layer arms run against a
  // missing fixture and fail loudly.
  if (!existsSync(DIST_ENTRY)) return;
  fixture = createReadonlyFixture();
  spyDir = mkdtempSync(join(tmpdir(), 'peaks-readonly-spy-'));
}, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

afterAll(() => {
  disposeFixture(fixture);
  // A build-less run has no spy directory; `typeof` (not `!== undefined`) keeps the
  // narrow-to-nothing check honest for the compiler, which sees `spyDir: string`.
  if (typeof spyDir === 'string') rmSync(spyDir, { recursive: true, force: true });
});

/**
 * The whitelist's own entries, rendered with fixture-legal values through the
 * AC-5/AC-6 guard. Deriving the proof's input from the artifact - rather than
 * restating a list - means the proof covers exactly what the artifact claims, and
 * an entry that cannot be rendered fails here instead of passing silently.
 */
function curatedArgv(): ReadonlyArray<readonly string[]> {
  return loadReadOnlyWhitelist().entries.map((entry) => {
    const values: Record<string, string> =
      entry.id === 'request-show'
        ? { rid: 'fixture-request', role: 'rd', project: fixture.projectRoot }
        : entry.id === 'memory-search'
          ? { query: 'fixture', limit: '6' }
          : {};
    const built = buildArgv(entry, values);
    if (!built.ok) throw new Error(`cannot render ${entry.id}: ${built.message}`);
    return built.argv;
  });
}

/**
 * The argv the surface EXCLUDES, kept here as a live measurement rather than a
 * comment: `project dashboard` resolves its project root through
 * `findProjectRoot`, which runs `git rev-parse --show-toplevel`, so it spawns an
 * external process and fails the definition's fourth clause. Artifacting that fact
 * means a later change that removes the spawn shows up as this arm going green.
 */
function excludedArgv(): readonly string[] {
  return ['project', 'dashboard', '--json', '--project', fixture.projectRoot];
}

/** The project tree plus the fixture home, less the global log directory. */
function snapshotTrees(): ReadonlyArray<{ root: string; exclude?: (p: string) => boolean }> {
  return [{ root: fixture.projectRoot }, { root: fixture.homeDir, exclude: isGlobalLog }];
}

interface SpyCounters {
  childProcess: number;
  network: number;
  calls: string[];
}

function spyCounters(argv: readonly string[], index: number): SpyCounters & { code: number } {
  const out = join(spyDir, `spy-${index}.json`);
  rmSync(out, { force: true });
  const run = runCli(argv, { cwd: fixture.projectRoot, env: fixture.env, spyOut: out });
  const text = existsSync(out)
    ? readFileSync(out, 'utf8')
    : '{"childProcess":-1,"network":-1,"calls":["NO-SPY-OUTPUT"]}';
  return { ...(JSON.parse(text) as SpyCounters), code: run.code };
}

/**
 * The proof's prerequisite, asserted rather than skipped. Layers A/B/C all launch the
 * built CLI, so a missing `dist/cli/index.js` means the proof would measure nothing -
 * and, before this arm existed, it measured nothing while reporting nine skips and a
 * zero exit code. This arm is deliberately NOT wrapped in `skipIf`: it is the arm whose
 * whole job is to be red when the artifact is gone.
 */
describe('Scenario: integration — the proof cannot vanish with the build', () => {
  it('when the build artifact is missing, should fail the suite rather than skip the proof', () => {
    // given: the artifact every layer below spawns (bin/peaks.js imports it)
    // when:  its existence is measured
    // then:  it IS there - a missing build is a failure, never a silent skip
    expect(
      existsSync(DIST_ENTRY),
      `${DIST_ENTRY} is missing, so the three-layer proof cannot run. ` +
        'This is a FAILURE, not a skip: a proof that vanishes still reports success. ' +
        'Build first (`npm run build`), then re-run this suite. ' +
        `(Repo convention PEAKS_BUILD_AVAILABLE=${process.env['PEAKS_BUILD_AVAILABLE'] ?? 'unset'} ` +
        'is not sufficient here - it checks different artifacts.)'
    ).toBe(true);
  }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);
});

describe('Scenario: integration — layer A, state is read-only', () => {
  it('when each curated argv runs on a populated fixture, should leave the tree byte-identical', () => {
    // given: a fixture whose sessions, memory, job and request artifacts the CLI wrote itself
    const trees = snapshotTrees();
    const beforeTree = digestTree(fixture.projectRoot);
    const beforeDigest = snapshotDigest(trees);

    // when:  every curated argv is executed in its own process, under a forced timeout
    const runs = curatedArgv().map((argv) =>
      runCli(argv, { cwd: fixture.projectRoot, env: fixture.env })
    );

    // then:  each one really ran - exit 0 and no timeout - and nothing on disk moved
    for (const run of runs) {
      expect(run.timedOut, `peaks ${run.argv.join(' ')} exceeded ${ARGV_TIMEOUT_MS}ms`).toBe(false);
      expect(run.code, `peaks ${run.argv.join(' ')} → ${run.stderr}`).toBe(0);
    }
    expect(diffTrees(beforeTree, digestTree(fixture.projectRoot))).toEqual([]);
    expect(snapshotDigest(trees)).toBe(beforeDigest);
  }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

  it('when the excluded log directory is inspected, should really hold the appends it is excused for', () => {
    // given: the fixture home after the runs above, whose log directory is excluded from the digest
    // when:  the excluded region is read directly
    // then:  it is non-empty - the allowance is a measured exception, not a blind spot
    const logFiles = [...digestTree(fixture.homeDir).keys()].filter((path) =>
      path.startsWith(`${LOG_DIR_RELATIVE}/`)
    );
    expect(logFiles.length).toBeGreaterThan(0);
  }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

  it('when the fixture is audited for population, should be non-empty for all four artifact kinds', () => {
    // given: the fixture the layer-A arm ran against
    // when:  its population is measured
    // then:  it is valid - the zero-change result above is a measurement, not an empty set
    const population = measurePopulation(fixture.projectRoot);
    expect(population.reason).toContain('session');
    expect(population.valid).toBe(true);
    expect(population.sessions).toBeGreaterThan(0);
    expect(population.memoryEntries).toBeGreaterThan(0);
    expect(population.jobs).toBeGreaterThan(0);
    expect(population.requests).toBeGreaterThan(0);
  }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

  it('when an empty directory is audited instead, should be refused as an invalid zero-change result', () => {
    // given: an empty temp directory, which is what "nothing was read" looks like
    const empty = mkdtempSync(join(tmpdir(), 'peaks-readonly-empty-'));

    try {
      // when:  it is measured
      const population = measurePopulation(empty);

      // then:  it is invalid and says which kinds are missing, so AC-4's refusal is exercisable
      expect(population.valid).toBe(false);
      expect(population.reason).toContain('sessions');
      expect(population.reason).toContain('memory entries');
      expect(population.reason).toContain('jobs');
      expect(population.reason).toContain('requests');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);
});

describe(
  'Scenario: integration — layer B, the CLI spawns nothing and reaches no network',
  () => {
    it('when the spy is installed in the probe, should count that probe\'s spawn and network calls', () => {
      // given: a probe that spawns a process, opens an http request and calls fetch
      const out = join(spyDir, 'control.json');
      rmSync(out, { force: true });

      // when:  it runs under the very preload the CLI arms use
      execFileSync(process.execPath, ['--import', SPY_PRELOAD_URL, SPY_PROBE_PATH], {
        cwd: fixture.projectRoot,
        env: { ...process.env, ...fixture.env, PEAKS_READONLY_SPY_OUT: out },
        stdio: 'ignore',
        windowsHide: true
      });

      // then:  the instrument observed the calls, so a zero elsewhere is a finding
      const counters = JSON.parse(readFileSync(out, 'utf8')) as SpyCounters;
      expect(counters.childProcess).toBeGreaterThan(0);
      expect(counters.network).toBeGreaterThan(0);
      expect(counters.calls).toContain('node:child_process.spawnSync');
    }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

    it('when each curated argv runs, should spawn nothing and reach no network', () => {
      // given: a populated fixture with the preload installed inside the CLI process
      // when:  every curated argv executes, each in its own process
      // then:  both counters are exactly zero and the call log is empty
      let index = 0;
      for (const argv of curatedArgv()) {
        const counters = spyCounters(argv, index);
        index += 1;
        expect(counters.code, `peaks ${argv.join(' ')} did not exit 0`).toBe(0);
        expect(counters.childProcess, `peaks ${argv.join(' ')} spawned a process`).toBe(0);
        expect(counters.network, `peaks ${argv.join(' ')} reached the network`).toBe(0);
        expect(counters.calls, `peaks ${argv.join(' ')} call log`).toEqual([]);
      }
    }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

    it('when the excluded argv runs, should be measured spawning - which is why it is not in the surface', () => {
      // given: the argv the surface left out
      // when:  it runs under the same spy
      // then:  the spawn is reproduced as a live fact, so the exclusion is evidence and not a note
      const counters = spyCounters(excludedArgv(), 90);
      expect(counters.code).toBe(0);
      expect(counters.childProcess).toBeGreaterThan(0);
      expect(counters.calls).toContain('node:child_process.execFileSync');
    }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);
  }
);

describe.skipIf(!SANDBOX_REQUESTED)(
  'Scenario: integration — layer C, the same result inside a real sandbox (CI-only)',
  () => {
    it('when the sandbox is claimed, should prove the claim before trusting any result from it', async () => {
      // given: a process told it is running with no network and an unwritable project tree
      // when:  the claim is TESTED rather than assumed
      // then:  both halves must hold, or this arm fails - the flag cannot manufacture a sandbox
      let networkReachable = true;
      try {
        await fetch('https://registry.npmjs.org/-/ping', { signal: AbortSignal.timeout(5000) });
      } catch {
        networkReachable = false;
      }
      expect(networkReachable, 'network is reachable: this is not a no-network sandbox').toBe(false);

      readFileSync(join(fixture.projectRoot, '.peaks', '_runtime', 'session.json'), 'utf8');
      // The unwritable half is a Linux-runner contract, and this arm is the reason it
      // is asserted before any result is trusted. On win32 the same chmod does NOT stop
      // a NEW file being created in a 0o555 directory (only modifying an existing file
      // raises EPERM - measured by QA), so this arm is expected to be reachable only on
      // the CI runner. Locally on Windows it is not reached at all: the network
      // assertion above fails first, which is the honest outcome.
      expect(() =>
        writeFileSync(join(fixture.projectRoot, '.peaks', 'readonly-probe.tmp'), 'x')
      ).toThrow();
    }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);

    it('when each curated argv runs inside the sandbox, should agree with the unsandboxed result', () => {
      // given: the same fixture, now on an unmodifiable tree inside a network-less
      //        namespace. "Unmodifiable" rather than "unwritable" is the honest wording:
      //        on win32 the chmod stops modification, not creation (see _proof-helpers.ts).
      const trees = snapshotTrees();
      const beforeDigest = snapshotDigest(trees);

      // when:  every curated argv runs with the layer-B preload
      let index = 100;
      for (const argv of curatedArgv()) {
        const counters = spyCounters(argv, index);
        index += 1;
        // then:  the sandbox changes nothing - same exit codes, same zero counters
        expect(counters.code, `peaks ${argv.join(' ')} did not exit 0 in the sandbox`).toBe(0);
        expect(counters.childProcess).toBe(0);
        expect(counters.network).toBe(0);
      }
      expect(snapshotDigest(trees)).toBe(beforeDigest);
    }, HEAVY_SUBPROCESS_TEST_TIMEOUT_MS);
  }
);
