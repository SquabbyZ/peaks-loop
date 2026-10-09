// tests/unit/lint/_silent-warning-scope-fixture.ts
//
// The harness behind `silent-warning-scope-leg.test.ts` and
// `baseline-rescope-leg-scope.test.ts` (rid `2026-10-03-silent-warning-scope`,
// backlog §2.43): the shared `createFixture` repository with the REAL
// `scripts/lint/silent-warning-detector.mjs` installed over the harness's stub.
//
// WHY THE STUB CANNOT SER THESE ARMS. Every existing fixture stages
// `DETECTOR_STUB`, a script that answers a fixed envelope whatever it is handed.
// That was harmless while the leg asked the detector for its own `src/` walk and
// recorded the answer as a footnote. This slice's claim is about the POPULATION —
// "the leg scanned exactly the files the gate's scope contains" — and a stub that
// ignores its argv cannot distinguish a leg that measured 943 files from one that
// measured 905. The arms here would pass against a lie. So the harness's stub is
// replaced by the file the repository actually spawns, copied byte-for-byte, and
// the one dependency it resolves by absolute path (`node_modules/typescript`) is
// shimmed to this repository's installed copy.
//
// WHAT IS STILL STUBBED, AND WHY THAT IS NOT THE POINT: eslint and tsc (the
// harness's forwarders, untouched) and the census (real, forwarded). The prettier
// leg is REAL, which is why every planted source below is prettier-clean: a
// planted file that reformatted would raise `prettierUnformatted` and the arm
// would refuse for the wrong reason.
//
// NOTHING IS WRITTEN INTO THIS REPOSITORY (§2.31): every instance is a
// `mkdtempSync` scratch repository with its own `git init`, removed by the
// collected file's `afterAll`.

import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import {
  createFixture,
  rowFor,
  type Fixture,
  type FixtureRun
} from './_file-size-hooks-fixture.js';

const DETECTOR_REL = join('scripts', 'lint', 'silent-warning-detector.mjs');
const TS_LIB_REL = join('node_modules', 'typescript', 'lib', 'typescript.js');
const GATE_REL = join('.husky', 'peaks-gate.mjs');
const MAX_BUFFER = 64 * 1024 * 1024;

/** The two rows the leg prints, in `SW_RULES` order, and the keys behind them. */
export const ROW_NULL = 'silent-warn return-null';
export const ROW_EMPTY = 'silent-warn empty-catch';
export const KEY_NULL = 'silentWarningCatchReturnNull';
export const KEY_EMPTY = 'silentWarningEmptyCatch';

/** The row reader the file-size guards already use — one implementation. */
export { rowFor };

/**
 * `count` catch clauses that swallow with an empty body. The shape is the one
 * `silent-warning-gate-leg.test.ts` uses, and it is prettier-clean: a planted
 * file that the real prettier leg would rewrite moves a ceiling this slice has
 * no evidence about.
 */
export function emptyCatchSource(count: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      [
        `export function sweep${i}(path: string): void {`,
        '  try {',
        '    void path;',
        '  } catch {',
        '    /* best-effort */',
        '  }',
        '}'
      ].join('\n')
    );
  }
  return `${blocks.join('\n')}\n`;
}

/** `count` catch clauses that return null — the other rule, same posture. */
export function catchReturnNullSource(count: number): string {
  const blocks: string[] = [];
  for (let i = 0; i < count; i++) {
    blocks.push(
      [
        `export function read${i}(path: string): string | null {`,
        '  try {',
        '    return path;',
        '  } catch {',
        '    return null;',
        '  }',
        '}'
      ].join('\n')
    );
  }
  return `${blocks.join('\n')}\n`;
}

