/**
 * tests/unit/scripts/test-changed-config-reader-map.test.ts
 *
 * The root-config → reader map, and the arm that keeps it honest.
 * rid `2026-10-17-config-readers-reach-the-suite`.
 *
 * THE HOLE. `classifyChanged()` decides its net on the mapping alone, so a path that maps to
 * nothing is INVISIBLE: it neither trips the full-suite fallback nor widens a subset. `.gitignore`
 * beside `src/` therefore classified `subset` and skipped the test that reads the root file.
 * Measured with the shipped classifier over all history: 9 such composite commits.
 *
 * WHAT THIS FILE PROVES, in the two directions a mapping can fail:
 *   - a key in the map must select its reader in a composite diff, and must NOT change a
 *     key-only diff (the map widens a subset; it does not create one);
 *   - the entry must be TRUE — the named test really reads the key from the repository root.
 *     The control is a real pair, not a synthetic one: `staged-parity-gate.test.ts` names
 *     `.gitattributes` only in a comment, so the arm rejects the mapping that a literal scan
 *     would have accepted.
 *
 * WHY A SIBLING OF `test-changed-classify.test.ts`. The file-size-delta leg refuses GROWTH in a
 * file already over its cap, and that file carries 915 lines against a 500 cap. A sibling is the
 * same reason `test-changed-config-path-triggers.test.ts` exists.
 *
 * THE LIMIT OF THE SCAN (stated, not hidden): comment stripping is LINE-BASED. A block comment
 * whose continuation lines do not begin with `*` can still carry a literal that looks like a
 * read. The direction is conservative — the arm can only pass something a strict reader would
 * reject — and the alternative, a prose parser, is a larger thing than this arm needs.
 *
 * Dimensions: `render` is omitted — the classifier renders nothing; its verdict is an object.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/test-changed-config-reader-map.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the classifier renders nothing — its verdict is an object; the runner owns the human-facing output'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const MODULE_REL = 'scripts/test-changed-classify.mjs';
const MODULE_URL = pathToFileURL(join(REPO_ROOT, MODULE_REL)).href;
const MAP_MODULE_REL = 'scripts/config-reader-map.mjs';
const MAP_MODULE_URL = pathToFileURL(join(REPO_ROOT, MAP_MODULE_REL)).href;

type Entry = { status?: string; path?: string };

type Plan = {
  mode: 'full' | 'none' | 'subset';
  paths: string[];
  code: string;
  reasons: string[];
};

type MapModule = {
  CONFIG_READER_MAP: Readonly<Record<string, readonly string[]>>;
  configReaderHits(entries: readonly Entry[]): string[];
};

type ClassifyModule = {
  BASELINE_REL: string;
  CONFIG_READER_MAP: Readonly<Record<string, readonly string[]>>;
  configReaderHits(entries: readonly Entry[]): string[];
  FULL_FALLBACK_TRIGGERS: readonly RegExp[];
  classifyChanged(entries: readonly Entry[], options?: { baselineContentMoved?: boolean }): Plan;
};

async function loadModule(): Promise<ClassifyModule> {
  return (await import(MODULE_URL)) as ClassifyModule;
}

/** The declared surface a reader imports; the definition lives in the copy-safe classifier. */
async function loadMapModule(): Promise<MapModule> {
  return (await import(MAP_MODULE_URL)) as MapModule;
}

const SCRATCH = mkdtempSync(join(tmpdir(), 'peaks-config-reader-'));

