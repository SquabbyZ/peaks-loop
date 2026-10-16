// tests/unit/shared/incrementing-number-prefix-family.test.ts
//
// Writer and reader must recognise ONE prefix family, and the family is exactly
// three digits. Measured at HEAD 802862b9, before this file existed: in a directory
// holding only bare date-shaped names, `getNextNumber` read the leading YEAR as a
// file number and answered `2027`; `buildNumberedFilename` then stamped `2027-` onto
// a fresh artifact; and `requestIdFromFileName` — which knew only `^0\d{2}-` — handed
// back an id carrying a prefix the state machine had never been given. Two patterns
// on one naming rule, disagreeing about one file, and the pre-commit artifact
// contract is where the disagreement surfaced.
//
// THE TRAP IS DIRECTORY-SHAPE DEPENDENT, which is why every case below runs against
// a DATE-SHAPED directory and not only against a numbered one: the same call on a
// directory of `001-` … `008-` answers correctly, so a case run only there proves
// nothing.
//
// This was the module's first direct test. Before it, both functions were exercised
// only indirectly, through `loadPeaks()` and through `showRequestArtifact`.
//
// Dimensions covered:
//   - behavior:    the counting side and the stripping side, over real directories
//   - integration: real `mkdtemp` trees, so `readdirSync` sees filenames a writer
//                  could actually have produced
//   - render:      OMITTED — both functions return values; nothing is rendered
//   - a11y:        OMITTED — no CLI surface is reached here. The refusal text a
//                  producer reads when the round trip breaks is pinned in
//                  `tests/unit/hooks/pipeline-contract-gate.test.ts`
//
// Run with: pnpm exec vitest run tests/unit/shared/incrementing-number-prefix-family.test.ts

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  NUMBERED_PREFIX_RE,
  buildNumberedFilename,
  getNextNumber,
  requestIdFromFileName
} from '../../../src/shared/incrementing-number.js';

declareDimensions(
  'tests/unit/shared/incrementing-number-prefix-family.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'both functions return values; nothing here is rendered to a stream or a file'
    },
    {
      dim: 'a11y',
      reason:
        'no CLI surface is reached; the refusal a broken round trip produces is pinned in tests/unit/hooks/pipeline-contract-gate.test.ts'
    }
  ]
);

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A real directory holding exactly these file names. */
function dirWith(names: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-prefix-family-'));
  roots.push(root);
  for (const name of names) writeFileSync(join(root, name), '# x\n', 'utf8');
  return root;
}

/** The shape this session's own `rd/requests` holds: nothing but date-shaped names. */
const DATE_SHAPED = [
  '2026-10-15-macos-ledger-reaper.md',
  '2026-10-15-best-practice-real-context7.md',
  '2026-10-16-readme-en-sync.md',
  '2026-10-16-coverage-ratchet-in-ci.md'
];

const REQUEST_ID = '2026-10-16-artifact-carrier-traps';

describe('behavior — the counting side reads the family, not the leading digits', () => {
  it('when a directory holds only date-shaped names, should answer 1 and not the year', () => {
    // given: the shape a fresh session's request directory takes
    const dir = dirWith(DATE_SHAPED);

    // when: the next number is asked for
    const next = getNextNumber(dir);

    // then: the year is not a file number, so the count starts from the family
    expect(next).toBe(1);
    // and the control: the pre-fix reading of the same directory was the year + 1
    expect(next).not.toBe(2027);
  });

  it('when a directory holds in-family names, should count them', () => {
    // given: a directory of writer output
    const dir = dirWith(['001-a.md', '007-b.md']);

    // when: the next number is asked for
    // then: the highest in-family prefix plus one
    expect(getNextNumber(dir)).toBe(8);
  });

  it('when a directory mixes both shapes, should count only the family', () => {
    // given: writer output beside the bare date-shaped names a session accumulates
    const dir = dirWith([...DATE_SHAPED, '003-c.md']);

    // when: the next number is asked for
    // then: the dated names neither raise nor lower the answer
    expect(getNextNumber(dir)).toBe(4);
  });

  it('when the directory is missing or holds no markdown, should answer 1', () => {
    // given: no such directory, and a directory with nothing in family
    // when/then: the count starts from 1 rather than from NaN
    expect(getNextNumber(join(tmpdir(), 'peaks-prefix-family-absent-dir'))).toBe(1);
    expect(getNextNumber(dirWith(['notes.txt']))).toBe(1);
  });
});

