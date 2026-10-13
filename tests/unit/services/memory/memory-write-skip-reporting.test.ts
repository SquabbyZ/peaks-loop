// tests/unit/services/memory/memory-write-skip-reporting.test.ts
//
// A planned write that the memory store ALREADY HELD was invisible. The block
// parsed, so `extractedCount` counted it and `plannedWrites` listed it; the
// write was then dropped by the idempotency skip with `warnings: []`. The
// envelope therefore described a run that had extracted the block and written
// nothing for it in exactly the words it used for a run that had written it.
//
// Measured on the unmodified code, one capsule of 5 blocks against a store that
// already held one of their target names: `extractedCount: 5`,
// `plannedWrites.length: 5`, `warnings: []`, 4 files on disk. A failed write and
// a successful one were indistinguishable from the output.
//
// Two separate failures are pinned here, and they are pinned in different
// directions:
//
//   - the STORE side — an existing target name no longer ends the block's story
//     silently: the block is named, and both counts are stated;
//   - the NAME side — a title written in a non-Latin script no longer reduces to
//     one shared constant filename. That constant is what put the first such
//     block and every later one on the same path, so the second one collided
//     with the first and was skipped.
//
// Every red-direction case below is built from the input its check was written
// to reject: a real collision with a name the store really holds, and the real
// title that the measurement was taken on.
//
// Run with:
//   pnpm exec vitest run tests/unit/services/memory/memory-write-skip-reporting.test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  describeMemoryWriteSkips,
  END_MARKER,
  executeProjectMemoryExtract,
  extractSessionMemories,
  MAX_NAMED_MEMORY_WRITE_SKIPS,
  slugify,
  START_MARKER
} from '~/src/services/memory/project-memory-service/index';

/** The title the 2026-10-12 measurement was taken on: no ASCII character at all. */
const CJK_TITLE = '一个自信报错的检测器比一个报不出来的检测器更糟';

/** Four ordinary ASCII titles, so one collision stands out from them. */
const ASCII_TITLES = [
  'Alpha result envelope shape',
  'Beta store layout',
  'Gamma write skip rule',
  'Zeta naming convention'
];

const ASCII_COUNT = ASCII_TITLES.length;
const CAPSULE_SIZE = ASCII_COUNT + 1;

/** One block, in the shape the extract path requires. */
function block(title: string, body: string): string {
  return `${START_MARKER}\ntitle: ${title}\nkind: lesson\n---\n${body}\n${END_MARKER}`;
}

/** The measured capsule: the four ASCII blocks plus the CJK-titled one. */
const CAPSULE = [
  ...ASCII_TITLES.map((title) => block(title, `Body of ${title}.`)),
  block(CJK_TITLE, '本 session 的每一片都出过真缺陷。')
].join('\n\n');

/** A stored memory file, enough of one for the name-reading path to see it. */
function storedMemory(name: string): string {
  return `---\nname: ${name}\ndescription: ${name}\nmetadata:\n  type: lesson\n---\n\nBody.\n`;
}