afterAll(() => {
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** The calls that make a line a READER of a path rather than a mention of its name. */
const READ_CALLS = [
  'readFileSync',
  'readFile',
  'existsSync',
  'statSync',
  'lstatSync',
  'join(',
  'resolve(',
  'check-ignore'
] as const;

/** Calls that WRITE or remove a path: a line carrying one is not a reader of it. */
const WRITE_CALLS = [
  'writeFileSync',
  'writeFile',
  'appendFileSync',
  'rmSync',
  'mkdirSync'
] as const;

/**
 * The repository-root binding both measured readers use. A `join(root, '.gitignore')` over an
 * `mkdtemp` directory names the same KEY but not the repository's file, so it is not a reader.
 */
const ROOT_BINDING = 'REPO_ROOT';

/**
 * The source with full-line comments removed. Line-based on purpose: a stray block-comment body
 * can survive, which can only make the arm MORE permissive, never less — see the file header.
 */
function nonCommentLines(source: string): string[] {
  const out: string[] = [];
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('//') || line.startsWith('*') || line.startsWith('/*')) {
      continue;
    }
    out.push(line);
  }
  return out;
}

/**
 * A line is a READER of `key` only when it names the key, carries a read/join call, binds the
 * path to the REPOSITORY root, and carries no write call. Each conjunct has a pin below: the
 * temp-root reader and the `writeFileSync(join(REPO_ROOT, …))` shape both fail one of them.
 */
function isReaderLine(line: string, key: string): boolean {
  return (
    line.includes(key) &&
    READ_CALLS.some((call) => line.includes(call)) &&
    line.includes(ROOT_BINDING) &&
    !WRITE_CALLS.some((call) => line.includes(call))
  );
}

/** The pure predicate the arm and its synthetic pins share: does `source` READ `key`? */
function sourceReadsKey(source: string, key: string): boolean {
  return nonCommentLines(source).some((line) => isReaderLine(line, key));
}

/**
 * The arm proper: THROW unless `readerRel` contains a line that `sourceReadsKey` accepts.
 * Exported to no one — every control below is the same code path.
 */
function assertReaderReadsKey(key: string, readerRel: string): void {
  const sourcePath = join(REPO_ROOT, readerRel);
  if (!existsSync(sourcePath)) {
    throw new Error(`${readerRel} is not on disk — ${key} names a reader that does not exist`);
  }
  if (sourceReadsKey(readFileSync(sourcePath, 'utf8'), key)) return;
  throw new Error(
    `${readerRel} does not read ${key}: no non-comment line reads it from ${ROOT_BINDING}`
  );
}

/** The real, already-existing pair the recorded shape wanted to map — comment-only. */
const COMMENT_ONLY_CONTROL = {
  key: '.gitattributes',
  reader: 'tests/unit/hooks/staged-parity-gate.test.ts'
} as const;

/** This slice's map block plus the trigger, exactly as the shipped source spells them. */
const MAP_BLOCK_ANCHOR = [
  '/** Root config → the test that reads it; unioned into a subset only (`scripts/config-reader-map.mjs`). */',
  'export const CONFIG_READER_MAP = Object.freeze({',
  '  __proto__: null,',
  "  '.gitignore': ['tests/unit/workspace/top-level-change-id-guard.test.ts'],",
  "  'pnpm-workspace.yaml': ['tests/unit/scripts/packages-build-prerequisite.test.ts']",
  '});',
  'export const configReaderHits = (entries) =>',
  '  entries.flatMap((entry) => CONFIG_READER_MAP[entry.path] ?? []);',
  ''
].join('\n');

const BEFORE_ANCHORS: ReadonlyArray<readonly [string, string]> = [
  [MAP_BLOCK_ANCHOR, ''],
  [
    "  return subset([...mapped, ...guards, ...configReaderHits(entries)], 'subset', reasons);\n",
    "  return subset([...mapped, ...guards], 'subset', reasons);\n"
  ],
  ['  /^\\.gitattributes$/,\n', '']
];

/** The shipped module's bytes with this slice's three additions removed — the before-state. */
async function loadBeforeSlice(): Promise<ClassifyModule> {
  const source = readFileSync(join(REPO_ROOT, MODULE_REL), 'utf8');
  let planted = source;
  for (const [anchor, replacement] of BEFORE_ANCHORS) {
    expect(planted, `${MODULE_REL} no longer carries ${JSON.stringify(anchor)}`).toContain(anchor);
    planted = planted.replace(anchor, replacement);
  }
  expect(planted, 'the injection must really change the module').not.toBe(source);
  const target = join(mkdtempSync(join(SCRATCH, 'planted-')), 'test-changed-classify.mjs');
  writeFileSync(target, planted, 'utf8');
  return (await import(pathToFileURL(target).href)) as ClassifyModule;
}

