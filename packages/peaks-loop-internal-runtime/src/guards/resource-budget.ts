export interface Sample { rssMb: number; cpuPct: number; }
export interface EnforceInput { active: number; }
export interface EnforceOpts { maxConcurrent: number; }

export class ResourceBudgetGuard {
  constructor(private readonly cfg: { maxRssMb: number; maxCpuPct: number }) {}

  sample(): Sample {
    const m = process.memoryUsage();
    const c = process.cpuUsage();
    const rssMb = Math.round(m.rss / 1024 / 1024);
    const cpuPct = Math.round(((c.user + c.system) / 1_000_000) * 100) / 100;
    return { rssMb, cpuPct };
  }

  enforce(input: EnforceInput, opts: EnforceOpts): { throttle: boolean; kill?: string[] } {
    if (input.active > opts.maxConcurrent) return { throttle: true };
    return { throttle: false };
  }
}