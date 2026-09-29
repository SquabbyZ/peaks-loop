/**
 * `src/services/scan/api-surface-helpers.ts`
 *
 * Small pure helpers (line lookup, name de-duplication, include-dir
 * parsing) extracted verbatim from `api-surface-service.ts` (wave 2,
 * file-size cap campaign) so the scanner stays under the 300 raw-line
 * cap. Mechanical move only; these were module-private before the move.
 */

const DEFAULT_DIRS = ['src/cli', 'src/services'] as const;

export function lineOf(content: string, matchIndex: number): number {
  return content.slice(0, matchIndex).split('\n').length;
}

export function uniqueByName<T extends { name: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    out.push(item);
  }
  return out;
}

export function parseIncludeDirs(raw: string | undefined): string[] {
  if (!raw) return [...DEFAULT_DIRS];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
