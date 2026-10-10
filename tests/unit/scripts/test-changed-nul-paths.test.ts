/**
 * tests/unit/scripts/test-changed-nul-paths.test.ts
 *
 * THE PARSER HALF of the push gate's input format. `scripts/test-changed.mjs` asks git for
 * `--name-status -z` and `scripts/test-changed-classify.mjs` splits that stream on NUL. Before
 * `-z` the stream was tab-separated and C-quoted: `core.quotePath` defaults on, so
 * `M src/services/中文 name.ts` arrived as `M\t"src/services/\344\270\255\346\226\207 name.ts"` —
 * a string that starts with a quote and therefore matched no anchored trigger, no area regex and
 * no `BASELINE_REL`. The loss is silent: `M "src/…"` beside a plain `M src/cli/x.ts` dropped the
 * whole services suite from the selection, i.e. a push that ran nothing for a file it changed.
 *
 * WHY THE ARMS ARE FED REAL `git diff` OUTPUT. See `_setup/gate-nul-fixture.ts` — the short form
 * is that a hand-written fixture encodes the author's belief about the format, and a fixture that
 * cannot be wrong about it cannot be right about it either. `buildPathFixture` commits real files,
 * mutates them, and hands back git's own bytes in BOTH formats from the SAME diff, which is what
 * makes the quoted form usable as the AC2 control rather than as a restatement of the fix.
 *
 * The CALL-SITE half — the two `-z` arguments in `scripts/test-changed.mjs` — cannot be seen from
 * here at all; it is covered in `test-changed-nul-e2e.test.ts`. That split is the point: an arm
 * that covers one half proves nothing about the other.
 *
 * Dimensions: `render` is omitted (the parser returns an array of objects and renders nothing) and
 * `a11y` is omitted (the human-facing narration is the runner's stderr, asserted in the e2e file).
 */

import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  ADDED_REL,
  CJK_BYTES,
  COPY_FROM_REL,
  COPY_TO_REL,
  NEWLINE_REL,
  NON_ASCII_REL,
  PLAIN_REL,
  RENAME_FROM_REL,
  RENAME_TO_REL,
  buildNewlineFixture,
  buildPathFixture,
  disposeFixtureScratch,
  loadClassifyModule,
  loadPlantedParser,
  preFixParse,
  type NewlineFixture,
  type PathFixture
} from '../_setup/gate-nul-fixture.js';

declareDimensions(
  'tests/unit/scripts/test-changed-nul-paths.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the parser renders nothing: its verdict is an array of objects'
    },
    {
      dim: 'a11y',
      reason:
        'the human-facing surface is the runner stderr, which needs the runner to run; it is asserted in test-changed-nul-e2e.test.ts'
    }
  ]
);

let pathFixturePromise: Promise<PathFixture> | undefined;
let newlineFixturePromise: Promise<NewlineFixture> | undefined;

/** The path fixture, built on first use (its cost is real process spawns). */
function pathFixture(): Promise<PathFixture> {
  pathFixturePromise ??= buildPathFixture();
  return pathFixturePromise;
}

/** The newline fixture, likewise — and disposed by its own builder, so it caches only its stdout. */
function newlineFixture(): Promise<NewlineFixture> {
  newlineFixturePromise ??= buildNewlineFixture();
  return newlineFixturePromise;
}

afterAll(async () => {
  if (pathFixturePromise !== undefined) (await pathFixturePromise).repo.dispose();
  disposeFixtureScratch();
});

