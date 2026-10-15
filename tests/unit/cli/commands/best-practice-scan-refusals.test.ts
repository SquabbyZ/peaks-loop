// tests/unit/cli/commands/best-practice-scan-refusals.test.ts
//
// The refusal-boundary arms added by repair round 1: the four blockers the four
// independent reviews measured. Split from `best-practice-scan-lookup-results.test.ts`
// because the 500-line test cap is real and this file is not the place to argue
// with it.
//
// Every arm here was RED against the pre-repair source, for the reason its name
// states, and green after. Driven through the REAL command and the REAL
// orchestrator — a mocked orchestrator would hide the whole point.
//
// Dimensions covered:
//   - behavior:    zero-fragment refusal, the never-overwrite rule, the injected
//                  bypasses (the marker in `intent`, the `-synthetic` collision)
//   - integration: what is (and is not) on disk
//   - a11y:        exit codes and codes for each refusal
//   - render:      the table that must NOT be produced

import { Command } from 'commander';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { registerBestPracticeScanCommand } from '../../../../src/cli/commands/best-practice-scan-command.js';

declareDimensions('tests/unit/cli/commands/best-practice-scan-refusals.test.ts', [
  'render',
  'behavior',
  'a11y',
  'integration'
]);

const INTENT = 'add a caching layer';
const STDIN_SEAM = 'PEAKS_BEST_PRACTICE_STDIN';
/** The literal a refusal artifact is built around — and so the text an `intent`
 *  must not be able to use to impersonate one. */
const REFUSAL_MARKER = 'SKIPPED — synthetic (stub) lookup';
const FRAGMENTS = [
  { title: 'Caching best practices', url: 'https://docs.example.com/cache', snippet: 'frag A' },
  { title: 'Cache invalidation', url: 'https://docs.example.com/cache-2', snippet: 'frag B' }
];

let projectRoot: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bps-refusal-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
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

/** `<project>/best-practice/skipped/<date>-<slug>.md` — the refusal path. */
function skipped(slug: string): string {
  return join(projectRoot, 'best-practice', 'skipped', `${date()}-${slug}.md`);
}

/** Every file under `best-practice/`, one level deep, refusal directory included. */
function allFiles(): readonly string[] {
  const base = join(projectRoot, 'best-practice');
  if (!existsSync(base)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile()) found.push(entry.name);
    else
      for (const nested of readdirSync(join(base, entry.name)))
        found.push(`${entry.name}/${nested}`);
  }
  return found.sort();
}

function writeResults(name: string, value: unknown): string {
  const path = join(projectRoot, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return path;
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

/** An injected run for `intent`, which should render and exit 0. */
function injected(intent: string, file: string): Promise<unknown> {
  withEnv(STDIN_SEAM, '');
  return runCli([
    '--intent',
    intent,
    '--project',
    projectRoot,
    '--lang',
    'typescript',
    '--lookup-results',
    file
  ]);
}

/** An uninjected run for `intent`, which should refuse. */
function uninjected(intent: string): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  return runCli(['--intent', intent, '--project', projectRoot, '--lang', 'typescript', '--json']);
}

function hitFile(intent: string, name: string): string {
  return writeResults(name, { intent, context7: { ok: true, results: FRAGMENTS } });
}

describe('behavior — a scan that found nothing refuses instead of recommending', () => {
  it('when every supplied seam reports ok:false, should refuse and write no artifact at all', async () => {
    // given: the honest encoding of a total miss — both lookups ran, neither found anything
    const bothMiss = writeResults('both-miss.json', {
      intent: INTENT,
      context7: { ok: false, results: [] },
      websearch: { ok: false, results: [] }
    });
    // stdin is pinned so that, if this ever stops refusing, the arm fails on the
    // artifact assertions below instead of hanging on a read that should not happen
    withEnv(STDIN_SEAM, '');

    // when: the command runs
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      bothMiss,
      '--json'
    ]);

    // then: no table, no ★, no catch gate, and NOTHING on disk — there is no scan to record
    const out = captured.text();
    expect(process.exitCode).toBe(1);
    expect(out).toContain('"code": "BEST_PRACTICE_SCAN_NO_FRAGMENTS"');
    // the same `command` identifier its sibling refusals report, so a consumer
    // keying on it does not miss the one refusal that says nothing was found
    expect(out).toContain('"command": "best-practice.scan"');
    // the refusal message names a ★ in prose; what must be absent is a *rendered* one
    expect(out).not.toContain('**方案');
    expect(out).not.toContain('| **LLM 推荐** |');
    expect(out).not.toContain('catch-gate outcome');
    expect(allFiles()).toEqual([]);
  });

  it('when a real hit is supplied alongside, should still render normally', async () => {
    // given: the same document shape, but one seam genuinely found something
    const mixed = writeResults('one-hit.json', {
      intent: INTENT,
      context7: { ok: false, results: [] },
      websearch: { ok: true, results: FRAGMENTS }
    });
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      mixed,
      '--json'
    ]);

    // then: the zero-fragment refusal must not swallow a scan that did find fragments
    expect(process.exitCode).toBe(0);
    expect(captured.text()).toContain('"scanSource": "websearch"');
    expect(readFileSync(primary('add-a-caching-layer'), 'utf8')).toContain('**方案 A ★**');
  });
});