describe('a write the store already holds is reported, not swallowed', () => {
  let root: string;
  let memoryDir: string;
  const artifactPath = (): string => join(root, 'capsule.md');

  const extract = (apply: boolean): ReturnType<typeof executeProjectMemoryExtract> =>
    executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath()],
      apply
    });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-write-skip-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    writeFileSync(artifactPath(), CAPSULE, 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('RED-DIRECTION: names the block whose target the store already held', () => {
    // The input this check exists to reject: a real collision — the store really
    // holds the name this block's title resolves to.
    writeFileSync(join(memoryDir, `${slugify(CJK_TITLE)}.md`), storedMemory('held'), 'utf8');

    const result = extract(true);
    const written = result.writtenFiles.length;
    const planned = result.plannedWrites.length;

    expect(planned, 'the block is still extracted and still planned').toBe(CAPSULE_SIZE);
    expect(written, 'the collided one is not written').toBe(ASCII_COUNT);
    expect(result.skippedWrites, 'and it is recorded rather than dropped').toHaveLength(1);
    expect(result.skippedWrites[0]?.title).toBe(CJK_TITLE);

    const warnings = describeMemoryWriteSkips(result.skippedWrites, planned, written);
    expect(warnings, 'one line naming the loss, one stating its size').toHaveLength(2);
    expect(warnings.join('\n')).toContain(CJK_TITLE);
    expect(warnings.join('\n')).toContain('already exists');
    expect(warnings.join('\n')).toContain(
      `Wrote ${ASCII_COUNT} of ${CAPSULE_SIZE} planned memories`
    );
  });

  it('CONTROL: with nothing pre-existing, every block writes and nothing is reported', () => {
    const result = extract(true);

    expect(result.writtenFiles).toHaveLength(CAPSULE_SIZE);
    expect(result.skippedWrites, 'no collision means no line to write').toEqual([]);
    expect(describeMemoryWriteSkips(result.skippedWrites, CAPSULE_SIZE, CAPSULE_SIZE)).toEqual([]);
  });

  it('names every skipped block, not just the first, when the same capsule is re-extracted', () => {
    const first = extract(true);
    // Anti-vacuity: without this the second run's zero would also be produced by
    // an extractor that never wrote anything at all.
    expect(first.writtenFiles, 'the first run really wrote them').toHaveLength(CAPSULE_SIZE);

    const again = extract(true);
    expect(again.writtenFiles).toEqual([]);
    expect(again.skippedWrites).toHaveLength(CAPSULE_SIZE);

    const warnings = describeMemoryWriteSkips(
      again.skippedWrites,
      again.plannedWrites.length,
      again.writtenFiles.length
    );
    expect(warnings).toHaveLength(CAPSULE_SIZE + 1);
    expect(warnings.join('\n')).toContain(`Wrote 0 of ${CAPSULE_SIZE} planned memories`);
  });

  it('a preview reports no skip, because a preview performs no write', () => {
    // A preview writing nothing is what a preview IS, not a discrepancy, so the
    // channel must stay silent here — an always-firing warning is one nobody
    // reads. The store comparison runs only on the apply path.
    writeFileSync(join(memoryDir, `${slugify(CJK_TITLE)}.md`), storedMemory('held'), 'utf8');

    const result = extract(false);
    expect(result.skippedWrites).toEqual([]);
    expect(result.writtenFiles).toEqual([]);
  });
});

describe('a title in a non-Latin script keeps a name of its own', () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-slug-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const extractOne = (source: string): ReturnType<typeof executeProjectMemoryExtract> => {
    const artifactPath = join(root, 'capsule.md');
    writeFileSync(artifactPath, source, 'utf8');
    return executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: true
    });
  };

  it('RED-DIRECTION: the measured title does not land on the generic name', () => {
    // Before the change this exact title produced the stem `project-memory`, so
    // the file below was the filename, and the SECOND such title anywhere in the
    // project was skipped against it.
    expect(slugify(CJK_TITLE)).not.toBe('project-memory');

    const result = extractOne(block(CJK_TITLE, '本 session 的每一片都出过真缺陷。'));
    expect(result.writtenFiles).toHaveLength(1);
    expect(basename(result.writtenFiles[0] ?? '')).toBe(`${CJK_TITLE}.md`);
    expect(
      existsSync(join(memoryDir, 'project-memory.md')),
      'nothing was named after the generic fallback'
    ).toBe(false);
  });

  it('two different non-Latin titles reach two different files', () => {
    // The collapse, stated as the property that failed: distinct titles used to
    // share one name.
    const first = slugify('一个检测器比另一个更糟');
    const second = slugify('另一个检测器更糟');
    expect(first).not.toBe(second);
    expect(first).not.toBe('project-memory');
    expect(second).not.toBe('project-memory');
  });

  it('a title with no letter or digit in any script still gets a name of its own', () => {
    // The residue the replacement has to answer for: with every script's letters
    // AND digits stripped there is nothing left to build a filename from. A
    // shared constant is what caused the collision, so the fallback is derived
    // from the title instead — and '_' is outside the alphabet a title-derived
    // stem can contain, so a fallback cannot equal one either.
    const bang = slugify('!!!');
    const query = slugify('???');
    expect(bang).not.toBe('project-memory');
    expect(bang).not.toBe(query);
    expect(slugify('memory 212121'), 'a title cannot collide with a fallback').not.toBe(bang);
  });
});

