// tests/unit/services/sediment/pool-read-semantics.test.ts
//
// S15 (`rid-s15-costume-as-helpers`) deleted this reader's hand-rolled
//
//     function readJsonIfExists<T>(p: string): T | null {
//       if (!existsSync(p)) return null;
//       return JSON.parse(readFileSync(p, 'utf-8')) as T;
//     }
//
// and put `tryParseJson(reading, BeeManifestSchema)` in its place. That merged
// two failures which had been different:
//
//   manifest.json is not JSON   -> used to THROW (the whole `peaks sediment
//                                  list` failed); became a silent skip.
//   JSON, but the wrong SHAPE   -> `lintManifest` failed, so the bee was
//                                  skipped — unchanged, and correct.
//
// `tryParseJson`'s own docblock states the precondition it was written under:
// "Use where 'absent or malformed' and 'absent' are the same outcome for the
// caller — the file-backed readers in this repo, whose existing
// `catch { return null }` already said so." `readJsonIfExists` had no
// try/catch; it threw. So the primitive was applied to a caller that did not
// meet its precondition.
//
// The user adjudicated on 2026-09-21: keep the OLD behaviour — parsing fails
// loudly, a wrong shape is skipped. This file pins that adjudication. A
// decision that is not pinned is not a decision, so each case below names the
// exact failure it would have caught.
//
// NOTE ON THE FIX. When this file was written, neither shipped primitive
// restored the pair, which is why `pool-read.ts` parses in two steps rather than
// swapping one for the other: `tryParseJson` mapped BOTH failures to `null`, and
// `parseJson` throws on BOTH (`schema.parse(JSON.parse(raw))`).
//
// UPDATED 2026-09-23: `tryParseJson` now returns a discriminated `TryParse<S>`
// (`{ ok: false, reason: 'malformed' | 'shape' }`), so a `reason`-aware call CAN
// express the pair. `pool-read.ts` still writes the two steps out — see the
// comment there — because the loud failure must remain `JSON.parse`'s own throw.
// The cases below are unchanged and still hold. What changed is only this note's
// old red-proof: a swap that collapses both failures to `null` STILL turns case
// 1 red, but a swap that switches on `reason` no longer would.
//
// Dimensions covered:
//   - behavior:    which failure throws and which failure is skipped
//   - integration: the real filesystem, at the `.peaks/skills/bees/<name>/`
//                  layout `resolveUserBeesDir` actually names
//   - render:      OMITTED — `readPool` returns an `IndexFile`; it renders
//                  nothing, and `peaks sediment list` owns the printing
//   - a11y:        OMITTED — no human-visible text or exit code of its own

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { readPool } from '../../../../src/services/sediment/pool-read.js';

declareDimensions(
  'tests/unit/services/sediment/pool-read-semantics.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'readPool returns an IndexFile; it prints nothing' },
    { dim: 'a11y', reason: 'no user-facing text, no exit code of its own' }
  ]
);

/** Homes created by this file; removed in `afterEach`. */
const homes: string[] = [];

function makeHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'peaks-pool-read-'));
  homes.push(home);
  return home;
}

/**
 * Write `<home>/.peaks/skills/bees/<name>/manifest.json` — the layout
 * `resolveUserBeesDir({ home })` names. `body` is written VERBATIM so a case
 * can hand it bytes that are not JSON at all.
 */
function writeManifest(home: string, name: string, body: string): void {
  const dir = join(home, '.peaks', 'skills', 'bees', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), body, 'utf-8');
}

/** A manifest that satisfies `BeeManifestSchema` — the surviving branch. */
function validManifest(name: string): string {
  return JSON.stringify({
    schemaVersion: 'peaks.bee/1',
    name,
    source: 'user',
    promotion_status: 'candidate',
    description: 'pool-read regression fixture',
    segments: [{ name: 'step-one', inputs: [], outputs: [], sideEffects: [] }],
    entrypoint: { preamble: 'do the thing', refs: [] },
    promotion: { minCycles: 0, requiresHumanApproval: false, requiresSmokeTest: false },
    createdBy: 'llm',
    lastTouchedAt: '2026-09-21T00:00:00.000Z'
  });
}

afterEach(() => {
  while (homes.length > 0) {
    const home = homes.pop();
    if (home !== undefined) rmSync(home, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — a not-JSON manifest fails LOUDLY, it is not skipped', () => {
  it('throws when manifest.json exists but cannot be parsed', () => {
    const home = makeHome();
    writeManifest(home, 'bee-unparseable', '{ this is not json');

    // The assertion that gives this case its teeth. A `tryParseJson` call that
    // collapses this input to `null` makes `readBeeDir` map it to "skip this
    // bee", so that implementation returns an empty index INSTEAD of throwing.
    // Measured: reverting `pool-read.ts` to a COLLAPSING `tryParseJson` call
    // turns this case red (see the slice report). A `reason`-aware call would
    // not — that variant is deliberately not shipped; see the 2026-09-23 note
    // in the file header.
    expect(() => readPool({ home })).toThrow();
  });
});

describe('Scenario: integration — a wrong SHAPE is skipped, and only that bee', () => {
  it('skips the malformed entry while the schema-valid sibling is still indexed', () => {
    const home = makeHome();
    writeManifest(home, 'bee-valid', validManifest('bee-valid'));
    // Valid JSON, wrong shape: `JSON.parse` succeeds, `safeParse` does not.
    // This is the branch whose behaviour did NOT change, pinned here so a
    // future "handle both failures the same way" edit has to break it openly.
    writeManifest(home, 'bee-wrong-shape', JSON.stringify({ schemaVersion: 'peaks.bee/1' }));

    const index = readPool({ home }); // must NOT throw

    // The valid sibling is what keeps this from passing vacuously: a
    // `readPool` that dropped every entry would satisfy "the broken one is
    // absent" while proving nothing.
    expect(index.entries.map((e) => e.name)).toEqual(['bee-valid']);
  });
});
