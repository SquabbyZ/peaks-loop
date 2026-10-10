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
 * THE FIXTURE'S OWN GUARD IS ASSERTED HERE TOO, at the end of the file: `buildPathFixture` refuses
 * to hand back a repository that is not the scratch one it just built, and that refusal compares
 * two paths. It is asserted against a MANUFACTURED spelling difference with HEAD's comparison as
 * the control, because on this host `git rev-parse --show-toplevel` and `mkdtempSync` agree
 * already and an ambient difference would prove nothing.
 *
 * Dimensions: `render` is omitted (the parser returns an array of objects and renders nothing) and
 * `a11y` is omitted (the human-facing narration is the runner's stderr, asserted in the e2e file).
 */

import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
  canonicalRealPath,
  disposeFixtureScratch,
  gitAt,
  loadClassifyModule,
  loadPlantedParser,
  preFixParse,
  preFixResolvedPath,
  scrubbedEnv,
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

// ---------------------------------------------------------------------------
// integration — AC1 / AC2: the scratch-repo guard compares the DIRECTORY, not its spelling
// ---------------------------------------------------------------------------

/** A directory plus a link to it: ONE directory, TWO spellings. `'junction'` is the directory
 * link Windows builds without elevation; elsewhere the type argument is ignored and it is an
 * ordinary symlink. Neither path is disposed here — the caller owns the two `rmSync`s, because
 * only it knows when the fixture built through the link is done. */
function aliasedPair(prefix: string): { real: string; alias: string } {
  const real = mkdtempSync(join(tmpdir(), prefix));
  const alias = `${real}-alias`;
  symlinkSync(real, alias, 'junction');
  return { real, alias };
}

describe('Scenario: integration — the scratch-repo guard names one directory one way', () => {
  it('when one directory is reachable by two spellings, should key them as one directory', () => {
    // given: a directory and a link to it. The difference is MANUFACTURED on purpose — on this
    //        host `git rev-parse --show-toplevel` and `mkdtempSync` already answer the same
    //        spelling, so an arm that leaned on the ambient tmpdir would only ever show that this
    //        machine is neither macOS (`/var` → `/private/var`) nor the Windows runner (8.3
    //        `RUNNER~1` where Node was handed `runneradmin`)
    const { real, alias } = aliasedPair('peaks-nul-spelling-');
    try {
      // then: HEAD's comparison — `resolve` on both sides — really does read the two spellings as
      //       two directories. That is the red arm: it is why the guard failed on a fixture that
      //       was exactly what it vouched for
      expect(preFixResolvedPath(alias), 'the control must really be two spellings').not.toBe(
        preFixResolvedPath(real)
      );
      //       ...and the shipped comparison keys them to the one directory they name
      expect(canonicalRealPath(alias)).toBe(canonicalRealPath(real));
    } finally {
      rmSync(alias, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('when the tmpdir itself is reached by a second spelling, should still clear the guard', async () => {
    // given: the same pair, with the tmpdir environment pointed AT THE LINK, so `mkdtempSync`
    //        answers the link's spelling while git answers the physical one — the macOS and
    //        Windows-runner pair above, reproduced on a host where neither occurs
    const { real, alias } = aliasedPair('peaks-nul-tmpdir-');
    const saved = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP };
    try {
      process.env.TMPDIR = alias;
      process.env.TMP = alias;
      process.env.TEMP = alias;
      // asserted, not assumed: an environment that ignores the override would build the fixture
      // BESIDE the link and this arm would prove nothing while staying green
      expect(preFixResolvedPath(tmpdir()), 'the tmpdir must really be the link').not.toBe(
        preFixResolvedPath(real)
      );

      // when: the fixture builds through the link — under HEAD's comparison its own guard threw
      const fixture = await buildPathFixture();
      try {
        const top = gitAt(
          fixture.repo.path,
          ['rev-parse', '--show-toplevel'],
          await scrubbedEnv()
        ).trim();
        // then: those two are the operands the guard compares — two spellings of ONE repository,
        //       which HEAD's key split and the shipped one joins
        expect(preFixResolvedPath(top), 'HEAD`s guard failed on exactly this pair').not.toBe(
          preFixResolvedPath(fixture.repo.path)
        );
        expect(canonicalRealPath(top)).toBe(canonicalRealPath(fixture.repo.path));
      } finally {
        fixture.repo.dispose();
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(alias, { recursive: true, force: true });
      rmSync(real, { recursive: true, force: true });
    }
  });

  it('when the two paths are genuinely different directories, should NOT key them the same', () => {
    // given: two directories, neither reachable from the other
    // then:  they stay distinct — the guard is narrower than "equal", not empty. A comparison that
    //        answered "same directory" here would let an unscrubbed fixture commit into the
    //        repository it is measuring with every test still green
    const left = mkdtempSync(join(tmpdir(), 'peaks-nul-left-'));
    const right = mkdtempSync(join(tmpdir(), 'peaks-nul-right-'));
    try {
      expect(preFixResolvedPath(left)).not.toBe(preFixResolvedPath(right));
      expect(canonicalRealPath(left)).not.toBe(canonicalRealPath(right));
    } finally {
      rmSync(left, { recursive: true, force: true });
      rmSync(right, { recursive: true, force: true });
    }
  });
});
