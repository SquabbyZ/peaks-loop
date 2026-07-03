import os from 'node:os';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { ResourceSnapshot } from './job-types.js';

/**
 * Collects a coarse-grained snapshot of host + project resources.
 * Numeric ranges are clamped to zod's domain — out-of-range values are clamped, not thrown,
 * so callers can decide what to do.
 */
export function collectResourceSnapshot(jobDir: string): ResourceSnapshot {
  const cpus = os.cpus();
  const loadAvg = (os.loadavg()[0] ?? 0) / (cpus.length || 1);
  const cpuPercent = Math.max(0, Math.min(100, loadAvg * 100));

  const totalMemMb = os.totalmem() / 1024 / 1024;
  const freeMemMb = os.freemem() / 1024 / 1024;
  const usedMemMb = Math.max(0, totalMemMb - freeMemMb);
  const memMb = Math.round(usedMemMb);

  const diskMb = dirSizeMb(jobDir);

  // contextRatio is best-effort: pull from the same env-var the v2.13.0 auto-compact uses.
  const envVal = process.env.CLAUDE_CONTEXT_USAGE_PERCENT;
  const contextRatio = envVal ? Math.max(0, Math.min(1, Number(envVal) / 100)) : 0;

  return {
    capturedAt: new Date().toISOString(),
    cpuPercent,
    memMb,
    diskMb,
    contextRatio,
  };
}

function dirSizeMb(dir: string): number {
  let total = 0;
  try {
    for (const name of readdirSync(dir)) {
      try { total += statSync(join(dir, name)).size; } catch { /* missing entry */ }
    }
  } catch { /* missing dir is fine */ }
  return Math.round(total / 1024 / 1024);
}
