// tests/unit/cli/commands/summary-flag.test.ts
//
// Slice 2026-09-10-context-audit-and-discipline (Slice B, part 1) — the
// `--summary` flag on the commands that can emit huge arrays.
//
// Contract asserted here (end-to-end through the Commander wiring):
//   (a) `--summary` bounds the envelope to ≤ 2 KB and marks it
//       `view: 'summary'`;
//   (b) WITHOUT the flag the default `--json` shape is byte-identical to
//       before — arrays stay arrays (back-compat, the flag is opt-in);
//   (c) no information is removed: the scalar counts in the summary equal the
//       true totals of the full envelope.
//
// Run with:
//   ./node_modules/.bin/vitest run tests/unit/cli/commands/summary-flag.test.ts

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { runMemoryList, runMemoryReindex } from '~/src/cli/commands/memory-commands';
import { registerMemoryCommand } from '~/src/cli/commands/core/memory-command';
import { SUMMARY_MAX_BYTES } from '~/src/services/context/summary-view';

declareDimensions(
  'tests/unit/cli/commands/summary-flag.test.ts',
  ['render', 'behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'the JSON envelope is the whole surface; no human-readable rendering is added' },
  ],
);

const getWs = withTmpWorkspacePerTest('peaks-summary-');

/** Write `n` memory files with NO resolvable kind → all land in `unclassified`. */
function seedUnclassified(wsPath: string, n: number): void {
  const memoryDir = `${wsPath}/.peaks/memory`;
  mkdirSync(memoryDir, { recursive: true });
  for (let i = 0; i < n; i++) {
    writeFileSync(`${memoryDir}/stray-${i}.md`, `# stray ${i}\n\nNo frontmatter, no kind.\n`, 'utf8');
  }
}

/**
 * Invoke the exported run function directly — the summary/default-shape logic
 * lives there, and the dynamic `import()` inside the Commander action would
 * otherwise race the assertion. One CLI-wiring test below proves the flag
 * reaches the run function.
 */
async function runReindex(wsPath: string, summary: boolean): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const { io, captured } = makeCapturedIo();
  await runMemoryReindex(io, summary ? { project: wsPath, json: true, summary: true } : { project: wsPath, json: true });
  return JSON.parse(captured.text().trim()) as { ok: boolean; data: Record<string, unknown> };
}

async function runList(wsPath: string, summary: boolean): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const { io, captured } = makeCapturedIo();
  await runMemoryList(io, summary ? { project: wsPath, json: true, summary: true } : { project: wsPath, json: true });
  return JSON.parse(captured.text().trim()) as { ok: boolean; data: Record<string, unknown> };
}

/** Size AS PRINTED — the CLI serializes with `null, 2`. */
const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value, null, 2) ?? '', 'utf8');

describe('render — memory reindex --summary is bounded and additive', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('when --summary is passed, should stay ≤ 2 KB and report true counts', async () => {
    // given: 80 unclassified memory files
    const ws = getWs();
    seedUnclassified(ws.path, 80);

    // when: reindex runs with --summary
    const envelope = await runReindex(ws.path, true);

    // then: the PRINTED envelope (data + wrapper) is bounded, marked, and the
    // counts match the real totals
    expect(envelope.ok).toBe(true);
    expect(bytes(envelope)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(envelope.data.view).toBe('summary');
    expect(envelope.data.scannedFiles).toBe(80);
    expect((envelope.data.unclassified as { count: number }).count).toBe(80);
    expect((envelope.data.unclassified as { names: string[] }).names.length).toBeGreaterThan(0);
  });

  it('when --summary is omitted, should keep the default shape (unclassified is an array)', async () => {
    // given: the same workspace
    const ws = getWs();
    seedUnclassified(ws.path, 80);

    // when: reindex runs WITHOUT --summary
    const envelope = await runReindex(ws.path, false);

    // then: byte-for-byte the legacy shape — array, no `view` marker
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.data.unclassified)).toBe(true);
    expect((envelope.data.unclassified as unknown[]).length).toBe(80);
    expect(envelope.data.view).toBeUndefined();
  });

  it('when --summary is passed, should still surface the same scalar drift totals', async () => {
    // given: a workspace with 40 unclassified files
    const ws = getWs();
    seedUnclassified(ws.path, 40);

    // when: both views are produced
    const full = await runReindex(ws.path, false);
    const summary = await runReindex(ws.path, true);

    // then: no scalar is lost in the bounded view
    expect(summary.data.scannedFiles).toBe(full.data.scannedFiles);
    expect(summary.data.indexed).toBe(full.data.indexed);
    expect(summary.data.indexPath).toBe(full.data.indexPath);
    expect((summary.data.unclassified as { count: number }).count)
      .toBe((full.data.unclassified as unknown[]).length);
  });
});

describe('integration — the CLI flag reaches the run function', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('when --summary is passed on the CLI, should emit the bounded view', async () => {
    // given: a workspace with a handful of unclassified files
    const ws = getWs();
    seedUnclassified(ws.path, 5);

    // when: the Commander action runs (its dynamic import resolves async)
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerMemoryCommand(program, io);
    await program.parseAsync(
      ['memory', 'reindex', '--summary', '--project', ws.path, '--json'],
      { from: 'user' }
    );
    for (let i = 0; i < 200 && captured.text().trim().length === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // then: the flag reached runMemoryReindex and produced the summary view
    const envelope = JSON.parse(captured.text().trim()) as { ok: boolean; data: Record<string, unknown> };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.view).toBe('summary');
  });
});

describe('render — memory list --summary is bounded and additive', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });
  afterEach(() => {
    process.exitCode = undefined;
  });

  it('when --summary is passed, should bound entries but keep the total', async () => {
    // given: a workspace whose index was rebuilt from 30 classified memories
    const ws = getWs();
    const memoryDir = `${ws.path}/.peaks/memory`;
    mkdirSync(memoryDir, { recursive: true });
    for (let i = 0; i < 30; i++) {
      writeFileSync(
        `${memoryDir}/rule-${i}.md`,
        `---\nname: rule-${i}\ndescription: rule ${i}\nmetadata:\n  type: rule\n---\n\nBody ${i}\n`,
        'utf8'
      );
    }
    const applyIo = makeCapturedIo();
    await runMemoryReindex(applyIo.io, { project: ws.path, json: true, apply: true });

    // when: list runs with and without --summary
    const full = await runList(ws.path, false);
    const summary = await runList(ws.path, true);

    // then: default keeps the entries array; the summary bounds it
    expect(Array.isArray(full.data.entries)).toBe(true);
    expect((full.data.entries as unknown[]).length).toBe(30);
    expect(summary.data.view).toBe('summary');
    expect(bytes(summary)).toBeLessThanOrEqual(SUMMARY_MAX_BYTES);
    expect(summary.data.total).toBe(30);
    expect((summary.data.entries as { count: number }).count).toBe(30);
  });
});