describe('the session extract path reports the same axis', () => {
  let root: string;
  const sessionId = '2026-10-12-session-write-skip';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-session-skip-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
    mkdirSync(join(root, '.peaks', '_runtime', sessionId, 'txt'), { recursive: true });
    writeFileSync(
      join(root, '.peaks', '_runtime', sessionId, 'txt', 'handoff.md'),
      CAPSULE,
      'utf8'
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('names a session block whose target the store already holds', () => {
    const first = extractSessionMemories({ projectRoot: root, sessionId, apply: true });
    expect(first.writtenFiles, 'anti-vacuity: the first run really wrote them').toHaveLength(
      CAPSULE_SIZE
    );

    const again = extractSessionMemories({ projectRoot: root, sessionId, apply: true });
    expect(again.extractedCount, 'the parsed count is unchanged').toBe(CAPSULE_SIZE);
    expect(again.writtenFiles).toEqual([]);
    expect(again.skippedWrites).toHaveLength(CAPSULE_SIZE);

    const warnings = describeMemoryWriteSkips(
      again.skippedWrites,
      again.extractedCount,
      again.writtenFiles.length
    );
    expect(warnings.join('\n')).toContain(`Wrote 0 of ${CAPSULE_SIZE} planned memories`);
  });

  it('wires the skips into the envelope warnings channel, on both extract commands', () => {
    // The service returning the array is not enough — each command must pass it
    // to `ok(...)`. Static, because firing the real CLI here would need a built
    // dist. Both sites are read so a rename cannot make this pass vacuously on
    // one of them.
    const artifactCommand = readFileSync(
      resolve(process.cwd(), 'src', 'cli', 'commands', 'core', 'memory-extract-command.ts'),
      'utf8'
    );
    const sessionCommand = readFileSync(
      resolve(process.cwd(), 'src', 'cli', 'commands', 'project-commands.ts'),
      'utf8'
    );
    expect(artifactCommand, 'anti-vacuity: the file must actually have been read').toContain(
      'executeProjectMemoryExtract'
    );
    expect(artifactCommand).toContain('describeMemoryWriteSkips(');
    expect(sessionCommand, 'anti-vacuity: the file must actually have been read').toContain(
      'extractSessionMemories'
    );
    expect(sessionCommand).toContain('describeMemoryWriteSkips(');
  });
});

/**
 * The derived-name branch has to be BOUNDED. It used to encode the title as
 * `memory_` + two hex characters per UTF-8 byte, so the name grew with the
 * title: a long enough title produced a name past the filesystem limit, the
 * write threw, and the WHOLE extract exited 1 with 0 files — a title able to
 * destroy every other block's write. The bound is now `memory_` + 32 hex of the
 * title's sha256, i.e. 39 characters for every title.
 *
 * WHICH ARMS ARE EVIDENCE. The two `wasNameLength` values above 255 were RUN
 * against the pre-fix code and aborted (exit 1, 0 files); 247 was already inside
 * the limit and wrote then too, so it is here as a CONTROL. The last two arms
 * are the near-boundary cases: a 10,000-character title and two titles sharing a
 * 400-character prefix, which is the input a byte-truncation would have
 * collided on.
 */
describe('the derived name is bounded, so a long title cannot abort the batch', () => {
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-slug-bound-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const extractOne = (title: string): ReturnType<typeof executeProjectMemoryExtract> => {
    const artifactPath = join(root, 'capsule.md');
    writeFileSync(artifactPath, block(title, 'Body.'), 'utf8');
    return executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [artifactPath],
      apply: true
    });
  };

  const cases: ReadonlyArray<{
    label: string;
    title: string;
    wasNameLength: number;
    abort: boolean;
  }> = [
    { label: 'a 120-! title', title: '!'.repeat(120), wasNameLength: 247, abort: false },
    { label: 'a 140-! title', title: '!'.repeat(140), wasNameLength: 287, abort: true },
    { label: 'a 40-emoji title', title: '🎉'.repeat(40), wasNameLength: 327, abort: true }
  ];

  for (const { label, title, wasNameLength, abort } of cases) {
    const kind = abort ? 'RED-DIRECTION' : 'CONTROL (inside the limit before the fix too)';
    it(`${kind}: ${label} writes its file`, () => {
      // The old name length is stated rather than assumed: two of these were past
      // the filesystem limit, which is what made the old write throw.
      expect(slugify(title).length, `the old name was ${wasNameLength} chars`).toBeLessThan(255);

      const result = extractOne(title);

      expect(result.writtenFiles, 'the batch is not aborted').toHaveLength(1);
      expect(result.skippedWrites).toEqual([]);
      const written = result.writtenFiles[0] ?? '';
      expect(basename(written)).toBe(`${slugify(title)}.md`);
      expect(existsSync(written), 'the file really appears on disk').toBe(true);
    });
  }

  it('the bound is a constant, not a shortened title', () => {
    // 10,000 characters: if the name were the bytes (even truncated to the
    // limit), its length would track the title and the next longer title would
    // fail again. As a digest it is the same 39 as a three-character title.
    const huge = '!'.repeat(10000);
    expect(slugify('!!!')).toHaveLength(39);
    expect(slugify(huge)).toHaveLength(39);
    expect(slugify(huge)).toMatch(/^memory_[0-9a-f]{32}$/);
  });

  it('two titles sharing a long prefix do NOT share a derived name', () => {
    // Built from the input a byte-truncation would have collided on: same
    // 400-character prefix, one differing last character.
    const left = `${'!'.repeat(400)}?`;
    const right = `${'!'.repeat(400)}*`;
    expect(slugify(left)).not.toBe(slugify(right));
    expect(slugify(left)).toHaveLength(39);
  });

  it('the same title is stable, so a re-run still recognises its own file', () => {
    // Idempotency depends on this: if the name moved between runs, the second
    // extract would write a second copy instead of reporting a skip.
    expect(slugify('🎉'.repeat(40))).toBe(slugify('🎉'.repeat(40)));
  });
});

