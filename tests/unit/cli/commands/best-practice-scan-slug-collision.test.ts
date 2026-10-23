// tests/unit/cli/commands/best-practice-scan-slug-collision.test.ts
//
// §12.3: the best-practice-scan artifact path keys on `(date, slug)` with the
// slug capped at 32 characters, so two intents that agree in their first 32
// slug characters landed on ONE file — the second scan silently overwrote the
// first one's recommendation, and both exited 0. These arms pin the refusal
// that replaced the silent overwrite, and pin the paths that must not move.
//
// Dimensions covered:
//   - behavior:    the refusal, and the two collision shapes
//   - a11y:        exit code and the code the caller reads
//   - integration: what is (and is not) on disk
//   - render:      the table that must NOT be produced

import { Command } from 'commander';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { registerBestPracticeScanCommand } from '../../../../src/cli/commands/best-practice-scan-command.js';

declareDimensions('tests/unit/cli/commands/best-practice-scan-slug-collision.test.ts', [
  'render',
  'behavior',
  'a11y',
  'integration'
]);

const STDIN_SEAM = 'PEAKS_BEST_PRACTICE_STDIN';
const FRAGMENTS = [
  { title: 'Caching best practices', url: 'https://docs.example.com/cache', snippet: 'frag A' },
  { title: 'Cache invalidation', url: 'https://docs.example.com/cache-2', snippet: 'frag B' }
];

/** Shape 1 — the §12.3 shape: both intents normalise to the same 32-character
 *  slug, because their first 32 slug characters agree. */
const CAP_A = 'best-practice-scan-for-the-api-x one';
const CAP_B = 'best-practice-scan-for-the-api-x two';
/** The slug both of them land on: the first 32 characters of the normalised
 *  intent. */
const CAP_SLUG = 'best-practice-scan-for-the-api-x';

/** Shape 2 — two intents that are different text but the same slug, with no
 *  truncation involved: `!` and `?` both collapse to `-`. */
const PUNCT_A = 'add a caching layer!';
const PUNCT_B = 'add a caching layer?';
const PUNCT_SLUG = 'add-a-caching-layer-';

/** A long intent nobody else owns: its slug is truncated to 32 characters,
 *  and that path is where it has always been written. */
const UNIQUE_INTENT = 'add caching layer to the payments api';
const UNIQUE_SLUG = 'add-caching-layer-to-the-payment';

let projectRoot: string;
let exitBefore: typeof process.exitCode;
let resultsFileCounter = 0;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bps-collision-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
  resultsFileCounter = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

const date = (): string => new Date().toISOString().slice(0, 10);

/** `<project>/best-practice/<date>-<slug>.md` — the primary artifact path. */
function primary(slug: string): string {
  return join(projectRoot, 'best-practice', `${date()}-${slug}.md`);
}

async function runCli(
  args: readonly string[]
): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerBestPracticeScanCommand(program, io);
  await program.parseAsync(['best-practice-scan', ...args], { from: 'user' });
  return captured;
}

/** A caller-supplied lookup that answers with real fragments. */
function lookupFile(intent: string): string {
  resultsFileCounter += 1;
  const path = join(projectRoot, `results-${resultsFileCounter}.json`);
  writeFileSync(
    path,
    JSON.stringify({ intent, context7: { ok: true, results: FRAGMENTS } }),
    'utf8'
  );
  return path;
}

/** A scan for `intent` with a real lookup injected: it renders and writes. */
async function injected(
  intent: string,
  asJson: boolean
): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  withEnv(STDIN_SEAM, '');
  const args = [
    '--intent',
    intent,
    '--project',
    projectRoot,
    '--lang',
    'typescript',
    '--lookup-results',
    lookupFile(intent)
  ];
  if (asJson) args.push('--json');
  return runCli(args);
}

