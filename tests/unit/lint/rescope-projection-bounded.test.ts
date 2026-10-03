// tests/unit/lint/rescope-projection-bounded.test.ts
//
// Rid `2026-10-03-shadow-move-rider-repair1`. `_rescope-projection.ts` deletes every
// stderr line under a handful of prefixes so `baseline-split-equivalence.test.ts` can
// compare the split against the pinned monolith (:209, :470). Before this file, NOTHING
// bounded what that regex may swallow: the projection was applied on both sides of the
// comparison and never asserted SMALL. That is §4u's defect on the one surface this
// campaign trusts to catch a silent behaviour change — a future generator that printed a
// DIFFERENT decision under one of those prefixes would be normalised to "equivalent" and
// the equivalence test would keep printing green.
//
// These arms prove two independent properties, both read from the generator's own source
// (`.husky/baseline/rescope.mjs` executed, not re-typed):
//   - NOT OVER-BROAD — a real decision sentence that is NOT on the declared list survives
//     the projection, so the two stderr sides stay different (the equivalence claim goes
//     red for that difference rather than laundering it);
//   - NOT UNDER-BROAD / NOT STALE — every alternative in the projection regexes is earned
//     by a line the current generator can actually emit, and every shadow line the
//     generator can emit is covered by them (a regex-only prefix or an uncovered emitted
//     sentence both fail here).
//
// Dimensions covered: behavior (the projection's appetite), render (regex-to-source set
// equality, both directions), a11y (a refusal never projects into a success).
// integration is omitted: this is a pure projection bound — the real generator double-run
// lives in `shadow-move-warning.test.ts` and `generator-determinism.test.ts`, which are
// the `@slow` integration surface for the same emitter functions loaded here.

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import {
  SHADOW_MOVE_STDERR_LINE,
  SHADOW_STDERR_LINE,
  projectStderr
} from './_rescope-projection.js';

declareDimensions(
  'tests/unit/lint/rescope-projection-bounded.test.ts',
  ['behavior', 'render', 'a11y'],
  [{ dim: 'integration', reason: 'pure projection bound; the real runs are the @slow sibling arms' }]
);

/** The five numeric rows a shadow block must carry to be comparable (rescope.mjs). */
function block(over: Record<string, number> = {}): Record<string, number> {
  return {
    measuredFiles: 558,
    eslintFindings: 639,
    eslintErrors: 160,
    fileSizeOverCap: 35,
    fileSizeExcessLines: 13557,
    ...over
  };
}

/** A genuine generator decision line, in the exact shape `.husky/baseline/paths.mjs` prints. */
const REFUSAL_LINE =
  'REFUSING to write .peaks/lint/gate-baseline.json: silentWarningEmptyCatch: 3 -> 5 (HEAD -> this run)';

/** The emitters, loaded where they live rather than restated here. */
async function loadEmitters(): Promise<{
  shadowMoveLines: (i: { headShadow: unknown; shadow: unknown; rescopeApplied?: boolean }) => string[];
  shadowStderrLine: (shadow: unknown) => string;
}> {
  const url = pathToFileURL(join(REPO_ROOT, '.husky', 'baseline', 'rescope.mjs')).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const fn = (name: string): ((arg: never) => unknown) => {
    const f = mod[name];
    if (typeof f !== 'function') throw new Error(`.husky/baseline/rescope.mjs exports no \`${name}\``);
    return f as (arg: never) => unknown;
  };
  return {
    shadowMoveLines: fn('shadowMoveLines') as (i: {
      headShadow: unknown;
      shadow: unknown;
      rescopeApplied?: boolean;
    }) => string[],
    shadowStderrLine: fn('shadowStderrLine') as (shadow: unknown) => string
  };
}

/** Every shadow stderr line the CURRENT generator can emit, produced by running it. */
async function emittedShadowLines(): Promise<string[]> {
  const { shadowMoveLines, shadowStderrLine } = await loadEmitters();
  return [
    shadowStderrLine(block({})),
    ...shadowMoveLines({ headShadow: null, shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({}), shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({ eslintFindings: 638 }), shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({ eslintFindings: 640 }), shadow: block({}) })
  ];
}

