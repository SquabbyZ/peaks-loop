// tests/unit/lint/silent-warning-grace-marker.test.ts
//
// Slice S5a — a grace marker that formatting can switch off is not a
// suppression at all.
//
// THE DEFECT THIS PINS. `scripts/lint/silent-warning-detector.mjs` decides a
// violation is suppressed by looking for `// TODO(g2):`, and it used to look on
// ONE line — the offending node's start line. The repo-wide `prettier --write`
// pass (commit cf21d188) moved those markers, so the anchor stopped matching and
// 126 live markers across `src/` went inert at once, every one of them still
// visible in its file. The detector then read `empty-catch` 59 -> 125 and
// `catch-return-null` 41 -> 106 against J03's ratchet ceilings of exactly 59 and
// 41 — both rules breached, and `gate:repo` cannot see it because J03 is a
// capability-guard contract, not one of the gate's own ceilings.
//
// WHY EVERY TEST BELOW GOES THROUGH THE REAL PRETTIER. Asserting a new anchor
// against a hand-written fixture proves nothing here: the entire failure was
// that the formatter rewrites the fixture. So each test feeds the PRE-format
// shape through the repo's OWN resolved prettier config and then asks the
// detector about the output. The behaviour test at the bottom is the control —
// the same pipeline with the marker removed must report the violation, or none
// of the tests above it can fail.
//
// Dimensions:
//   - behavior:    suppression on / suppression off, and the scope boundary
//   - integration: the real detector module + the real prettier + the real config
//   - render:      omitted — the violation envelope is pinned by the sibling
//                  census test; this file pins WHETHER it fires
//   - a11y:        omitted — reads and formats source strings, renders nothing

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/silent-warning-grace-marker.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the sibling census test pins the envelope; this file pins WHETHER it fires'
    },
    { dim: 'a11y', reason: 'reads and formats source strings; renders no human-visible surface' }
  ]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');
/** A real path INSIDE the repo, so `package.json` is the prettier config host. */
const PROBE_PATH = join(REPO_ROOT, 'src', '__grace-marker-probe.ts');
const MARKER = '// TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)';

type Violation = { readonly rule: string; readonly line: number };
type AnalyzeFn = (source: string, file: string) => Promise<readonly Violation[]>;

/** The detector is a `.mjs` build script outside `src/`, so it loads by URL. */
async function analyze(source: string): Promise<readonly Violation[]> {
  const url = pathToFileURL(join(REPO_ROOT, 'scripts', 'lint', 'silent-warning-detector.mjs')).href;
  const mod = (await import(url)) as { analyzeSourceAsync: AnalyzeFn };
  return mod.analyzeSourceAsync(source, PROBE_PATH);
}

/** Format with the repo's own config — the one the husky gate runs. */
async function format(source: string): Promise<string> {
  const opts = await prettier.resolveConfig(PROBE_PATH, { editorconfig: false });
  return prettier.format(source, { ...opts, filepath: PROBE_PATH });
}

/** The marker's line, or -1 when the marker is absent. */
function markerLineOf(source: string): number {
  return source.split('\n').findIndex((line) => line.includes('TODO(g2)'));
}

/**
 * The PRE-format shape, verbatim from cf21d188^: the entire try/catch on one
 * line, marker trailing it. This is the shape the old line anchor was written
 * against, and the shape prettier destroys.
 */
const ONE_LINE_MARKED = [
  'export function sweep(p: string): void {',
  `  try { rmSync(p); } catch { /* best-effort */ } ${MARKER}`,
  '}'
].join('\n');

/** The same shape with the marker deleted: the control that must still fire. */
const ONE_LINE_UNMARKED = [
  'export function sweep(p: string): void {',
  '  try { rmSync(p); } catch { /* best-effort */ }',
  '}'
].join('\n');

/**
 * The marker present, but annotating the NEXT statement rather than the catch.
 * Suppression is scoped to the offending construct; it must not decay into
 * "this file contains a marker somewhere".
 */
const MARKER_OUTSIDE_THE_CATCH = [
  'export function sweep(p: string): void {',
  '  try { rmSync(p); } catch { /* best-effort */ }',
  `  ${MARKER}`,
  '  void p;',
  '}'
].join('\n');

describe('Scenario: integration — the anchor survives the formatter', () => {
  it('when prettier rewrites the one-line shape, should carry the marker off the catch line', async () => {
    const formatted = await format(ONE_LINE_MARKED);
    // The marker's own prose contains the word "catch", so key the predicate on
    // the CODE shape `catch {` rather than on the word.
    const catchLines = formatted.split('\n').filter((line) => line.includes('catch {'));
    // Anti-vacuity. If prettier ever stops moving the marker, every test below
    // would pass for the wrong reason, so pin the move itself rather than
    // assuming it.
    expect(catchLines.length).toBeGreaterThan(0);
    expect(catchLines.filter((line) => line.includes('TODO(g2)'))).toEqual([]);
    expect(formatted).toContain(MARKER);
    expect(markerLineOf(formatted)).toBeGreaterThan(-1);
  });

  it('when the formatted shape is scanned, should treat the catch as suppressed', async () => {
    expect(await analyze(await format(ONE_LINE_MARKED))).toEqual([]);
  });

  it('when the formatted shape is formatted AGAIN, should change nothing and stay suppressed', async () => {
    // This is the slice's whole acceptance: a fix that survives this pass and
    // not the next one is not a fix.
    const once = await format(ONE_LINE_MARKED);
    const twice = await format(once);
    expect(twice).toBe(once);
    expect(await analyze(twice)).toEqual([]);
  });

  it('when a catch-return-null carries the marker, should survive formatting too', async () => {
    const source = [
      'export function pick(): string | null {',
      `  try { return read(); } catch { return null; } ${MARKER}`,
      '}'
    ].join('\n');
    expect(await analyze(await format(source))).toEqual([]);
  });
});

describe('Scenario: behavior — the anchor is the construct, and it can still fail', () => {
  it('when the marker is deleted, should report the empty catch', async () => {
    expect(await analyze(await format(ONE_LINE_UNMARKED))).toMatchObject([{ rule: 'empty-catch' }]);
  });

  it('when the marker belongs to another statement, should NOT suppress the catch', async () => {
    expect(await analyze(await format(MARKER_OUTSIDE_THE_CATCH))).toMatchObject([
      { rule: 'empty-catch' }
    ]);
  });
});