describe('behavior — the stripping side strips the same family', () => {
  it('when the name is a bare date-shaped stem, should return it verbatim', () => {
    // given: the dominant legal form of a request id in this repository
    // when: the id is read off the filename
    // then: nothing is stripped — a four-digit leading year is NOT a prefix
    expect(requestIdFromFileName('2026-10-15-macos-ledger-reaper.md')).toBe(
      '2026-10-15-macos-ledger-reaper'
    );
  });

  it('when the name carries an in-family prefix, should strip it', () => {
    // given: a name the writer produced for a date-shaped id
    // when: the id is read off the filename
    // then: the prefix is gone and the id is the one the caller passed
    expect(requestIdFromFileName(`001-${REQUEST_ID}.md`)).toBe(REQUEST_ID);
    expect(requestIdFromFileName('007-plain-slug.md')).toBe('plain-slug');
  });

  it('when the name is not markdown, should return null', () => {
    // given: a non-artifact filename
    // when/then: it carries no id to read
    expect(requestIdFromFileName('notes.txt')).toBeNull();
  });
});

describe('integration — the writer and the reader agree on one id', () => {
  it('when a fresh request is written into a date-shaped directory, should round trip to the id it was given', () => {
    // given: a directory of nothing but date-shaped names — the shape the trap fires in
    const dir = dirWith(DATE_SHAPED);

    // when: the writer numbers a fresh artifact and the reader reads it back
    const written = buildNumberedFilename(getNextNumber(dir), REQUEST_ID);
    const readBack = requestIdFromFileName(written);

    // then: the id survives the round trip. Before the family was shared this read
    //       back as `2027-<id>`, an id the state machine had never been given.
    expect(readBack).toBe(REQUEST_ID);
    expect(written).toBe(`001-${REQUEST_ID}.md`);
    expect(readBack).not.toContain('2027-');
  });

  it('when the directory already holds in-family names, should still round trip', () => {
    // given: the other directory shape, so the fix is not proven for one shape only
    const dir = dirWith([...DATE_SHAPED, '001-2026-10-15-macos-ledger-reaper.md']);

    // when: a fresh artifact is written and read back
    const written = buildNumberedFilename(getNextNumber(dir), REQUEST_ID);

    // then: the number moved, the id did not
    expect(written).toBe(`002-${REQUEST_ID}.md`);
    expect(requestIdFromFileName(written)).toBe(REQUEST_ID);
  });

  it('when the reader is handed every stem shape the tree holds, should answer as it always did', () => {
    // given: one representative of each shape a `.peaks/_runtime` artifact takes
    const shapes: ReadonlyArray<{ name: string; expected: string | null }> = [
      { name: '2026-10-15-macos-ledger-reaper.md', expected: '2026-10-15-macos-ledger-reaper' },
      { name: '001-a.md', expected: 'a' },
      { name: '099-z.md', expected: 'z' },
      { name: '100-hundred.md', expected: 'hundred' },
      { name: '999-last.md', expected: 'last' },
      { name: 'plain-slug.md', expected: 'plain-slug' },
      { name: 'notes.txt', expected: null }
    ];

    // when/then: the answer is unchanged for each — and a four-digit YEAR prefix is
    //            never stripped, which is the boundary the whole fix turns on
    for (const { name, expected } of shapes) {
      expect(requestIdFromFileName(name), name).toBe(expected);
    }
  });

  it('when a number has no three-digit spelling, should refuse to write it', () => {
    // given: the top of the family, reachable from a PLAIN FILENAME — `999-<stem>.md`
    //        needs no CLI to exist on disk, which is why this boundary is stated as
    //        "a named refusal" rather than as "unreachable"
    const dir = dirWith(['999-last.md']);

    // when: the next number is asked for, and the writer is handed it
    const next = getNextNumber(dir);

    // then: the count leaves the family, and the writer refuses by name instead of
    //       emitting a four-digit prefix no reader strips. AC-1's round trip is
    //       therefore total in the form "round trip OR this refusal" — and both
    //       halves are pinned here.
    expect(next).toBe(1000);
    expect(() => buildNumberedFilename(next, REQUEST_ID)).toThrow(/three digits/);
    expect(buildNumberedFilename(999, REQUEST_ID)).toBe(`999-${REQUEST_ID}.md`);
    expect(requestIdFromFileName(`999-${REQUEST_ID}.md`)).toBe(REQUEST_ID);
  });

  it('when the family pattern is read directly, should accept three digits and reject four', () => {
    // given: the one definition both sides share
    // when/then: it is anchored, and its width is exactly three
    expect(NUMBERED_PREFIX_RE.test('001-a.md')).toBe(true);
    expect(NUMBERED_PREFIX_RE.test('2026-10-15-a-b.md')).toBe(false);
    expect(NUMBERED_PREFIX_RE.test('12-a.md')).toBe(false);
  });
});
