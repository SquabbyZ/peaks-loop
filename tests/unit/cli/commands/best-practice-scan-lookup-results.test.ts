// tests/unit/cli/commands/best-practice-scan-lookup-results.test.ts
//
// The `--lookup-results <file>` injection surface, driven through the REAL
// command and the REAL orchestrator (no orchestrator mock): the whole point of
// the slice is that a caller-supplied lookup reaches the render path with
// `synthetic: false`, and a mocked orchestrator would hide exactly that.
//
// Dimensions covered:
//   - render:      the 8-row table rendered from injected fragments
//   - behavior:    the file validator's refusals + the refusal write guard
//   - a11y:        exit codes and the refusal codes on the envelope
//   - integration: what lands on disk (written table / untouched table)

import { Command } from 'commander';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { registerBestPracticeScanCommand } from '../../../../src/cli/commands/best-practice-scan-command.js';

declareDimensions('tests/unit/cli/commands/best-practice-scan-lookup-results.test.ts', [
  'render',
  'behavior',
  'a11y',
  'integration'
]);

const INTENT = 'add a caching layer';
const STDIN_SEAM = 'PEAKS_BEST_PRACTICE_STDIN';
const INVALID_RESULTS = '"code": "BEST_PRACTICE_SCAN_INVALID_RESULTS"';

const CONTEXT7_FRAGMENTS = [
  {
    title: 'Caching best practices',
    url: 'https://docs.example.com/cache',
    snippet: 'real fragment A'
  },
  {
    title: 'Cache invalidation',
    url: 'https://docs.example.com/cache-2',
    snippet: 'real fragment B'
  }
];

const WEBSEARCH_FRAGMENTS = [
  { title: 'Web case alpha', url: 'https://search.example.org/a', snippet: 'web fragment A' },
  { title: 'Web case beta', url: 'https://search.example.org/b', snippet: 'web fragment B' }
];

let projectRoot: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'bps-lookup-'));
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

function writeResultsFile(name: string, value: unknown): string {
  const path = join(projectRoot, name);
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  return path;
}

function artifactPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(projectRoot, 'best-practice', `${date}-add-a-caching-layer.md`);
}

/** Where a refusal goes when the primary path is already occupied. */
function skippedPath(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(projectRoot, 'best-practice', 'skipped', `${date}-add-a-caching-layer.md`);
}

/** Every file under every artifact directory, primary and refusal alike. */
function allArtifacts(): readonly string[] {
  const base = join(projectRoot, 'best-practice');
  if (!existsSync(base)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (entry.isFile()) found.push(entry.name);
    else if (entry.isDirectory()) {
      for (const nested of readdirSync(join(base, entry.name)))
        found.push(`${entry.name}/${nested}`);
    }
  }
  return found.sort();
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

function validContext7File(name = 'results.json'): string {
  return writeResultsFile(name, {
    intent: INTENT,
    context7: { ok: true, results: CONTEXT7_FRAGMENTS }
  });
}

describe('render — an injected real lookup renders the full recommendation', () => {
  it('when --lookup-results carries real context7 fragments, should render the table and exit 0', async () => {
    // given: the LLM fetched two real fragments and wrote them to a file
    const resultsPath = validContext7File();
    withEnv(STDIN_SEAM, '');

    // when: the command runs with the injection
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then: the real table, the recommendation, the gate and no synthetic refusal
    const out = captured.text();
    expect(process.exitCode).toBe(0);
    expect(out).toContain('# Best-Practice Scan — add a caching layer');
    expect(out).toContain('**方案 A ★**');
    expect(out).toContain('| **LLM 推荐** |');
    expect(out).toContain('fragments: 2');
    expect(out).toContain('⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。');
    expect(out).toContain('"scanSource": "context7"');
    expect(out).not.toContain('BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP');
  });

  it('when context7 misses and a real websearch backs it, should render from the websearch fragments', async () => {
    // given: a Context7 miss plus real priority-2 results
    const resultsPath = writeResultsFile('fallback.json', {
      intent: INTENT,
      context7: { ok: false, results: [] },
      websearch: { ok: true, results: WEBSEARCH_FRAGMENTS }
    });
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
      resultsPath,
      '--json'
    ]);

    // then: the table is built from the injected websearch fragments — nothing fabricated
    const out = captured.text();
    expect(process.exitCode).toBe(0);
    expect(out).toContain('"scanSource": "websearch"');
    expect(out).toContain('Web case alpha');
    expect(out).not.toContain('(context7 stub)');
    expect(out).not.toContain('(websearch stub)');
    // the artifact carries the source + the injected fragment count, so the
    // table on disk is attributable to the caller's results and not to a stub
    // (the websearch stub returns exactly one fragment, this file supplies two)
    const written = readFileSync(artifactPath(), 'utf8');
    expect(written).toContain('2 个 websearch 文档片段');
    expect(written).not.toContain('(websearch stub)');
  });
});

