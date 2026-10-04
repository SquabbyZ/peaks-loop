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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { eraRows } from './_split-anchor-era.js';
import {
  COMMENT_HYGIENE_STDERR_LINE,
  LEG_MEASURE_STDERR_LINE,
  SCOPE_GROWTH_STDERR_LINE,
  SHADOW_MOVE_STDERR_LINE,
  SHADOW_STDERR_LINE,
  projectArtifact,
  projectStderr
} from './_rescope-projection.js';

declareDimensions(
  'tests/unit/lint/rescope-projection-bounded.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'pure projection bound; the real runs are the @slow sibling arms'
    }
  ]
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
  shadowMoveLines: (i: {
    headShadow: unknown;
    shadow: unknown;
    rescopeApplied?: boolean;
  }) => string[];
  shadowStderrLine: (shadow: unknown) => string;
  describeSilentWarningRun: (run: {
    returnNull: number;
    emptyCatch: number;
    scanned: number;
  }) => string;
  scopeGrowthLine: (i: {
    headFileCount: number;
    gatedCount: number;
    entered: string[];
    left: string[];
  }) => string;
}> {
  const url = pathToFileURL(join(REPO_ROOT, '.husky', 'baseline', 'rescope.mjs')).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const fn = (name: string): ((arg: never) => unknown) => {
    const f = mod[name];
    if (typeof f !== 'function')
      throw new Error(`.husky/baseline/rescope.mjs exports no \`${name}\``);
    return f as (arg: never) => unknown;
  };
  const legUrl = pathToFileURL(join(REPO_ROOT, '.husky', 'peaks-gate-silent-warning.mjs')).href;
  const legMod = (await import(legUrl)) as Record<string, unknown>;
  if (typeof legMod.describeSilentWarningRun !== 'function') {
    throw new Error('.husky/peaks-gate-silent-warning.mjs exports no `describeSilentWarningRun`');
  }
  // §2.50's growth statement lives with the population arithmetic it reports (§2.47:
  // the projection may only swallow sentences this loader can prove are emitted).
  const popUrl = pathToFileURL(join(REPO_ROOT, '.husky', 'baseline', 'leg-scope.mjs')).href;
  const popMod = (await import(popUrl)) as Record<string, unknown>;
  if (typeof popMod.scopeGrowthLine !== 'function') {
    throw new Error('.husky/baseline/leg-scope.mjs exports no `scopeGrowthLine`');
  }
  return {
    shadowMoveLines: fn('shadowMoveLines') as (i: {
      headShadow: unknown;
      shadow: unknown;
      rescopeApplied?: boolean;
    }) => string[],
    shadowStderrLine: fn('shadowStderrLine') as (shadow: unknown) => string,
    describeSilentWarningRun: legMod.describeSilentWarningRun as (run: {
      returnNull: number;
      emptyCatch: number;
      scanned: number;
    }) => string,
    scopeGrowthLine: popMod.scopeGrowthLine as (i: {
      headFileCount: number;
      gatedCount: number;
      entered: string[];
      left: string[];
    }) => string
  };
}

/** One leg measurement, in the shape the silent-warning leg produces. */
const LEG_RUN = { returnNull: 49, emptyCatch: 68, scanned: 943 };

/** The §2.50 growth state: seven entered files, none leaving. */
const GROWTH_ENTERED = Array.from({ length: 7 }, (_, i) => `src/new-${String(i)}.ts`);

/** Every stderr line the projection claims to cover, produced by running the emitters. */
async function emittedShadowLines(): Promise<string[]> {
  const { shadowMoveLines, shadowStderrLine, describeSilentWarningRun, scopeGrowthLine } =
    await loadEmitters();
  return [
    shadowStderrLine(block({})),
    ...shadowMoveLines({ headShadow: null, shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({}), shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({ eslintFindings: 638 }), shadow: block({}) }),
    ...shadowMoveLines({ headShadow: block({ eslintFindings: 640 }), shadow: block({}) }),
    // §2.43's surface: the silent-warning leg's measurement sentence, emitted by the
    // module that prints it — not re-typed here.
    describeSilentWarningRun(LEG_RUN),
    // §2.50's surface: the growth statement, same rule — from the emitter, not typed.
    scopeGrowthLine({ headFileCount: 943, gatedCount: 950, entered: GROWTH_ENTERED, left: [] }),
    // Surface 7's two lines (the comment-hygiene leg), same rule: from the emitters.
    ...(await commentHygieneEmittedLines())
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
      ...alternativesOf(SHADOW_MOVE_STDERR_LINE),
      ...alternativesOf(LEG_MEASURE_STDERR_LINE),
      ...alternativesOf(SCOPE_GROWTH_STDERR_LINE),
      ...alternativesOf(COMMENT_HYGIENE_STDERR_LINE)
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

  it('every line the generator can emit under a projected prefix is covered, so a new uncovered sentence reddens it', async () => {
    const emitted = await emittedShadowLines();
    // Four shadow states plus the note plus the leg measurement: inactive, equal,
    // rise (+compared), fall (+compared), out-of-scope, silent-warning.
    expect(emitted.length).toBeGreaterThanOrEqual(8);
    for (const line of emitted) {
      expect(line, `the generator emitted a multi-line shadow surface: ${line}`).not.toContain(
        '\n'
      );
      expect(
        projectStderr(`${line}\n`),
        `the generator emits a shadow line the projection does not cover: ${line}`
      ).toBe('');
    }
  });
});