/** The fixture's `node_modules/typescript/lib/typescript.js`: this repository's copy. */
function typescriptShim(): string {
  const real = join(REPO_ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js');
  const anchor = join(REPO_ROOT, 'noop.js');
  return [
    '// Shim: the detector resolves this path against ITS own repo root, which in a',
    '// fixture is the fixture. Load the installed copy instead of a second TS.',
    "import { createRequire } from 'node:module';",
    `const load = createRequire(${JSON.stringify(anchor)});`,
    `export default load(${JSON.stringify(real)});`,
    ''
  ].join('\n');
}

/** A fixture repository whose silent-warning detector is the real tool. */
export function createDetectorFixture(name: string): Fixture {
  const fx = createFixture(`sw-${name}`);
  fx.write(DETECTOR_REL, readFileSync(join(REPO_ROOT, DETECTOR_REL), 'utf8'));
  for (const sibling of [
    'silent-warning-ast.mjs',
    'silent-warning-analyze.mjs',
    'silent-warning-report.mjs'
  ]) {
    fx.write(
      join('scripts', 'lint', sibling),
      readFileSync(join(REPO_ROOT, 'scripts', 'lint', sibling), 'utf8')
    );
  }
  fx.write(TS_LIB_REL, typescriptShim());
  fx.commitAll('fixture: the real detector replaces the argv-blind stub');
  return fx;
}

/** A spawn whose stdout is returned whole, for the arms that parse an envelope. */
function spawnRaw(fx: Fixture, argv: readonly string[]): { status: number; stdout: string } {
  const r = spawnSync(process.execPath, argv, {
    cwd: fx.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
  if (r.error !== undefined) throw r.error;
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

/** The fixture's own detector, over an explicit list: the independent reading. */
export function detectorScan(
  fx: Fixture,
  files: readonly string[]
): { scannedFiles: number; byRule: Record<string, number>; violationCount: number } {
  // Exit 1 means the detector FOUND swallows; the envelope is still on stdout —
  // the same shape the leg reads. Any other non-zero status is a run that did not
  // happen, and this throws rather than returning a count of nothing.
  const run = spawnRaw(fx, [DETECTOR_REL, '--json', ...files]);
  if (run.status !== 0 && run.status !== 1) {
    throw new Error(
      `the fixture's detector exited ${String(run.status)} on ${files.length} path(s)`
    );
  }
  return JSON.parse(run.stdout) as {
    scannedFiles: number;
    byRule: Record<string, number>;
    violationCount: number;
  };
}

/**
 * The fixture's ENFORCED SCOPE — `git ls-files` filtered by the published rule,
 * which is how the gate and the generator both decide it. Computed, never typed:
 * the harness stages `src/services/scan/file-size-policy.ts` among its copied
 * files, so an arm that assumed a fixture population of three would be asserting
 * about the harness instead of about the population (§2.41).
 */
export async function gatedFiles(fx: Fixture): Promise<string[]> {
  const tracked = execFileSync('git', ['ls-files'], {
    cwd: fx.root,
    encoding: 'utf8',
    windowsHide: true
  })
    .trim()
    .split('\n');
  const rule = (await import(pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href)) as {
    isLintScoped(file: string): boolean;
  };
  return tracked.filter((file) => rule.isLintScoped(file)).sort();
}

/** `node .husky/peaks-gate.mjs silent-warning [paths…]` inside the fixture. */
export function runSilentWarningLeg(fx: Fixture, args: readonly string[] = []): FixtureRun {
  const r = spawnSync(process.execPath, [GATE_REL, 'silent-warning', ...args], {
    cwd: fx.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
  if (r.error !== undefined) throw r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** `node .husky/peaks-gate.mjs repo` inside the fixture — the enforcement surface. */
export function runRepoMode(fx: Fixture): FixtureRun {
  const r = spawnSync(process.execPath, [GATE_REL, 'repo'], {
    cwd: fx.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: MAX_BUFFER
  });
  if (r.error !== undefined) throw r.error;
  return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

/** sha256 of the fixture's artifact bytes, for the "nothing was written" arms. */
export function artifactSha(fx: Fixture): string {
  return createHash('sha256').update(readFileSync(fx.artifactPath)).digest('hex');
}

/** The fixture's artifact `scope` block, whole — the record under test. */
export function artifactScope(fx: Fixture): Record<string, unknown> {
  const doc = JSON.parse(readFileSync(fx.artifactPath, 'utf8')) as {
    scope: Record<string, unknown>;
  };
  return doc.scope;
}

/** The recorded population of one leg inside `scope`, or `null` when HEAD names none. */
export function recordedLegScope(
  fx: Fixture,
  leg: string
): { source: string; scannedFiles: number } | null {
  const record = artifactScope(fx)[leg];
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const rec = record as { source?: unknown; scannedFiles?: unknown };
  if (typeof rec.source !== 'string' || !Number.isInteger(rec.scannedFiles)) return null;
  return { source: rec.source, scannedFiles: rec.scannedFiles as number };
}