// ---------------------------------------------------------------------------
// behavior — AC1 / AC2: the record shape, and the quoted shape it replaced
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the parser reads the NUL record shape git actually prints', () => {
  it('when git prints A/M/D and a rename, should emit one entry per path in stream order', async () => {
    // given: a real `git diff --name-status -z --cached HEAD` over the two-path fixture
    // when:  the shipped parser reads it
    // then:  every record yields its fields in order — the 2-field statuses one path each, the
    //        3-field `R100` BOTH of its paths, because the old path still maps an area
    const { nulStdout } = await pathFixture();
    const parsed = (await loadClassifyModule()).parseNameStatus(nulStdout);

    expect(parsed).toEqual([
      { status: 'R', path: RENAME_FROM_REL },
      { status: 'R', path: RENAME_TO_REL },
      { status: 'A', path: COPY_TO_REL },
      { status: 'A', path: ADDED_REL },
      { status: 'D', path: PLAIN_REL },
      { status: 'M', path: NON_ASCII_REL }
    ]);
  });

  it('when git prints a copy record, should emit both of its paths too', async () => {
    // given: the same diff with `-C --find-copies`, the only way git emits a `C` record
    // when:  the shipped parser reads it
    // then:  both paths are emitted under the `C` letter. The runner passes no `-C`, so this is
    //        the shape's contract rather than its trigger — but a `C` reaching the parser by any
    //        route must not be dropped the way `--name-only` dropped one half of a rename
    const { copyStdout, nulStdout } = await pathFixture();
    const mod = await loadClassifyModule();
    const plain = mod.parseNameStatus(nulStdout);
    const withCopy = mod.parseNameStatus(copyStdout);

    expect(nulStdout, 'copy detection is off without -C').not.toContain('\0C100\0');
    expect(withCopy).toContainEqual({ status: 'C', path: COPY_FROM_REL });
    expect(withCopy).toContainEqual({ status: 'C', path: COPY_TO_REL });
    // `-C` re-reads the SAME change: the target stops being an added file and becomes a copy, so
    // the diff gains exactly one path (the copy's source) and loses none of the others
    expect(plain).toContainEqual({ status: 'A', path: COPY_TO_REL });
    expect(withCopy).not.toContainEqual({ status: 'A', path: COPY_TO_REL });
    expect(withCopy.length, 'one extra path, not two').toBe(plain.length + 1);
  });

  it('when the utf8 decode reads the stream, should keep every record past the first NUL', async () => {
    // given: the raw stdout of a `-z` diff, decoded by the SAME `encoding: 'utf8'` the runner uses
    // when:  its field boundaries and its last record are read
    // then:  the decode did not stop at the first NUL — a JS string carries NUL as an ordinary
    //        code point, and the first NUL sits many bytes before the end. This is the specific
    //        risk of the call-site change, so it is asserted rather than assumed
    const { nulStdout } = await pathFixture();
    const parsed = (await loadClassifyModule()).parseNameStatus(nulStdout);

    expect(nulStdout.indexOf('\0'), 'the fixture must really be NUL-separated').toBeGreaterThan(0);
    expect(
      nulStdout.length - 1,
      'a decode that stopped at the first NUL would end the stream there'
    ).toBeGreaterThan(nulStdout.indexOf('\0'));
    expect(parsed[parsed.length - 1], 'the LAST record must survive the decode').toEqual({
      status: 'M',
      path: NON_ASCII_REL
    });
  });

  it('when the feed is the C-quoted shape, should emit no quoted path where HEAD emitted one', async () => {
    // given: the SAME diff in both formats — with `-z` and without it
    // when:  HEAD's parser and the shipped parser each read each of them
    // then:  HEAD hands back the quoted, escaped path (the control: without it this arm could
    //        pass by being unable to fail) and is blind to the `-z` stream; the shipped parser
    //        hands back the path itself from `-z` and never a quoted string
    const { nulStdout, quotedStdout } = await pathFixture();
    const mod = await loadClassifyModule();

    expect(quotedStdout, 'the control fixture must really carry the quoted shape').toContain(
      '"src/services/\\344\\270\\255\\346\\226\\207 name.ts"'
    );
    expect(preFixParse(quotedStdout).map((entry) => entry.path)).toContain(
      '"src/services/\\344\\270\\255\\346\\226\\207 name.ts"'
    );
    expect(preFixParse(nulStdout), "HEAD's parser cannot read a NUL stream at all").toEqual([]);

    expect(mod.parseNameStatus(nulStdout).map((entry) => entry.path)).toContain(NON_ASCII_REL);
    for (const entry of mod.parseNameStatus(quotedStdout)) {
      expect(entry.path.startsWith('"'), `${entry.path} is still C-quoted`).toBe(false);
      expect(entry.path, `${entry.path} still carries a C escape`).not.toMatch(/\\[0-7]{3}/);
    }
  });

  it('when stdout carries no status column, should emit nothing', async () => {
    // given: an empty diff, a bare newline, and a line with no NUL at all
    // when:  the parse reads each
    // then:  no entry is invented, so the empty-diff verdict stays reachable — and text with no
    //        NUL is the shape a call site that dropped `-z` would hand this parser
    const mod = await loadClassifyModule();

    expect(mod.parseNameStatus('')).toEqual([]);
    expect(mod.parseNameStatus('\n')).toEqual([]);
    expect(mod.parseNameStatus('A\tsrc/services/added.ts\n')).toEqual([]);
    expect(mod.classifyChanged(mod.parseNameStatus('')).code).toBe('empty-diff');
  });
});

// ---------------------------------------------------------------------------
// behavior — AC3: the byte classes, straight out of a real diff
// ---------------------------------------------------------------------------