describe('behavior — a refusal never overwrites anything at the primary path', () => {
  it('when the intent itself contains the refusal marker, should still not overwrite the recommendation', async () => {
    // given: an intent that is literally the refusal marker — its own heading
    // then contains that sentence, which is what defeated a content-substring guard
    const hostile = REFUSAL_MARKER;
    const slug = 'SKIPPED-synthetic-stub-lookup';
    const file = hitFile(hostile, 'hostile.json');
    await injected(hostile, file);
    const recommendation = readFileSync(primary(slug), 'utf8');
    expect(recommendation).toContain('**方案 A ★**');

    // when: the auto-triggered, uninjected scan lands on the same intent
    const captured = await uninjected(hostile);

    // then: the real recommendation is untouched and the refusal went beside it
    expect(process.exitCode).toBe(1);
    expect(readFileSync(primary(slug), 'utf8')).toBe(recommendation);
    expect(existsSync(skipped(slug))).toBe(true);
    expect(captured.text()).toContain(JSON.stringify(skipped(slug)));
  });

  it('when another intent ends in -synthetic, should not write into the path that intent owns', async () => {
    // given: a real recommendation for `foo-synthetic`, and a real one for `foo`
    const fooSyn = 'foo-synthetic';
    const foo = 'foo';
    await injected(fooSyn, hitFile(fooSyn, 'foo-syn.json'));
    await injected(foo, hitFile(foo, 'foo.json'));
    const fooSynArtifact = readFileSync(primary(fooSyn), 'utf8');
    const fooArtifact = readFileSync(primary(foo), 'utf8');

    // when: a refusal for `foo` runs while `foo`'s own path is occupied
    await uninjected(foo);

    // then: neither recommendation was touched, and the refusal is in its own namespace
    expect(readFileSync(primary(fooSyn), 'utf8')).toBe(fooSynArtifact);
    expect(readFileSync(primary(foo), 'utf8')).toBe(fooArtifact);
    expect(existsSync(skipped(foo))).toBe(true);
  });
});