describe('behavior — the results file is validated before any scan runs', () => {
  it('when the file does not exist, should refuse without scanning', async () => {
    // given: a path with nothing at it
    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      join(projectRoot, 'absent.json'),
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(allArtifacts()).toEqual([]);
  });

  it('when the file is not valid JSON, should refuse without scanning', async () => {
    // given: a file that is not JSON at all
    const resultsPath = writeResultsFile('broken.json', '{ not json');

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(allArtifacts()).toEqual([]);
  });

  it('when the declared intent differs from --intent, should name both strings', async () => {
    // given: a file fetched for a different goal
    const resultsPath = writeResultsFile('wrong-goal.json', {
      intent: 'shard the database',
      context7: { ok: true, results: CONTEXT7_FRAGMENTS }
    });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then: a real-looking table for the wrong question is refused, and both intents are named
    const out = captured.text();
    expect(process.exitCode).toBe(1);
    expect(out).toContain(INVALID_RESULTS);
    expect(out).toContain('shard the database');
    expect(out).toContain(INTENT);
    expect(allArtifacts()).toEqual([]);
  });

  it('when the file carries an unknown top-level key, should name the key', async () => {
    // given: a typo'd seam key
    const resultsPath = writeResultsFile('unknown-key.json', {
      intent: INTENT,
      context7Lookup: { ok: true, results: CONTEXT7_FRAGMENTS }
    });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(captured.text()).toContain('context7Lookup');
    expect(allArtifacts()).toEqual([]);
  });

  it('when a seam declares ok: true with no results, should refuse without scanning', async () => {
    // given: a claimed hit that carries nothing — the shape of a Context7 miss
    const resultsPath = writeResultsFile('empty-hit.json', {
      intent: INTENT,
      context7: { ok: true, results: [] }
    });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then: nothing reaches the render path claiming to be a real scan
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(captured.text()).not.toContain('★');
    expect(allArtifacts()).toEqual([]);
  });

  it('when the file carries no lookup key at all, should refuse without scanning', async () => {
    // given: an intent and nothing else
    const resultsPath = writeResultsFile('no-seam.json', { intent: INTENT });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(allArtifacts()).toEqual([]);
  });

  it('when a fragment is malformed, should name the offending index', async () => {
    // given: fragment 1 has an empty url
    const resultsPath = writeResultsFile('bad-fragment.json', {
      intent: INTENT,
      context7: {
        ok: true,
        results: [CONTEXT7_FRAGMENTS[0], { title: 'x', url: '', snippet: 'y' }]
      }
    });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain(INVALID_RESULTS);
    expect(captured.text()).toContain('results[1]');
    expect(allArtifacts()).toEqual([]);
  });
});

describe('a11y — the honest no-injection path is unchanged', () => {
  it('when no --lookup-results is given, should still refuse with the synthetic code', async () => {
    // given: the built-in stubs answer (no injection of any kind)
    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--json'
    ]);

    // then: today's refusal, unchanged
    const out = captured.text();
    expect(process.exitCode).toBe(1);
    expect(out).toContain('"code": "BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP"');
    expect(out).toContain('"synthetic": true');
    expect(out).toContain('"step25": "skipped-synthetic-lookup"');
    expect(out).not.toContain('★');
    expect(readFileSync(artifactPath(), 'utf8')).toContain('SKIPPED — synthetic (stub) lookup');
  });

  it('when context7 misses and no real websearch backs it, should refuse rather than fabricate', async () => {
    // given: a real Context7 miss with nothing behind it
    const resultsPath = writeResultsFile('miss.json', {
      intent: INTENT,
      context7: { ok: false, results: [] }
    });

    // when
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      resultsPath,
      '--json'
    ]);

    // then: the stub fallback is reached, flagged synthetic, and refused
    expect(process.exitCode).toBe(1);
    expect(captured.text()).toContain('"code": "BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP"');
    expect(captured.text()).toContain('"synthetic": true');
    const written = readFileSync(artifactPath(), 'utf8');
    expect(written).toContain('SKIPPED — synthetic (stub) lookup');
    expect(written).not.toContain('(websearch stub)');
    expect(captured.text()).not.toContain('(websearch stub)');
  });
});

describe('integration — what reaches disk', () => {
  it('when an injected scan renders, should write the table to the (date, intent) artifact', async () => {
    // given
    const resultsPath = validContext7File();
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
      resultsPath
    ]);

    // then
    expect(process.exitCode).toBe(0);
    expect(readFileSync(artifactPath(), 'utf8')).toContain('**方案 A ★**');
  });

  it('when a later uninjected scan refuses, should leave the real recommendation byte-identical', async () => {
    // given: a real recommendation already written to the shared (date, intent) path
    const resultsPath = validContext7File();
    withEnv(STDIN_SEAM, '');
    await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      resultsPath
    ]);
    const recommendation = readFileSync(artifactPath(), 'utf8');
    expect(recommendation).toContain('**方案 A ★**');

    // when: the auto-triggered (uninjected) scan lands on the same intent
    const captured = await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--json'
    ]);

    // then: the refusal goes beside it, and names where it went
    expect(process.exitCode).toBe(1);
    expect(readFileSync(artifactPath(), 'utf8')).toBe(recommendation);
    const refusalPath = skippedPath();
    expect(existsSync(refusalPath)).toBe(true);
    expect(readFileSync(refusalPath, 'utf8')).toContain('SKIPPED — synthetic (stub) lookup');
    expect(captured.text()).toContain(JSON.stringify(refusalPath));
  });

  it('when a refusal is asked to land on a path that holds anything, should never overwrite it', async () => {
    // given: ANY file at the primary path — here a real recommendation, but the
    // rule no longer asks which; it asks whether something is there.
    const resultsPath = validContext7File();
    withEnv(STDIN_SEAM, '');
    await runCli([
      '--intent',
      INTENT,
      '--project',
      projectRoot,
      '--lang',
      'typescript',
      '--lookup-results',
      resultsPath
    ]);
    const recommendation = readFileSync(artifactPath(), 'utf8');

    // when: two more refusals land on the same intent
    await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript', '--json']);
    await runCli(['--intent', INTENT, '--project', projectRoot, '--lang', 'typescript', '--json']);

    // then: the recommendation survived both, and every refusal is beside it
    expect(readFileSync(artifactPath(), 'utf8')).toBe(recommendation);
    expect(readFileSync(skippedPath(), 'utf8')).toContain('SKIPPED — synthetic (stub) lookup');
  });
});