const asEntries = (paths: readonly string[]): Entry[] =>
  paths.map((path) => ({ status: 'M', path }));

const selectionOf = (plan: Plan): string => JSON.stringify({ mode: plan.mode, paths: plan.paths });

/** Diffs carrying neither mapped key — the group whose verdicts must not move by a byte. */
const NEITHER_KEY: ReadonlyArray<readonly [string, string[]]> = [
  ['a src area', ['src/cli/x.ts']],
  ['a tests area', ['tests/unit/services/x.test.ts']],
  ['docs', ['docs/guide.md']],
  ['README', ['README.md']],
  ['a full-suite trigger', ['package.json']],
  ['the baseline exemption', ['.peaks/lint/gate-baseline.json']],
  ['an empty diff', []]
];

// ---------------------------------------------------------------------------
// behavior — the line predicate itself, pinned so deleting a conjunct reds
// ---------------------------------------------------------------------------

describe('Scenario: behavior — a line is a READER only with a root-bound read', () => {
  it('when a comment line carries a root read, should not count it as a reader', () => {
    // given: a root read that exists only in prose
    // when:  the predicate sees it commented, then uncommented
    // then:  the comment stripper is what makes the difference, so deleting it reds this arm
    const line = "// readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')";
    expect(sourceReadsKey(line, '.gitignore'), 'a comment is not a reader').toBe(false);
    expect(
      sourceReadsKey(line.replace('// ', ''), '.gitignore'),
      'the same read, uncommented'
    ).toBe(true);
  });

  it('when a read binds a temp root, should not count it as a reader', () => {
    // given: a real read of a SAME-NAMED file under an mkdtemp directory
    // when:  the predicate sees it
    // then:  it is not a reader: the repository root binding is required
    expect(sourceReadsKey("readFileSync(join(root, '.gitignore'), 'utf8')", '.gitignore')).toBe(
      false
    );
  });

  it('when a line writes the key, should not count it as a reader', () => {
    // given: a root-bound write of the key
    // when:  the predicate sees it
    // then:  it is not a reader: the write calls are excluded
    expect(
      sourceReadsKey("writeFileSync(join(REPO_ROOT, '.gitignore'), 'x', 'utf8')", '.gitignore')
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// behavior — what a mapped key does to a verdict
// ---------------------------------------------------------------------------

describe('Scenario: behavior — a mapped key selects its reader beside a mapped path', () => {
  it('when the diff is a mapped key plus src/, should widen the subset to the reader', async () => {
    // given: every declared entry, and a diff that already maps through `src/cli`
    // when:  the shipped classifier classifies it
    // then:  still a subset (the net is untouched), now carrying the test that reads the key
    const mod = await loadModule();
    const map = await loadMapModule();
    for (const [key, readers] of Object.entries(map.CONFIG_READER_MAP)) {
      const plan = mod.classifyChanged(asEntries([key, 'src/cli/x.ts']));

      expect(plan.mode, `${key} beside src/ must stay a subset`).toBe('subset');
      expect(plan.code, `${key} must be classified by the mapping`).toBe('subset');
      expect(plan.paths, 'a src area still selects its own directory').toContain('tests/unit/cli');
      for (const reader of readers) {
        expect(plan.paths, `${key} must select its reader ${reader}`).toContain(reader);
      }
    }
  });

  it('when the diff is a mapped key ALONE, should stay full by the unmapped backstop', async () => {
    // given: each key with nothing mapped beside it
    // when:  the shipped classifier classifies it
    // then:  the whole suite, unchanged — the map widens a subset, it does not create one
    const mod = await loadModule();
    const map = await loadMapModule();
    for (const key of Object.keys(map.CONFIG_READER_MAP)) {
      const plan = mod.classifyChanged([{ status: 'M', path: key }]);

      expect(plan.mode, `${key} alone must still run the whole suite`).toBe('full');
      expect(plan.code, `${key} alone must still be the unmapped backstop`).toBe('unmapped');
      expect(plan.paths, 'a full verdict names no files').toEqual([]);
    }
  });

  it('when .gitattributes changes, should run the whole suite coded as a trigger', async () => {
    // given: the key with no root reader — alone, and beside a path that maps
    // when:  the shipped classifier classifies each
    // then:  `trigger` both times: its blast radius is git-wide, not a file list
    const mod = await loadModule();
    for (const paths of [['.gitattributes'], ['.gitattributes', 'src/cli/x.ts']]) {
      const plan = mod.classifyChanged(asEntries(paths));

      expect(plan.mode, `${paths.join(' ')} must not degrade to a subset`).toBe('full');
      expect(plan.code, 'the suite must come from the trigger').toBe('trigger');
      expect(plan.paths).toEqual([]);
    }

    const re = mod.FULL_FALLBACK_TRIGGERS.find(
      (candidate) => candidate.source === '^\\.gitattributes$'
    );
    expect(re, '.gitattributes must be in the trigger list').toBeDefined();
    expect(re?.test('.gitattributes')).toBe(true);
    expect(re?.test('.gitattributes.bak'), 'the entry is anchored').toBe(false);
  });

  it('when the diff is the baseline exemption, should reach its guard suites unchanged', async () => {
    // given: the one path the broad `.peaks/` trigger must not catch
    // when:  the classifier and the new entry are asked about it
    // then:  `r1-readers` still selects the guards, and the entry does not catch the path
    const mod = await loadModule();
    const plan = mod.classifyChanged([{ status: 'M', path: mod.BASELINE_REL }]);

    expect(plan.code).toBe('r1-readers');
    const re = mod.FULL_FALLBACK_TRIGGERS.find(
      (candidate) => candidate.source === '^\\.gitattributes$'
    );
    expect(re?.test(mod.BASELINE_REL), 'the entry must not catch the exemption').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// integration — the arm is bound to the sources and the module it guards
// ---------------------------------------------------------------------------

describe('Scenario: integration — every mapping is a real read of an existing test', () => {
  it('when the map is walked, should find each named reader on disk and reading its key', async () => {
    // given: every declared entry
    // when:  the arm reads each reader's source
    // then:  the file exists and carries a real read call beside the literal key
    const mod = await loadModule();
    const map = await loadMapModule();
    expect(map.CONFIG_READER_MAP, 'the declared surface is the classifier map').toBe(
      mod.CONFIG_READER_MAP
    );
    // The helper is compared by RESULT, not by reference: an unbound method reference trips
    // `@typescript-eslint/unbound-method`, and the two modules share one implementation anyway.
    expect(map.configReaderHits([{ path: '.gitignore' }])).toEqual(
      mod.configReaderHits([{ path: '.gitignore' }])
    );
    for (const [key, readers] of Object.entries(map.CONFIG_READER_MAP)) {
      for (const reader of readers) {
        expect(existsSync(join(REPO_ROOT, reader)), `${reader} must exist`).toBe(true);
        expect(
          () => assertReaderReadsKey(key, reader),
          `${key} → ${reader} must be a real reader`
        ).not.toThrow();
      }
    }
  });

  it('when a mapped reader is deleted, should RED rather than pass', async () => {
    // given: a reader path that is not on disk — what a deleted test looks like to the arm
    // when:  the arm runs on it
    // then:  it throws, so an entry cannot outlive the test it names
    expect(() =>
      assertReaderReadsKey('.gitignore', 'tests/unit/workspace/deleted-reader.test.ts')
    ).toThrow(/is not on disk/);
  });

  it('when this slice is deleted, should show the composite diff losing its reader', async () => {
    // given: the shipped module and the same module without the map, the helper or the trigger
    // when:  both classify the same diffs
    // then:  the composite arm above is a rule a deletion makes FALSE — the before-state is a
    //        subset that omits the reader, and `.gitattributes` falls back to the unmapped path
    const mod = await loadModule();
    const map = await loadMapModule();
    const planted = await loadBeforeSlice();

    for (const [key, readers] of Object.entries(map.CONFIG_READER_MAP)) {
      const after = mod.classifyChanged(asEntries([key, 'src/cli/x.ts']));
      const before = planted.classifyChanged(asEntries([key, 'src/cli/x.ts']));

      expect(after.mode, 'control: the shipped module stays a subset').toBe('subset');
      expect(before.mode, 'without the map the composite diff is still a subset').toBe('subset');
      for (const reader of readers) {
        expect(after.paths).toContain(reader);
        expect(before.paths, `${reader} was not selected before this slice`).not.toContain(reader);
      }
    }

    const beforeAttribute = planted.classifyChanged(asEntries(['.gitattributes', 'src/cli/x.ts']));
    expect(beforeAttribute.mode, 'without the trigger the key rode the subset').toBe('subset');
    const beforeAlone = planted.classifyChanged(asEntries(['.gitattributes']));
    expect(beforeAlone.mode).toBe('full');
    expect(beforeAlone.code, 'the key alone reached the suite only through the backstop').toBe(
      'unmapped'
    );
  });

  it('when the diff carries neither key, should be byte-identical to the before-state', async () => {
    // given: diffs naming no mapped key and not naming `.gitattributes`
    // when:  both revisions classify them
    // then:  the whole Plan — mode, paths, code AND the reason lines — is identical
    const mod = await loadModule();
    const planted = await loadBeforeSlice();

    for (const [label, paths] of NEITHER_KEY) {
      expect(selectionOf(mod.classifyChanged(asEntries(paths))), label).toBe(
        selectionOf(planted.classifyChanged(asEntries(paths)))
      );
      expect(mod.classifyChanged(asEntries(paths)), label).toEqual(
        planted.classifyChanged(asEntries(paths))
      );
    }
  });
});

// ---------------------------------------------------------------------------
// a11y — the message an arm that rejects a mapping must carry
// ---------------------------------------------------------------------------

describe('Scenario: a11y — a rejected mapping says which pair and why', () => {
  it('when a reader names the key only in a comment, should RED naming both halves', () => {
    // given: the recorded shape's `.gitattributes` pair — the key appears ONLY in a comment line
    // when:  the same arm the passing entries run on is given it
    // then:  it throws, and the message names the file and the reason, so a mapping cannot be
    //        accepted on a literal scan
    let message = '';
    try {
      assertReaderReadsKey(COMMENT_ONLY_CONTROL.key, COMMENT_ONLY_CONTROL.reader);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message, 'the control must red, not pass').toContain(COMMENT_ONLY_CONTROL.reader);
    expect(message).toContain(COMMENT_ONLY_CONTROL.key);
    expect(message).toContain('no non-comment line');
    expect(() =>
      assertReaderReadsKey(COMMENT_ONLY_CONTROL.key, COMMENT_ONLY_CONTROL.reader)
    ).toThrow(/does not read \.gitattributes/);
  });

  it('when a real test reads the key from a temp root, should RED naming the file', () => {
    // given: the test the PRD calls NOT a reader — it writes and reads a temp root `.gitignore`
    // when:  the arm is given the pair
    // then:  it throws; a same-named temp file does not satisfy the repository-root binding
    let message = '';
    try {
      assertReaderReadsKey('.gitignore', 'tests/unit/workspace/gitignore-snippet-matches.test.ts');
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message, 'the temp-root reader must red').toContain(
      'tests/unit/workspace/gitignore-snippet-matches.test.ts'
    );
    expect(message).toContain('no non-comment line reads it from REPO_ROOT');
    expect(() =>
      assertReaderReadsKey('.gitignore', 'tests/unit/workspace/gitignore-snippet-matches.test.ts')
    ).toThrow(/does not read \.gitignore/);
  });
});