describe('a11y — the validator refuses input that could crash the printer later', () => {
  it('when a fragment carries an unknown key, should refuse it by name', async () => {
    // given: a fragment with a key the contract does not define
    const file = writeResults('extra-key.json', {
      intent: INTENT,
      context7: {
        ok: true,
        results: [{ title: 't', url: 'https://d/a', snippet: 's', extra: 'x' }]
      }
    });
    // stdin pinned: if this ever stops refusing, fail on the assertions, not on a hang
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"');
    expect(captured.text()).toContain('no other keys');
    expect(allFiles()).toEqual([]);
  });

  it('when a fragment key is nested 20000 deep, should refuse before anything is written', async () => {
    // given: JSON text (not an object — building and re-serialising it would be
    // the crash we are testing for) whose fragment carries a 20000-deep key
    const depth = 20_000;
    const raw =
      `{"intent":${JSON.stringify(INTENT)},"context7":{"ok":true,"results":[` +
      `{"title":"t","url":"https://d/a","snippet":"s","extra":${'{"n":'.repeat(depth)}1${'}'.repeat(depth)}}]}}`;
    const file = writeResults('deep.json', raw);
    // stdin pinned: if this ever stops refusing, fail on the assertions, not on a hang
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then: refused as a validation failure, NOT a crash after the write
    const out = captured.text();
    expect(process.exitCode).toBe(1);
    expect(out).toContain('"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"');
    expect(out).not.toContain('BEST_PRACTICE_SCAN_FAILED');
    expect(out).not.toContain('Maximum call stack size exceeded');
    expect(out).not.toContain('"stack"');
    expect(allFiles()).toEqual([]);
  });

  it('when a fragment field is whitespace only, should refuse it', async () => {
    // given: three "non-empty" strings that render as blank cells
    const file = writeResults('blank.json', {
      intent: INTENT,
      context7: { ok: true, results: [{ title: '  ', url: '\t', snippet: '\n' }] }
    });
    // stdin pinned: if this ever stops refusing, fail on the assertions, not on a hang
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"');
    expect(allFiles()).toEqual([]);
  });

  it('when the file overflows the size cap, should refuse without reading it into the envelope', async () => {
    // given: a file just over the 1 MiB cap
    const file = writeResults(
      'huge.json',
      `{"intent":${JSON.stringify(INTENT)},"padding":"${'x'.repeat(1_100_000)}"`
    );

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"');
    expect(captured.text()).toContain('over the 1048576-byte cap');
    expect(allFiles()).toEqual([]);
  });

  it('when a seam carries more fragments than the cap, should refuse it', async () => {
    // given: 65 fragments where the cap is 64 — a scan cites a handful, not a corpus
    const many = Array.from({ length: 65 }, (_, i) => ({
      title: `t${i}`,
      url: `https://d/${i}`,
      snippet: `s${i}`
    }));
    const file = writeResults('many.json', {
      intent: INTENT,
      context7: { ok: true, results: many }
    });
    // stdin pinned: if the cap ever stops refusing, fail on the assertions, not on a hang
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"');
    expect(captured.text()).toContain('over the cap of 64');
    expect(allFiles()).toEqual([]);
  });
});

describe('render — input that is legal on this host is not refused for its bytes', () => {
  it('when the file carries a UTF-8 BOM, should accept it', async () => {
    // given: a BOM-prefixed document, which is what several Windows editors and
    // PowerShell redirection write
    const file = writeResults(
      'bom.json',
      `${String.fromCharCode(0xfeff)}${JSON.stringify({ intent: INTENT, context7: { ok: true, results: FRAGMENTS } })}`
    );
    withEnv(STDIN_SEAM, '');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      file,
      '--json'
    ]);

    // then: accepted, rendered, exited 0
    expect(process.exitCode).toBe(0);
    expect(captured.text()).toContain('"scanSource": "context7"');
    expect(readFileSync(primary('add-a-caching-layer'), 'utf8')).toContain('**方案 A ★**');
  });

  it('when the file is not valid JSON, should not echo any of its bytes back', async () => {
    // given: a file whose first bytes are distinctive and match no secret
    // pattern, so a leak cannot hide behind `fail()`'s keyword redaction
    const file = writeResults('notjson.txt', 'zzq7Xk2P9m--not-json-at-all');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      file,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('is not valid JSON');
    expect(captured.text()).not.toContain('zzq7Xk2P9m');
    expect(captured.text()).not.toContain('not-json-at-all');
    expect(allFiles()).toEqual([]);
  });

  it('when the artifact is rendered, should attribute the fragments to the caller', async () => {
    // given: an injected scan whose fragments the caller — not Context7 — produced
    const file = hitFile(INTENT, 'attrib.json');
    withEnv(STDIN_SEAM, '');

    // when
    await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      file
    ]);

    // then: the artifact says where the fragments came from, so a reader can tell
    // the citation is model-authored rather than retrieved
    const written = readFileSync(primary('add-a-caching-layer'), 'utf8');
    expect(written).toContain('调用方提供');
    expect(written).toContain('URL 由调用方构造');
  });
});
