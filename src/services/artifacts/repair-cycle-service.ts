import { showRequestArtifact } from './request-artifact-service.js';

export type RepairCycleEntry = {
  cycle: number;
  timestamp: string;
  reason: string;
};

export type RepairCycleReport = {
  requestId: string;
  sessionId: string;
  path: string;
  cycleCount: number;
  maxCycles: number;
  remaining: number;
  atCap: boolean;
  blocked: boolean;
  entries: RepairCycleEntry[];
};

export type RepairCycleStatusOptions = {
  projectRoot: string;
  requestId: string;
  sessionId?: string;
  maxCycles?: number;
};

const DEFAULT_MAX_CYCLES = 3;

// Matches transition notes Solo writes during repair routing.
// Format example:
//   - transition note (2026-05-25T08:00:00.000Z): QA return-to-rd cycle 1: failing acceptance items A, B
//   - transition note (2026-05-25T09:00:00.000Z): QA cycle 2: regression in module X
const REPAIR_NOTE_PATTERN = /-\s*transition note\s*\(([^)]+)\)\s*:\s*(?:QA(?:\s+return-to-rd)?\s+cycle\s+(\d+))\s*:?\s*(.*?)$/i;

export async function getRepairCycleStatus(options: RepairCycleStatusOptions): Promise<RepairCycleReport | null> {
  const showOptions: Parameters<typeof showRequestArtifact>[0] = {
    projectRoot: options.projectRoot,
    role: 'rd',
    requestId: options.requestId
  };
  if (options.sessionId !== undefined) {
    showOptions.sessionId = options.sessionId;
  }
  const artifact = await showRequestArtifact(showOptions);
  if (artifact === null) {
    return null;
  }
  const maxCycles = options.maxCycles ?? DEFAULT_MAX_CYCLES;
  const lines = artifact.content.split(/\r?\n/);
  const entries: RepairCycleEntry[] = [];
  for (const rawLine of lines) {
    const match = REPAIR_NOTE_PATTERN.exec(rawLine);
    if (match === null) continue;
    const [, timestamp, cycleStr, reason] = match;
    if (timestamp === undefined || cycleStr === undefined) continue;
    const cycle = Number(cycleStr);
    if (!Number.isFinite(cycle) || cycle < 1) continue;
    entries.push({ cycle, timestamp, reason: (reason ?? '').trim() });
  }
  // Distinct cycle numbers — repair loop may write the same cycle note multiple times.
  const distinct = new Set(entries.map((entry) => entry.cycle));
  const cycleCount = distinct.size;
  const remaining = Math.max(0, maxCycles - cycleCount);
  const atCap = cycleCount >= maxCycles;
  return {
    requestId: options.requestId,
    sessionId: artifact.sessionId,
    path: artifact.path,
    cycleCount,
    maxCycles,
    remaining,
    atCap,
    blocked: atCap,
    entries
  };
}