/**
 * The comment-hygiene leg's own two stderr lines, taken from the code that prints them:
 * the measurement sentence from its emitter, the progress note from the source literal.
 * An alternative in a projection regex that no emitter can print is a silently-widening
 * projection, so the regex is checked against these, not against a re-typed string.
 */
async function commentHygieneEmittedLines(): Promise<string[]> {
  const url = pathToFileURL(join(REPO_ROOT, '.husky', 'peaks-gate-comment-hygiene.mjs')).href;
  const mod = (await import(url)) as Record<string, unknown>;
  const emit = mod.describeCommentHygieneRun;
  if (typeof emit !== 'function') {
    throw new Error('.husky/peaks-gate-comment-hygiene.mjs exports no `describeCommentHygieneRun`');
  }
  const measurement = (
    emit as (r: { deadReferences: number; narrative: number; scanned: number }) => string
  )({ deadReferences: 25, narrative: 1515, scanned: 952 });
  const toolLegs = readFileSync(join(REPO_ROOT, '.husky', 'baseline', 'tool-legs.mjs'), 'utf8');
  const progress = /console\.error\('(running the comment-hygiene[^']*)'\)/.exec(toolLegs)?.[1];
  if (progress === undefined) {
    throw new Error('`.husky/baseline/tool-legs.mjs` prints no comment-hygiene progress note');
  }
  return [measurement, progress];
}

describe('Scenario: behavior — the era projection swallows the gained rows and nothing else', () => {
  const ERA = eraRows();

  it('the era is the rows the canonical list gained after the anchor, and every one is published', () => {
    // Derived from two `CEILING_KEYS` literals, so this arm is the anti-typed-list pin:
    // an era that names a row the published artifact does not carry is a stale era.
    expect(
      ERA.length,
      'no row gained after the anchor — the era projection is moot'
    ).toBeGreaterThan(0);
    const published = JSON.parse(
      readFileSync(join(REPO_ROOT, '.peaks', 'lint', 'gate-baseline.json'), 'utf8')
    ) as { ceilings: Record<string, number> };
    for (const key of ERA) {
      expect(published.ceilings, `${key} must be a published ceiling`).toHaveProperty(key);
    }
  });

  it('a moved-row that is NOT an era row keeps its bullet, its header and its count', () => {
    const text =
      'monotonicity: 2 row(s) moved — nothing rose and nothing dropped; every ceiling may only go DOWN.\n' +
      '  NEWLY SEEDED — 2 row(s) the previous artifact did not carry.\n' +
      `    - ${ERA[0]}: 1\n` +
      '    - someOtherRow: 7\n';
    const out = projectStderr(text, ERA);
    expect(out).toContain('someOtherRow: 7');
    expect(out).toContain('NEWLY SEEDED');
    expect(out).toContain('monotonicity: 1 row(s) moved');
    expect(out).not.toContain(ERA[0] ?? '');
  });

  it('when every bullet under the note is an era row, the note goes and the verdict reads like a held run', () => {
    const text =
      'monotonicity: 2 row(s) moved — nothing rose and nothing dropped; every ceiling may only go DOWN.\n' +
      '  NEWLY SEEDED — 2 row(s) the previous artifact did not carry.\n' +
      ERA.map((key) => `    - ${key}: 1`).join('\n') +
      '\n';
    expect(projectStderr(text, ERA)).toBe(
      'monotonicity: every ceiling held — nothing rose and nothing dropped; every ceiling may only go DOWN.\n'
    );
  });

  it("the projection swallows the leg's two stderr lines only when they really are emitted", async () => {
    for (const line of await commentHygieneEmittedLines()) {
      expect(projectStderr(`${line}\n`)).toBe('');
    }
    expect(projectStderr('comment-hygiene: a sentence this leg cannot print\n')).toContain(
      'a sentence this leg cannot print'
    );
  });

  it('projectArtifact drops only the rows it is handed, and nothing else about them', () => {
    const doc = JSON.stringify({
      ceilings: { [ERA[0] ?? 'eslintFindings']: 1, eslintFindings: 638, prettierUnformatted: 4 },
      note: 'Ratchet baseline for the husky gate.'
    });
    const out = JSON.parse(projectArtifact(doc, ERA)) as {
      ceilings: Record<string, number>;
      note: string;
    };
    expect(out.ceilings, 'the era row is gone').not.toHaveProperty(ERA[0] ?? '');
    expect(out.ceilings.eslintFindings).toBe(638);
    expect(out.ceilings.prettierUnformatted).toBe(4);
    expect(out.note).toBe('Ratchet baseline for the husky gate.');
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