describe('Scenario: behavior — a path survives the round trip byte-for-byte', () => {
  it('when a path carries bytes above ASCII and a space, should arrive intact', async () => {
    // given: a real `-z` record for `src/services/中文 name.ts`
    // when:  its path is compared with the bytes the fixture wrote
    // then:  the UTF-8 bytes match exactly — no C escape, no quoting, no re-encoding
    const { nulStdout } = await pathFixture();
    const entry = (await loadClassifyModule())
      .parseNameStatus(nulStdout)
      .find((candidate) => candidate.path === NON_ASCII_REL);

    expect(entry, `the real diff must carry ${NON_ASCII_REL}`).toBeDefined();
    const bytes = Buffer.from(entry?.path ?? '', 'utf8');
    expect(bytes.includes(CJK_BYTES), '中 and 文, byte for byte').toBe(true);
    expect(bytes.toString('utf8')).toBe(NON_ASCII_REL);
  });

  it('when a path carries a newline, should survive NUL separation intact', async () => {
    // given: a real `-z` record whose path holds a byte no line-oriented format can carry
    // when:  the parse reads the stream
    // then:  the newline is part of the PATH and not a record boundary — the one case a
    //        newline-split parse cannot represent at all
    const { stdout } = await newlineFixture();
    const parsed = (await loadClassifyModule()).parseNameStatus(stdout);

    expect(parsed, "the staged path must be the diff's only record").toEqual([
      { status: 'A', path: NEWLINE_REL }
    ]);
    expect(Buffer.from(parsed[0]?.path ?? '', 'utf8')).toEqual(Buffer.from(NEWLINE_REL, 'utf8'));
    expect(parsed[0]?.path.split('\n').length, 'the newline belongs to the path').toBe(2);
  });

  it('when a rename crosses areas inside the real diff, should classify both areas and the guards', async () => {
    // given: the fixture's real `R100 src/alpha/old.ts → src/beta/new.ts`, plus A/D records
    // when:  the classifier classifies the parsed entries
    // then:  both areas are selected — the old path maps `alpha`, the new one `beta` — and the
    //        A/D records still reach the population guards
    const { nulStdout } = await pathFixture();
    const mod = await loadClassifyModule();
    const plan = mod.classifyChanged(mod.parseNameStatus(nulStdout));

    expect(plan.mode).toBe('subset');
    expect(plan.paths).toContain('tests/unit/alpha');
    expect(plan.paths).toContain('tests/unit/beta');
    expect(plan.paths).toContain('tests/unit/services');
    expect(plan.paths).toContain(mod.STANDARDS_GUARD_PATH);
  });
});

// ---------------------------------------------------------------------------
// integration — AC4, parser half: the plant that proves the arms above can go red
// ---------------------------------------------------------------------------

describe('Scenario: integration — HEAD`s parser cannot read this stream', () => {
  it('when HEAD`s parser is spliced back in, should stop reading the -z stream', async () => {
    // given: the shipped module with `parseNameStatus` replaced by HEAD`s implementation
    // when:  both are handed the SAME real `-z` stdout
    // then:  the shipped parser yields the entries and the planted one yields nothing — so the
    //        arms above are falsifiable by the parser alone, not only by the call sites
    const { nulStdout } = await pathFixture();
    const real = await loadClassifyModule();
    expect(real.parseNameStatus(nulStdout), 'control').toContainEqual({
      status: 'M',
      path: NON_ASCII_REL
    });

    const planted = await loadPlantedParser();
    expect(planted.parseNameStatus(nulStdout), "HEAD's parser is blind to a NUL stream").toEqual(
      []
    );
  });

  it('when HEAD`s parser classifies the real stream, should fall back to the whole suite', async () => {
    // given: the same splice, driven through the classifier instead of the parser
    // when:  both classify the diff the real `-z` stream describes
    // then:  the planted one sees an EMPTY diff and runs everything — the safe direction, and the
    //        reason a dropped `-z` costs a suite's worth of time rather than a silent miss
    const { nulStdout } = await pathFixture();
    const real = await loadClassifyModule();
    const parsed = real.parseNameStatus(nulStdout);

    expect(real.classifyChanged(parsed).code, 'control').toBe('subset');
    expect(real.classifyChanged(parsed).mode).toBe('subset');

    const planted = await loadPlantedParser();
    const withoutParser = planted.classifyChanged(planted.parseNameStatus(nulStdout));
    expect(withoutParser.code).toBe('empty-diff');
    expect(withoutParser.mode).toBe('full');
  });
});
