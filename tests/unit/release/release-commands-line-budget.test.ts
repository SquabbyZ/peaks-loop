/**
 * rid-010 — release-commands.ts line-budget sanity guard.
 *
 * Covers AC-10: no new file under src/cli/commands/release/ exceeds the
 * 400-line sanity guard. Automated assertion so a future regression is caught
 * by CI (W3 fix from QA verdict).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const FILE = resolve(process.cwd(), 'src', 'cli', 'commands', 'release-commands.ts');
const LINE_BUDGET = 400;

function countLines(path: string): number {
  const src = readFileSync(path, 'utf8');
  return src.split('\n').length;
}

describe('release-commands.ts line-budget guard', () => {
  it('file exists', () => {
    expect(existsSync(FILE)).toBe(true);
  });

  it('is below the 400-line sanity guard', () => {
    const lines = countLines(FILE);
    expect(lines, `release-commands.ts must be ≤ ${LINE_BUDGET} lines (current: ${lines})`).toBeLessThanOrEqual(LINE_BUDGET);
  });

  it('has a readable source file size > 0', () => {
    const st = statSync(FILE);
    expect(st.size).toBeGreaterThan(0);
  });
});