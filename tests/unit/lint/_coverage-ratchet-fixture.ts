// tests/unit/lint/_coverage-ratchet-fixture.ts
//
// The shared harness for the coverage floor's two test files. NOT collected by vitest (no
// `.test.ts` suffix), and named with the leading underscore the sibling helpers here use
// (`_file-size-hooks-fixture.ts`, `_file-size-cap-scan.ts`).
//
// WHY THE SPLIT. `.husky/**` is capped at 300 raw lines and `tests/**` at 500, and the coverage-ratchet
// battery crossed 500 once the population-account, anchor and provenance arms joined it. Splitting is
// the cap's own remedy rather than a preference; putting the harness HERE rather than copying it into
// both files is what keeps one spelling of "what a full-population report looks like".
//
// THE TRACKED ARTIFACT IS READ, NEVER RESTATED. `trackedFloor()` parses `.peaks/lint/coverage-floor.json`
// off disk, so an arm cannot pass against a floor no longer on the tree — and the byte copy it returns
// is what the "nothing was written" arms compare against.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY except by the arms that assert a refusal AND byte-compare the
// artifact; every fixture lives under `mkdtempSync(join(tmpdir(), …))` and is removed in a `finally`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const RATCHET_REL = join('.husky', 'coverage-ratchet.mjs');
export const MODULES_REL = join('.husky', 'coverage-ratchet');
export const FLOOR_REL = join('.peaks', 'lint', 'coverage-floor.json');
export const FLOOR_ABS = join(REPO_ROOT, FLOOR_REL);

export type FloorModule = {
  COUNTER: string;
  FLOOR_MARGIN_PP: number;
  floorProblems(document: unknown, options: { population: string }): string[];
  compare(input: { measuredPct: number; linesPct: number }): {
    ok: boolean;
    marginPp: number;
    line: string;
  };
  raisedFloor(measuredPct: number): number;
  raiseRefusal(input: { measuredPct: number; linesPct: number }): string | null;
  loweringRefusal(input: {
    head: { linesPct: number } | null;
    working: { linesPct: number };
    allowLower: boolean;
  }): string | null;
  unaccountedProblem(input: { rows: number; floorRows: number; population: string }): string | null;
};

export type ReportModule = {
  POPULATION_GLOB: string;
  measureArgs(root: string): readonly string[];
  /** The discrimination invariant: matches `<prefix>/src/<f>`, not `<prefix>/packages/<p>/src/<f>`. */
  discriminates(pattern: string, prefix: string): boolean;
  readSummary(
    text: string,
    options: { root: string }
  ): { problem: string | null; files: number; linesPct: number | null; foreign: string[] };
};

/** The two pure modules under test, loaded through their real file paths. */
export async function loadModules(): Promise<{ floor: FloorModule; report: ReportModule }> {
  const load = async (parts: readonly string[]): Promise<unknown> =>
    await import(pathToFileURL(join(REPO_ROOT, ...parts)).href);
  return {
    floor: (await load(['.husky', 'coverage-ratchet', 'floor.mjs'])) as FloorModule,
    report: (await load(['.husky', 'coverage-ratchet', 'report.mjs'])) as ReportModule
  };
}

/** The tracked floor, parsed, plus the bytes it holds. Read off disk; never restated. */
export function trackedFloor(): { linesPct: number; files: number; bytes: string } {
  const bytes = readFileSync(FLOOR_ABS, 'utf8');
  const document = JSON.parse(bytes);
  return { linesPct: document.linesPct, files: document.files, bytes };
}

/** Every tracked file under `src/`, as an absolute path: the population a report must account for. */
export function trackedSourceKeys(): string[] {
  const run = spawnSync('git', ['ls-files', 'src'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    windowsHide: true
  });
  if (run.error !== undefined) throw run.error;
  return (run.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((rel) => join(REPO_ROOT, rel));
}

/** A `coverage-summary.json` in istanbul's json-summary shape, over a chosen set of rows. */
export function fixtureReport(pct: number, keys: readonly string[]): string {
  return JSON.stringify({
    total: { lines: { total: 1000, covered: Math.round(pct * 10), skipped: 0, pct } },
    ...Object.fromEntries(keys.map((key) => [key, { lines: { pct } }]))
  });
}

/** A report that accounts for the WHOLE population, at a chosen percentage. */
export function fullReport(pct: number, population: readonly string[]): string {
  return fixtureReport(pct, population);
}

/** Run the real ratchet from this repository, as a child process. */
export function ratchet(
  args: readonly string[],
  cwd: string = REPO_ROOT
): { code: number; out: string } {
  const result = spawnSync(process.execPath, [RATCHET_REL, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error !== undefined) throw result.error;
  return { code: result.status ?? 1, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

/** Build a scratch dir holding one fixture report, hand its path to `body`, then remove it. */
export function withReport(
  text: string,
  body: (reportPath: string) => void,
  name = 'coverage-summary.json'
): void {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-coverage-floor-'));
  try {
    const path = join(dir, name);
    writeFileSync(path, text, 'utf8');
    body(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
