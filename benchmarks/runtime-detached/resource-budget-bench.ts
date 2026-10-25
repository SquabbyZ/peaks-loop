/**
 * §5.3 resource ceiling bench — the rail that says the detached runtime itself stays
 * under 200 MB resident and under 5 % CPU while idle.
 *
 * WHAT IT SAMPLES, STATED PLAINLY. Two samples of THIS PROCESS: a startup sample,
 * taken before any work, which characterises the tsx runner that compiled this file;
 * and an idle-window sample, taken after a quiet interval, which characterises this
 * process while it is idle. NEITHER is the §5.3 population: that one is the peaks
 * runtime under a real detached dispatch, and the result says so rather than implying
 * the product was measured.
 *
 * WHY THE UNIT IS NAMED OUT LOUD. The guard's first CPU field divided microseconds by
 * 1e6 and multiplied by 100, which yields CENTISECONDS — so a field named `cpuPct` was
 * compared against a documented "5 %" rail while actually holding 5 centiseconds
 * (50 ms), and the bench that read it could not fail. The guard now reports `cpuPct`
 * as a percentage of one CPU core over the sampled window and `cpuCentiseconds` under
 * its true unit; this bench prints both, with their units, and says what the configured
 * threshold actually means.
 *
 * WHY THE GUARD IS IMPORTED FROM ITS SOURCE FILE. The package's public entry
 * (`peaks-loop-internal-runtime`) resolves to `dist/index.js`, so importing it would
 * require a build before the bench could run; and that entry re-exports the whole
 * runtime — adapters, supervisor, dispatch — which would drag all of it into the
 * measurement and change what the resident-set number describes. This file is the very
 * module the package re-exports, so the measurement stays about the guard.
 */

import { ResourceBudgetGuard } from '../../packages/peaks-loop-internal-runtime/src/guards/resource-budget.js';

import { isEntryPoint } from './baseline.js';

/** The design spec of record. §5 性能护栏 holds the two ceilings this bench reads. */
export const SPEC_REF =
  'docs/superpowers/specs/2026-08-10-peaks-detached-sub-agent-design.md §5 性能护栏 (lines 331-332)';

/** §5.3: the runtime's own resident set must stay under this, in mebibytes. */
const MAX_RSS_MB = 200;
/** §5.3: the runtime's own idle CPU must stay under this, as a percentage of one core. */
const MAX_CPU_PCT = 5;
/**
 * The window the rail is judged on. SHORTER than the 1-minute average the §5.3 rail
 * names: a bench has to finish, and the long window is what catches a slow leak.
 */
const IDLE_WINDOW_MS = 1_000;
/**
 * The window BEFORE the measured one, and it is not decoration.
 *
 * WHY A WARM-UP WINDOW EXISTS. The first idle window of a tsx-run process is not idle:
 * the loader is still finishing its own work (esbuild's service thread, source-map
 * caching, the first GC). Measured on this repository: the first window read 3-9 % CPU
 * and every window after it read 0 %. Judging the rail on that first window would
 * report the RUNNER's startup tail as the runner's idle cost, which is the same class
 * of lie this bench exists to remove — so the warm-up window is measured, reported,
 * and excluded from the verdict.
 */
const WARMUP_WINDOW_MS = 1_000;

/** One sample of a process's footprint, with the unit of each number stated. */
export interface ResourceSample {
  readonly rssMb: number;
  readonly cpuPct: number;
  readonly cpuCentiseconds: number;
  readonly describes: string;
}

/** The machine-readable result of one bench run. */
export interface ResourceBudgetBenchResult {
  readonly schemaVersion: 1;
  readonly bench: 'resource-budget';
  readonly specRef: string;
  /** The unit of every number this result carries. */
  readonly unit: {
    readonly rssMb: string;
    readonly cpuPct: string;
    readonly cpuCentiseconds: string;
  };
  /** The rail this bench reads, and what its numbers mean. */
  readonly threshold: {
    readonly maxRssMb: number;
    readonly maxCpuPct: number;
    readonly maxCpuPctMeans: string;
  };
  /** The population the numbers below were taken from. */
  readonly measurementScope: string;
  readonly samples: {
    readonly startup: ResourceSample;
    readonly warmupWindow: ResourceSample & { readonly windowMs: number };
    readonly idleWindow: ResourceSample & { readonly windowMs: number };
  };
  readonly passesGate: boolean;
  /** What `passesGate` is a verdict ABOUT. */
  readonly gateScope: string;
  /** The rail that was NOT measured, and why. */
  readonly productRail: {
    readonly state: 'not-measured';
    readonly missingCapability: string;
  };
  readonly exitCode: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

/** Sample this process three times — at start, over a warm-up window, and over the idle window the rail is judged on. */
export async function runResourceBudgetBench(): Promise<ResourceBudgetBenchResult> {
  const guard = new ResourceBudgetGuard({ maxRssMb: MAX_RSS_MB, maxCpuPct: MAX_CPU_PCT });
  const startup = guard.sample();
  await sleep(WARMUP_WINDOW_MS);
  const warmup = guard.sample();
  await sleep(IDLE_WINDOW_MS);
  const idle = guard.sample();
  const passesGate = idle.rssMb <= MAX_RSS_MB && idle.cpuPct <= MAX_CPU_PCT;
  return {
    schemaVersion: 1,
    bench: 'resource-budget',
    specRef: SPEC_REF,
    unit: {
      rssMb: 'mebibytes of resident set size',
      cpuPct:
        'percent of ONE CPU core over the sampled window (100% = one core fully busy; above 100% means the process used more than one core, e.g. a threaded loader)',
      cpuCentiseconds: 'centiseconds of CPU time over the sampled window (1 centisecond = 10 ms)'
    },
    threshold: {
      maxRssMb: MAX_RSS_MB,
      maxCpuPct: MAX_CPU_PCT,
      maxCpuPctMeans:
        '5% of ONE CPU core over the sampled window — NOT 5 centiseconds. The guard used to put centiseconds in a field named cpuPct, so this threshold used to mean 50 ms of CPU.'
    },
    measurementScope:
      'this bench process only (the tsx runner plus the ResourceBudgetGuard) — NOT the peaks runtime product, and NOT a dispatched sub-agent',
    samples: {
      startup: {
        rssMb: startup.rssMb,
        cpuPct: startup.cpuPct,
        cpuCentiseconds: startup.cpuCentiseconds,
        describes:
          'this bench process at process start — it characterises the tsx runner that compiled this file, not any product'
      },
      warmupWindow: {
        rssMb: warmup.rssMb,
        cpuPct: warmup.cpuPct,
        cpuCentiseconds: warmup.cpuCentiseconds,
        windowMs: WARMUP_WINDOW_MS,
        describes:
          'this bench process while the loader was still finishing its own startup work — measured and reported, but NOT judged against the rail'
      },
      idleWindow: {
        rssMb: idle.rssMb,
        cpuPct: idle.cpuPct,
        cpuCentiseconds: idle.cpuCentiseconds,
        windowMs: IDLE_WINDOW_MS,
        describes:
          'this bench process while idle for the window — still the runner, not the runtime under a dispatch'
      }
    },
    passesGate,
    gateScope: 'the measured population (this bench process) only',
    productRail: {
      state: 'not-measured',
      missingCapability:
        "a real detached dispatch (a vendor CLI on PATH) to sample the peaks runtime's OWN resident set and idle CPU while it fans out sub-agents"
    },
    exitCode: passesGate ? 0 : 1
  };
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  runResourceBudgetBench().then((result) => {
    console.log(JSON.stringify(result));
    process.exitCode = result.exitCode;
  });
}
