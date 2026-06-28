/**
 * v2.15.0 follow-up — G14: smoke regression state service.
 *
 * Tracks the project's "critical paths" — the 5-10 paths the user
 * (or the QA agent) must verify in 5-10 minutes before shipping.
 * Persistence: `.peaks/smoke-paths.json` in the project root.
 *
 * The actual path execution (Playwright / curl / manual) is OUT OF
 * SCOPE for this slice — this ships the model + the run-result
 * record path. A follow-up slice wires real Playwright integration.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export type CriticalPathSource =
  | 'prd-business-scenario'    // from prd 业务场景块
  | 'boss-stated'              // 老板强调的流程
  | 'historical-incident'      // 历史事故
  | 'impact-must-check'        // from peaks impact must-check
  | 'manual';                  // user-registered

export type CriticalPathStatus = 'pending' | 'pass' | 'fail';

export interface CriticalPath {
  /** Unique id. */
  readonly id: string;
  /** Human-readable name / description. */
  readonly name: string;
  /** Where this path came from. */
  readonly source: CriticalPathSource;
  /** When it was registered (ISO). */
  readonly registeredAt: string;
  /** Optional category tag (e.g. "登录", "权限", "数据列表"). */
  readonly category?: string;
  /** Latest status + when it was last run. */
  readonly status: CriticalPathStatus;
  readonly lastRunAt?: string;
  readonly lastRunNote?: string;
  /** Optional run history (last 5 runs, oldest first). */
  readonly history: readonly { readonly at: string; readonly status: CriticalPathStatus; readonly note?: string }[];
}

export interface SmokeState {
  readonly version: 1;
  readonly paths: readonly CriticalPath[];
}

export const EMPTY_SMOKE_STATE: SmokeState = { version: 1, paths: [] };

const STATE_FILE = '.peaks/smoke-paths.json';

export function getSmokeStatePath(projectRoot: string): string {
  return resolve(projectRoot, STATE_FILE);
}

export function readSmokeState(projectRoot: string): SmokeState {
  const path = getSmokeStatePath(projectRoot);
  if (!existsSync(path)) return EMPTY_SMOKE_STATE;
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as Partial<SmokeState>;
    if (parsed.version !== 1) return EMPTY_SMOKE_STATE;
    return { version: 1, paths: Array.isArray(parsed.paths) ? parsed.paths : [] };
  } catch {
    return EMPTY_SMOKE_STATE;
  }
}

export function writeSmokeState(projectRoot: string, state: SmokeState): void {
  const path = getSmokeStatePath(projectRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

/** Sources accepted by the CLI's --source flag. */
export const CRITICAL_PATH_SOURCES: readonly CriticalPathSource[] = [
  'prd-business-scenario',
  'boss-stated',
  'historical-incident',
  'impact-must-check',
  'manual'
] as const;

export function isCriticalPathSource(value: string): value is CriticalPathSource {
  return (CRITICAL_PATH_SOURCES as readonly string[]).includes(value);
}

/** Generate a stable id from a name (lowercase, hyphens). */
export function makeCriticalPathId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/** Add a critical path. Deduplicates by id. */
export function addCriticalPath(state: SmokeState, path: CriticalPath): SmokeState {
  const filtered = state.paths.filter((p) => p.id !== path.id);
  return { version: 1, paths: [...filtered, path] };
}

/** Add a run result to a path's history. Keeps the last 5. */
export function recordRun(
  state: SmokeState,
  id: string,
  status: CriticalPathStatus,
  note?: string,
  now: Date = new Date()
): SmokeState {
  let found = false;
  const paths = state.paths.map((p) => {
    if (p.id !== id) return p;
    found = true;
    const newHistory = [...p.history, { at: now.toISOString(), status, ...(note !== undefined ? { note } : {}) }].slice(-5);
    return {
      ...p,
      status,
      lastRunAt: now.toISOString(),
      ...(note !== undefined ? { lastRunNote: note } : {}),
      history: newHistory
    };
  });
  if (!found) return state;
  return { version: 1, paths };
}

/** Convert peaks impact must-check items to critical paths. */
export function impactMustChecksToCriticalPaths(
  items: readonly { scenario: string; category: string; priority: string }[],
  now: Date = new Date()
): CriticalPath[] {
  return items.map((item) => ({
    id: makeCriticalPathId(item.scenario),
    name: item.scenario,
    source: 'impact-must-check',
    registeredAt: now.toISOString(),
    category: item.category,
    status: 'pending',
    history: []
  }));
}

/** Run summary for `peaks smoke run`. */
export interface SmokeRunResult {
  readonly totalPaths: number;
  readonly passedPaths: number;
  readonly failedPaths: number;
  readonly pendingPaths: number;
  readonly failedDetails: readonly { id: string; name: string; lastRunNote?: string }[];
  readonly durationMs: number;
}

/** Compute run summary from current state. */
export function summarizeState(state: SmokeState): SmokeRunResult {
  let passed = 0, failed = 0, pending = 0;
  const failedDetails: { id: string; name: string; lastRunNote?: string }[] = [];
  for (const p of state.paths) {
    if (p.status === 'pass') passed++;
    else if (p.status === 'fail') {
      failed++;
      failedDetails.push({ id: p.id, name: p.name, ...(p.lastRunNote !== undefined ? { lastRunNote: p.lastRunNote } : {}) });
    } else pending++;
  }
  return {
    totalPaths: state.paths.length,
    passedPaths: passed,
    failedPaths: failed,
    pendingPaths: pending,
    failedDetails,
    durationMs: 0  // CLI measures wall time; the service itself is instant
  };
}