/**
 * The skip LIST is capped; the skip COUNT is not. The count is the fact this
 * whole slice exists to deliver, so the cap must not touch it — a truncation
 * that dropped the number would reintroduce the original defect one level up.
 *
 * The arm is built from the input the cap exists for: more skipped blocks than
 * the cap, every one of them a real collision.
 */
describe('the skip list is capped while the count stays exact', () => {
  const skipsOverCap = MAX_NAMED_MEMORY_WRITE_SKIPS + 5;
  let root: string;
  let memoryDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-skip-cap-'));
    memoryDir = join(root, '.peaks', 'memory');
    mkdirSync(memoryDir, { recursive: true });
    const titles = Array.from({ length: skipsOverCap }, (_, i) => `Bulk memory number ${i}`);
    // the store already holds every target, so EVERY planned write is skipped
    for (const title of titles) {
      writeFileSync(join(memoryDir, `${slugify(title)}.md`), storedMemory('held'), 'utf8');
    }
    writeFileSync(
      join(root, 'capsule.md'),
      titles.map((title) => block(title, `Body of ${title}.`)).join('\n\n'),
      'utf8'
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('RED-DIRECTION: more skips than the cap stay bounded and fully counted', () => {
    const result = executeProjectMemoryExtract({
      projectRoot: root,
      artifactPaths: [join(root, 'capsule.md')],
      apply: true
    });
    const planned = result.plannedWrites.length;
    const written = result.writtenFiles.length;

    expect(planned, 'the capsule is larger than the cap').toBe(skipsOverCap);
    expect(result.skippedWrites).toHaveLength(skipsOverCap);
    expect(written).toBe(0);

    const warnings = describeMemoryWriteSkips(result.skippedWrites, planned, written);

    // bounded: the named lines + the "… and N more" line + the count line
    expect(warnings).toHaveLength(MAX_NAMED_MEMORY_WRITE_SKIPS + 2);
    // the lines that ARE named are real skips, not filler
    expect(
      warnings
        .slice(0, MAX_NAMED_MEMORY_WRITE_SKIPS)
        .every(
          (line) =>
            line.startsWith('Skipped writing the memory "') && line.includes('already exists')
        )
    ).toBe(true);
    // the ones dropped from the list are counted rather than lost
    expect(warnings[MAX_NAMED_MEMORY_WRITE_SKIPS]).toContain(
      `and ${skipsOverCap - MAX_NAMED_MEMORY_WRITE_SKIPS} more skipped writes`
    );

    // the arithmetic the reader is told to trust: written + skipped === planned
    const closing = warnings[MAX_NAMED_MEMORY_WRITE_SKIPS + 1] ?? '';
    expect(closing).toBe(
      `Wrote ${written} of ${planned} planned memories; ${skipsOverCap} skipped because the target file already exists.`
    );
    const parsed = closing.match(/Wrote (\d+) of (\d+) planned memories; (\d+) skipped/);
    expect(parsed, 'the closing line is machine-readable').not.toBeNull();
    const reportedWritten = Number(parsed?.[1] ?? -1);
    const reportedPlanned = Number(parsed?.[2] ?? -1);
    const reportedSkipped = Number(parsed?.[3] ?? -1);
    expect(reportedWritten + reportedSkipped).toBe(reportedPlanned);
    expect(reportedSkipped).toBe(skipsOverCap);
  });
});
