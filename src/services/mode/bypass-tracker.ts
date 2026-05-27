import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_BYPASSES_PER_SESSION = 3;

const BYPASS_FILE = '.bypass-count.json';

type BypassCount = { count: number };

function bypassFilePath(sessionRoot: string): string {
  return join(sessionRoot, BYPASS_FILE);
}

export function getBypassCount(sessionRoot: string): number {
  const filePath = bypassFilePath(sessionRoot);
  if (!existsSync(filePath)) {
    return 0;
  }
  try {
    const raw = readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw) as BypassCount;
    return typeof parsed.count === 'number' ? parsed.count : 0;
  } catch {
    return 0;
  }
}

export function recordBypass(sessionRoot: string): number {
  const current = getBypassCount(sessionRoot);
  const next = current + 1;
  const filePath = bypassFilePath(sessionRoot);
  writeFileSync(filePath, JSON.stringify({ count: next }, null, 2), 'utf8');
  return next;
}

export function isBypassLimitReached(sessionRoot: string): boolean {
  return getBypassCount(sessionRoot) >= MAX_BYPASSES_PER_SESSION;
}