/**
 * The literal alternatives a projection regex is willing to strip, taken from its own
 * `.source` (never re-typed): a leading `^`, a trailing `.*\n`, and either a `(?:a|b|…)`
 * group or a single escaped body.
 */
function alternativesOf(re: RegExp): string[] {
  let body = re.source.startsWith('^') ? re.source.slice(1) : re.source;
  const tail = '.*\\n';
  if (body.endsWith(tail)) body = body.slice(0, -tail.length);
  const group = /^\(\?:([\s\S]*)\)$/.exec(body);
  return (group?.[1] ?? body).split('|');
}

describe('Scenario: behavior — the projection is small AND hungry only for its own lines', () => {
  it('a planted decision sentence that is NOT on the declared list survives the projection, so the two stderr sides stay different', () => {
    const base = 'wrote baseline ceilings for the husky gate\n';
    const withRefusal = `${base}${REFUSAL_LINE}\n`;
    expect(projectStderr(withRefusal)).toContain('REFUSING to write');
    // The equivalence stderr leg (baseline-split-equivalence.test.ts:209) reads
    // `projectStderr(head) !== projectStderr(split)`; a real refusal on one side must
    // survive the projection so that leg sees a difference instead of calling them equal.
    expect(projectStderr(withRefusal) !== projectStderr(base)).toBe(true);
  });

  it('a positive control: a declared shadow line really is removed, so the arm above is not vacuous', async () => {
    const { shadowStderrLine } = await loadEmitters();
    const note = shadowStderrLine(block({}));
    expect(projectStderr(note + '\n')).toBe('');
    expect(projectStderr(`${note}\n${REFUSAL_LINE}\n`)).toBe(`${REFUSAL_LINE}\n`);
  });
});

describe('Scenario: render — regex and generator are two readings of one set', () => {
  it('every alternative in the projection regexes corresponds to a line the generator can actually emit', async () => {
    const emitted = await emittedShadowLines();
    const alternatives = [
      ...alternativesOf(SHADOW_STDERR_LINE),
      ...alternativesOf(SHADOW_MOVE_STDERR_LINE)
    ];
    expect(alternatives.length).toBeGreaterThan(0);
    for (const alt of alternatives) {
      const atLineStart = new RegExp(`^(?:${alt})`);
      const hits = emitted.filter((line) => atLineStart.test(line));
      expect(
        hits.length,
        `projection alternative ${JSON.stringify(alt)} matches no line the generator emits — a silently-widening projection`
      ).toBeGreaterThan(0);
    }
  });

  it('every shadow line the generator can emit is covered by the projection, so a new uncovered sentence reddens it', async () => {
    const emitted = await emittedShadowLines();
    // Four states plus the note: inactive, equal, rise (+compared), fall (+compared), out-of-scope.
    expect(emitted.length).toBeGreaterThanOrEqual(7);
    for (const line of emitted) {
      expect(line, `the generator emitted a multi-line shadow surface: ${line}`).not.toContain('\n');
      expect(
        projectStderr(`${line}\n`),
        `the generator emits a shadow line the projection does not cover: ${line}`
      ).toBe('');
    }
  });
});

describe('Scenario: a11y — a refusal never projects into a success', () => {
  it('the human-visible refusal wording survives the projection, so a refused run and a clean write cannot agree once projected', async () => {
    const { shadowMoveLines, shadowStderrLine } = await loadEmitters();
    const shadow = block({});
    const head = block({ eslintFindings: 638 });
    const note = shadowStderrLine(shadow);
    const refused =
      `${note}\n${shadowMoveLines({ headShadow: head, shadow }).join('\n')}\n` +
      `${REFUSAL_LINE}\n  Nothing has been written; the existing ceilings are untouched.\n`;
    const clean = `${note}\n${shadowMoveLines({ headShadow: shadow, shadow }).join('\n')}\nwrote\n`;
    expect(projectStderr(refused)).toContain('REFUSING to write');
    expect(projectStderr(refused)).toContain('Nothing has been written');
    expect(projectStderr(refused)).not.toContain('shadow moved up');
    expect(projectStderr(refused)).not.toBe(projectStderr(clean));
  });
});
