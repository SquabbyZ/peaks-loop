/**
 * §5.3 performance ceiling rails for the detached runtime.
 *
 * WHY `cpuPct` USED TO LIE. The first version of this guard computed
 * `cpuPct` as `((user + system) / 1_000_000) * 100`. `process.cpuUsage()`
 * reports MICROSECONDS, so that expression yields CENTISECONDS: a field named
 * `cpuPct` that no reader could compare against the documented "idle CPU ≤ 5 %"
 * rail without reverse-engineering the unit first. A threshold of 5 therefore
 * meant 50 ms of CPU rather than 5 %, and the bench that read it compared a
 * number about the RUNNER's startup against a rail written about the PRODUCT.
 *
 * THE UNIT AND THE NAME NOW AGREE. `cpuPct` is a percentage of ONE CPU core
 * over the sampled window, and `cpuCentiseconds` carries the same window's
 * absolute CPU cost under its true unit. `cpuPct` keeps its name and its place
 * in `Sample`, so every existing reader still compiles and still sees a
 * non-negative number; what changed is what the number MEANS — it is now the
 * quantity the documented rail talks about.
 *
 * THE WINDOW IS THE INTERVAL SINCE THE PREVIOUS SAMPLE. The first sample of a
 * process covers the whole process so far, because there is no earlier sample
 * to subtract. A guard that samples every 10 s (design §5) therefore reads the
 * cost of the last 10 s rather than the cost of everything since boot — which
 * is the number a ceiling rail is supposed to judge.
 */

/** Bytes in one kibibyte — the divisor that turns the OS's byte counts into mebibytes. */
const KIBIBYTE = 1024;
/** Bytes in one mebibyte. */
const BYTES_PER_MEGABYTE = KIBIBYTE * KIBIBYTE;
/** Milliseconds in one second — the scale between `process.uptime()` and the CPU clock. */
const MILLISECONDS_PER_SECOND = 1000;
/** Microseconds in one millisecond — the unit `process.cpuUsage()` reports. */
const MICROSECONDS_PER_MILLISECOND = 1000;
/** Microseconds in one centisecond — the unit the old `cpuPct` field actually held. */
const MICROSECONDS_PER_CENTISECOND = 10_000;
/** A percentage is a ratio out of a hundred. */
const PERCENT = 100;

export interface Sample {
  rssMb: number;
  /** CPU consumed over the sampled window, as a percentage of ONE CPU core. */
  cpuPct: number;
  /** CPU consumed over the sampled window, in centiseconds (1 centisecond = 10 ms). */
  cpuCentiseconds: number;
}
export interface EnforceInput {
  active: number;
}
export interface EnforceOpts {
  maxConcurrent: number;
}

export class ResourceBudgetGuard {
  /** CPU microseconds at the previous sample; null before the first sample. */
  private lastCpuUs: number | null = null;
  /** Wall-clock milliseconds at the previous sample; null before the first sample. */
  private lastWallMs: number | null = null;

  constructor(private readonly cfg: { maxRssMb: number; maxCpuPct: number }) {}

  sample(): Sample {
    const usage = process.cpuUsage();
    const cpuUs = usage.user + usage.system;
    const wallMs = process.uptime() * MILLISECONDS_PER_SECOND;
    const previousCpuUs = this.lastCpuUs;
    const previousWallMs = this.lastWallMs;
    this.lastCpuUs = cpuUs;
    this.lastWallMs = wallMs;
    const windowCpuUs = previousCpuUs === null ? cpuUs : cpuUs - previousCpuUs;
    const windowWallMs = previousWallMs === null ? wallMs : wallMs - previousWallMs;
    const rssMb = Math.round(process.memoryUsage().rss / BYTES_PER_MEGABYTE);
    const cpuCentiseconds = round2(windowCpuUs / MICROSECONDS_PER_CENTISECOND);
    const cpuPct =
      windowWallMs > 0
        ? round2((windowCpuUs / MICROSECONDS_PER_MILLISECOND / windowWallMs) * PERCENT)
        : 0;
    return { rssMb, cpuPct, cpuCentiseconds };
  }

  enforce(input: EnforceInput, opts: EnforceOpts): { throttle: boolean; kill?: string[] } {
    if (input.active > opts.maxConcurrent) return { throttle: true };
    return { throttle: false };
  }
}

/** Two decimals: enough to see a change between two samples, few enough to read. */
function round2(value: number): number {
  return Math.round(value * PERCENT) / PERCENT;
}
