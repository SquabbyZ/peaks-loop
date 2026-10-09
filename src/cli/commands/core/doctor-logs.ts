import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type DoctorLogsSection = {
  logDir: string;
  todayFile: string;
  sizeBytes: number;
  retentionDays: number;
  level: string;
};

//
// `buildDoctorLogsSection` reads the on-disk log dir and returns the
// metadata the doctor needs to render the "logs" block. It is
// extracted from the inline `peaks doctor --log` action so the
// command stays small and the helper is unit-testable without
// spinning up the full program.
export async function buildDoctorLogsSection(): Promise<DoctorLogsSection> {
  // Lazy import to avoid a circular dep at module-load time
  // (core-artifact-commands is imported very early in program.ts).
  const { resolveLogDir, buildLogFileName } = await import('../../../services/log/logger.js');
  const logDir = resolveLogDir();
  const todayFile = buildLogFileName(new Date());
  const fullPath = join(logDir, todayFile);
  let sizeBytes = 0;
  if (existsSync(fullPath)) {
    try {
      sizeBytes = statSync(fullPath).size;
    } catch {
      sizeBytes = 0;
    }
  }
  return {
    logDir,
    todayFile,
    sizeBytes,
    retentionDays: 7,
    level: process.env.PEAKS_LOG_LEVEL ?? 'info'
  };
}