describe('behavior — a scan that would overwrite another intent is refused', () => {
  it('when two intents share the first 32 slug characters, should refuse the second scan and keep the first artifact', async () => {
    // given: a real scan whose artifact path is owned by another intent
    // when: a different intent lands on the same path
    // then: the first scan's artifact is intact — it still holds the first
    //        intent, and nothing of the second one landed on it
    await injected(CAP_A, false);
    expect(readFileSync(primary(CAP_SLUG), 'utf8')).toContain(CAP_A);

    await injected(CAP_B, true);

    const after = readFileSync(primary(CAP_SLUG), 'utf8');
    expect(after).toContain(CAP_A);
    expect(after).not.toContain(CAP_B);
  });

  it('when two intents normalise to the same slug without truncation, should refuse the second scan too', async () => {
    // given: a real scan whose artifact path is owned by another intent
    // when: a different intent lands on the same path
    // then: the first scan's artifact is intact — it still holds the first
    //        intent, and nothing of the second one landed on it
    await injected(PUNCT_A, false);
    expect(readFileSync(primary(PUNCT_SLUG), 'utf8')).toContain(PUNCT_A);

    await injected(PUNCT_B, true);

    const after = readFileSync(primary(PUNCT_SLUG), 'utf8');
    expect(after).toContain(PUNCT_A);
    expect(after).not.toContain(PUNCT_B);
  });

  it('when the same intent scans twice, should overwrite its own artifact instead of refusing', async () => {
    // given: a real scan for an intent
    // when: the same intent scans again
    // then: it is the same scan re-running, so it overwrites as it always did
    await injected(UNIQUE_INTENT, true);

    await injected(UNIQUE_INTENT, true);

    expect(process.exitCode).toBe(0);
    expect(readFileSync(primary(UNIQUE_SLUG), 'utf8')).toContain('**方案 A ★**');
  });
});

describe('a11y — the collision refusal is loud', () => {
  it('when a scan refuses a collision, should exit non-zero and name the collision in the envelope', async () => {
    // given: a real scan whose artifact path is owned by another intent
    // when: a different intent lands on the same path
    // then: the caller cannot read this as satisfied
    await injected(CAP_A, false);

    const captured = await injected(CAP_B, true);

    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_SLUG_COLLISION"');
    expect(captured.text()).toContain(CAP_SLUG);
  });

  it('when a scan refuses a collision, should name both the refused intent and the intent that owns the path', async () => {
    // given: a real scan whose artifact path is owned by another intent
    // when: a different intent lands on the same path
    // then: the envelope says which intent was refused and which one owns the path
    await injected(CAP_A, false);

    const captured = await injected(CAP_B, true);

    expect(captured.text()).toContain(CAP_B);
    expect(captured.text()).toContain(CAP_A);
  });
});

describe('integration — the artifact on disk', () => {
  it('when an intent collides with nothing, should still write to the date-and-slug artifact path', async () => {
    // given: a fresh project and an intent nobody else owns
    // when: the scan runs
    // then: the artifact is at the path it has always been written to, and it is the only one
    await injected(UNIQUE_INTENT, true);

    expect(process.exitCode).toBe(0);
    expect(readdirSync(join(projectRoot, 'best-practice'))).toEqual([
      `${date()}-${UNIQUE_SLUG}.md`
    ]);
    expect(readFileSync(primary(UNIQUE_SLUG), 'utf8')).toContain('**方案 A ★**');
  });

  it('when a refusal already owns the path for the same intent, should still render the recommendation over it', async () => {
    // given: an un-injected scan, whose skip record lands at the primary path
    // when: a real scan for the same intent runs
    // then: the recommendation replaces the skip record, as it always did
    //        (the exit code is not asserted: the earlier refusal already set it to 1,
    //         and the command never resets it — that is pre-existing behaviour)
    await runCli([
      '--intent',
      UNIQUE_INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--json'
    ]);
    expect(process.exitCode).toBe(1);
    expect(existsSync(primary(UNIQUE_SLUG))).toBe(true);

    const captured = await injected(UNIQUE_INTENT, true);

    expect(captured.text()).not.toContain('BEST_PRACTICE_SCAN_SLUG_COLLISION');
    expect(readFileSync(primary(UNIQUE_SLUG), 'utf8')).toContain('**方案 A ★**');
  });
});

describe('render — the collision refusal renders nothing', () => {
  it('when a scan refuses a collision, should print no comparison table and no catch gate', async () => {
    // given: a real scan whose artifact path is owned by another intent
    // when: a different intent lands on the same path
    // then: the refusal is the whole answer — no table, no ★, no gate
    await injected(CAP_A, false);

    const captured = await injected(CAP_B, true);

    const out = captured.text();
    expect(out).not.toContain('**方案 A ★**');
    expect(out).not.toContain('| **LLM 推荐** |');
    expect(out).not.toContain('catch-gate outcome');
  });
});
