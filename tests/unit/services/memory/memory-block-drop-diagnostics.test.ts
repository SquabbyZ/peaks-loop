// tests/unit/services/memory/memory-block-drop-diagnostics.test.ts
//
// M2 — a found-but-not-extracted `<!-- peaks-memory:start -->` block must say
// why it was dropped.
//
// Before this, `parseBlock` collapsed five distinct preconditions into a bare
// `null`, and `extractStableProjectMemories` skipped the block without a word.
// `peaks memory extract --dry-run` on three blocks (one valid, two malformed
// in different ways) therefore reported `extractedCount: 1` with
// `warnings: []`: the two dropped blocks vanished silently, and
// `extractedCount: 0` was indistinguishable from "there were no blocks".
//
// The change is DIAGNOSTIC ONLY. Which blocks are accepted did not move, and
// widening acceptance (e.g. accepting `name:`/`description:` as aliases for
// `title:`) is a product decision that is explicitly NOT taken here. The
// behavioural pins below are the guard on that claim: they are the counts
// measured on the pre-change code, kept as literals.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/memory-block-drop-diagnostics.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  describeMemoryBlockDrops,
  END_MARKER,
  executeProjectMemoryExtract,
  extractSessionMemories,
  extractStableProjectMemories,
  extractStableProjectMemoriesWithDiagnostics,
  parseBlock,
  parseBlockResult,
  PROJECT_MEMORY_KINDS,
  START_MARKER
} from '~/src/services/memory/project-memory-service/index';

const START = '<!-- peaks-memory:start -->';
const END = '<!-- peaks-memory:end -->';

function block(inner: string): string {
  return `${START}\n${inner}\n${END}`;
}

/**
 * One entry per precondition `parseBlockResult` can fail on, plus the two
 * shapes that are accepted. `accepted` is the pre-change behaviour of
 * `parseBlock` — the whole point is that it did not move.
 */
const BLOCKS: ReadonlyArray<{ name: string; raw: string; accepted: boolean; reason?: string }> = [
  { name: 'valid', raw: 'title: A\nkind: lesson\n---\nBody.', accepted: true },
  { name: 'valid-crlf', raw: 'title: A\r\nkind: lesson\r\n---\r\nBody.', accepted: true },
  { name: 'missing-separator', raw: 'title: A\nkind: lesson\nBody.', accepted: false, reason: 'missing-separator' },
  { name: 'missing-title', raw: 'kind: lesson\n---\nBody.', accepted: false, reason: 'missing-title' },
  { name: 'empty-title-value', raw: 'title:\nkind: lesson\n---\nBody.', accepted: false, reason: 'missing-title' },
  { name: 'missing-kind', raw: 'title: A\n---\nBody.', accepted: false, reason: 'missing-kind' },
  { name: 'empty-kind-value', raw: 'title: A\nkind:\n---\nBody.', accepted: false, reason: 'missing-kind' },
  { name: 'unknown-kind', raw: 'title: A\nkind: note\n---\nBody.', accepted: false, reason: 'unknown-kind' },
  { name: 'wrong-case-kind', raw: 'title: A\nkind: Lesson\n---\nBody.', accepted: false, reason: 'unknown-kind' },
  { name: 'empty-body', raw: 'title: A\nkind: lesson\n---\n   ', accepted: false, reason: 'empty-body' },
  // The standard STORED convention (`name:`/`description:`/`metadata.type`) is
  // still rejected on the extract path. NOT relaxed here — that is the user's
  // product call.
  {
    name: 'name-description-convention',
    raw: 'name: a\ndescription: A\nmetadata:\n  type: lesson\n---\nBody.',
    accepted: false,
    reason: 'missing-title'
  }
];

describe('parseBlockResult names the failing precondition', () => {
  it('accepts exactly what parseBlock accepts, and returns the same memory', () => {
    for (const { name, raw, accepted } of BLOCKS) {
      const parsed = parseBlockResult(raw, 'probe/artifact.md');
      const legacy = parseBlock(raw, 'probe/artifact.md');
      expect(parsed.ok, `${name}: parseBlockResult.ok must track parseBlock !== null`).toBe(legacy !== null);
      expect(parsed.ok, `${name}: expectation table must match the implementation`).toBe(accepted);
      if (parsed.ok && legacy !== null) {
        // Byte-identical memory object, not merely "both accepted".
        expect(parsed.memory, name).toEqual(legacy);
      }
    }
  });

  it('reports the specific reason each malformed block was dropped', () => {
    for (const { name, raw, accepted, reason } of BLOCKS) {
      const parsed = parseBlockResult(raw, 'probe/artifact.md');
      if (accepted) {
        expect(parsed.ok, name).toBe(true);
        continue;
      }
      expect(parsed.ok, name).toBe(false);
      if (!parsed.ok) {
        expect(parsed.reason, name).toBe(reason);
        expect(parsed.detail.length, `${name}: a reason must carry an explanation`).toBeGreaterThan(0);
      }
    }
  });

  it('never rejects a canonical kind (the vocabulary the parser accepts is the tuple)', () => {
    for (const kind of PROJECT_MEMORY_KINDS) {
      const parsed = parseBlockResult(`title: T\nkind: ${kind}\n---\nBody.`, 'probe/artifact.md');
      expect(parsed.ok, `${kind} must be accepted`).toBe(true);
    }
  });
});

describe('extractStableProjectMemories reports the blocks it drops', () => {
  const DOCS: ReadonlyArray<{ name: string; content: string; extractedCount: number; droppedCount: number }> = [
    { name: 'one-valid', content: `${block('title: A\nkind: lesson\n---\nBody A.')}\n`, extractedCount: 1, droppedCount: 0 },
    {
      name: 'valid-plus-bare-marker',
      content: `${block('title: A\nkind: lesson\n---\nBody A.')}\n${START}\n${END}\n`,
      extractedCount: 1,
      droppedCount: 1
    },
    {
      name: 'three-blocks-orchestrator-repro',
      content: `${block('title: A\nkind: lesson\n---\nBody A.')}\n${block('name: b\ndescription: B\nmetadata:\n  type: lesson\n---\nBody B.')}\n${START}\n${END}\n`,
      extractedCount: 1,
      droppedCount: 2
    },
    { name: 'no-blocks', content: 'prose only, no markers\n', extractedCount: 0, droppedCount: 0 },
    { name: 'unterminated-start', content: `${START}\ntitle: A\nkind: lesson\n---\nBody A.\n`, extractedCount: 0, droppedCount: 0 }
  ];

  it('keeps the pre-change extraction counts (behaviour is unchanged)', () => {
    for (const { name, content, extractedCount } of DOCS) {
      const withDiagnostics = extractStableProjectMemoriesWithDiagnostics(content, `probe/${name}.md`);
      expect(withDiagnostics.memories.length, `${name}: extracted count must equal the pre-change count`).toBe(extractedCount);
      // The legacy projection must agree with the diagnostic one, by construction.
      expect(extractStableProjectMemories(content, `probe/${name}.md`), name).toEqual(withDiagnostics.memories);
    }
  });

  it('counts every found-but-rejected block, with its reason', () => {
    for (const { name, content, droppedCount } of DOCS) {
      const { dropped } = extractStableProjectMemoriesWithDiagnostics(content, `probe/${name}.md`);
      expect(dropped.length, name).toBe(droppedCount);
      for (const drop of dropped) {
        expect(drop.sourceArtifact, name).toBe(`probe/${name}.md`);
        expect(drop.detail.length, name).toBeGreaterThan(0);
      }
    }
  });

  it('the three-block repro no longer vanishes silently', () => {
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(
      DOCS[2]!.content,
      'sc/memexp/handoff.md'
    );
    expect(memories).toHaveLength(1);
    expect(dropped.map((drop) => drop.reason)).toEqual(['missing-title', 'missing-separator']);

    const warnings = describeMemoryBlockDrops(dropped);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('sc/memexp/handoff.md');
    expect(warnings[0]).toContain("no non-empty 'title:' field");
    expect(warnings[1]).toContain("'---' separator");
  });

  it('names the accepted vocabulary on an unknown kind', () => {
    const { dropped } = extractStableProjectMemoriesWithDiagnostics(
      block('title: A\nkind: note\n---\nBody A.'),
      'probe/unknown.md'
    );
    expect(dropped.map((drop) => drop.reason)).toEqual(['unknown-kind']);
    const [warning] = describeMemoryBlockDrops(dropped);
    expect(warning).toContain("kind 'note'");
    for (const kind of PROJECT_MEMORY_KINDS) {
      expect(warning, `the remedy must name every accepted kind (${kind})`).toContain(kind);
    }
  });
});

describe('peaks memory extract surfaces the drops through the plan', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-m2-drops-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('carries the dropped blocks on a dry-run plan, without changing the plan', () => {
    const artifactPath = join(root, 'handoff.md');
    writeFileSync(
      artifactPath,
      [
        block('title: A\nkind: lesson\n---\nBody A.'),
        block('name: b\ndescription: B\nmetadata:\n  type: lesson\n---\nBody B.'),
        `${START}\n${END}`
      ].join('\n'),
      'utf8'
    );

    const plan = executeProjectMemoryExtract({ projectRoot: root, artifactPaths: [artifactPath], apply: false });

    // Pre-change observables, unchanged.
    expect(plan.apply).toBe(false);
    expect(plan.extractedMemories).toHaveLength(1);
    expect(plan.plannedWrites).toHaveLength(1);
    expect(plan.writtenFiles).toHaveLength(0);

    // New: the two dropped blocks explain themselves.
    expect(plan.droppedBlocks).toHaveLength(2);
    expect(describeMemoryBlockDrops(plan.droppedBlocks)).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// B2 — the SESSION extraction path (`peaks project memories:extract`)
//
// M2 gave the artifact path a diagnostics channel. `extractSessionMemories`
// was left calling the diagnostic-free projection and had no `droppedBlocks`
// field at all, so a session handoff whose blocks were all malformed returned
// `extractedCount: 0` with `warnings: []` — the same defect, one function over.
//
// The change is DIAGNOSTIC ONLY, proven the same way M2 proved its own: the
// behavioural pins below are the counts measured on the PRE-CHANGE code, kept
// as literals. If any of them moves, the change stopped being non-semantic.
// ---------------------------------------------------------------------------

/** The session artifact used by the B2 cases: two malformed blocks, one valid. */
const SESSION_HANDOFF = [
  block('title: Probe valid memory\nkind: lesson\n---\nA stable fact.'),
  '<!-- peaks-memory:start -->\nno title, no separator\n<!-- peaks-memory:end -->',
  block('kind: lesson\n---\nno title field'),
  // Attribute-shaped marker: not a marker at all to the literal scan, so it is
  // invisible — no memory, and (see the B1 guard) no warning either.
  '<!-- peaks-memory:start kind=lesson -->\n\ninvisible\n\n<!-- peaks-memory:end -->',
  ''
].join('\n');

describe('extractSessionMemories reports the blocks it drops', () => {
  let root: string;
  const sessionId = '2026-09-17-session-b2';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-b2-drops-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
    mkdirSync(join(root, '.peaks', '_runtime', sessionId, 'txt'), { recursive: true });
    writeFileSync(join(root, '.peaks', '_runtime', sessionId, 'txt', 'handoff.md'), SESSION_HANDOFF, 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps the pre-change extraction counts (behaviour is unchanged)', () => {
    // EXTRACTION observables — the pre-change literals. None of these may move.
    const dryRun = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(dryRun.scannedFiles).toBe(1);
    expect(dryRun.extractedCount).toBe(1);
    expect(dryRun.writtenFiles).toEqual([]);
    expect(dryRun.updatedIndex).toBe(false);

    const applied = extractSessionMemories({ projectRoot: root, sessionId, apply: true });
    expect(applied.scannedFiles).toBe(1);
    expect(applied.extractedCount).toBe(1);
    expect(applied.writtenFiles).toHaveLength(1);
    expect(applied.updatedIndex).toBe(true);

    // Idempotency is untouched: the re-run writes nothing, still extracts 1.
    const again = extractSessionMemories({ projectRoot: root, sessionId, apply: true });
    expect(again.extractedCount).toBe(1);
    expect(again.writtenFiles).toEqual([]);
    expect(again.updatedIndex).toBe(false);
  });

  it('names the reason each session block was dropped, through the warnings channel', () => {
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: false });

    expect(result.droppedBlocks.map((drop) => drop.reason)).toEqual([
      'missing-separator',
      'missing-title',
      // N1: the attribute-shaped marker is now NAMED rather than invisible.
      // Reporting it extracts nothing new — see the extraction pin above.
      'unrecognized-marker'
    ]);
    for (const drop of result.droppedBlocks) {
      expect(drop.sourceArtifact).toBe(`.peaks/_runtime/${sessionId}/txt/handoff.md`);
      expect(drop.detail.length).toBeGreaterThan(0);
    }

    const warnings = describeMemoryBlockDrops(result.droppedBlocks);
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain(`.peaks/_runtime/${sessionId}/txt/handoff.md`);
    expect(warnings[0]).toContain("'---' separator");
    expect(warnings[1]).toContain("no non-empty 'title:' field");
  });

  it('reports no drops for a clean session (the channel is not always-on noise)', () => {
    writeFileSync(
      join(root, '.peaks', '_runtime', sessionId, 'txt', 'handoff.md'),
      block('title: A\nkind: lesson\n---\nBody A.'),
      'utf8'
    );
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(result.extractedCount).toBe(1);
    expect(result.droppedBlocks).toEqual([]);
    expect(describeMemoryBlockDrops(result.droppedBlocks)).toEqual([]);
    expect(result.scanFailures).toEqual([]);
  });

  it('reports an empty drop list when the session directory does not exist', () => {
    const result = extractSessionMemories({ projectRoot: root, sessionId: 'no-such-session', apply: false });
    expect(result.scannedFiles).toBe(0);
    expect(result.extractedCount).toBe(0);
    expect(result.droppedBlocks).toEqual([]);
    expect(result.scanFailures).toEqual([]);
  });

  it('wires the drops into the CLI envelope warnings channel', () => {
    // The service returning the array is not enough — the command must hand it
    // to `ok(...)` as the warnings argument, the way `memory.extract` does.
    // Static, because firing the real CLI here would need a built dist.
    const command = readFileSync(resolve(__dirname, '..', '..', '..', '..', 'src', 'cli', 'commands', 'project-commands.ts'), 'utf8');
    expect(command, 'project memories:extract must surface its drops').toContain(
      'describeMemoryBlockDrops(result.droppedBlocks)'
    );
  });
});

// ---------------------------------------------------------------------------
// N1 — a NEAR-MISS marker was totally silent
//
// M2's diagnostics only fire for blocks that were LOCATED and then malformed.
// `extractStableProjectMemoriesWithDiagnostics` navigates by exact `indexOf`, so
// a marker carrying unexpected content before its `-->` is never located and
// nothing was reported. That is the failure the stale doc induced: the caller
// could not distinguish "this artifact has no memory blocks" from "this artifact
// has blocks I could not find".
//
// DIAGNOSTIC ONLY. The locator is NOT loosened: whether to ACCEPT
// attribute-shaped markers is a product decision the user deferred, and
// extracting something previously ignored would change every downstream
// project's output. Nothing below extracts anything new.
// ---------------------------------------------------------------------------

describe('extractStableProjectMemories names marker-shaped comments it cannot use', () => {
  // `extracted` is the PRE-N1 count for each document — a near-miss contributes
  // no memory, so these numbers are the promise that nothing new is extracted.
  // `wants` is the literal the warning must quote back at the reader.
  const NEAR_MISSES: ReadonlyArray<{
    name: string;
    content: string;
    extracted: number;
    wants: string;
  }> = [
    {
      name: 'attribute-in-start',
      content: `${block('title: A\nkind: lesson\n---\nBody A.')}\n<!-- peaks-memory:start kind=lesson -->\nBody.\n${END}\n`,
      extracted: 1,
      wants: START_MARKER
    },
    {
      name: 'attribute-in-end',
      content: `${START}\ntitle: A\nkind: lesson\n---\nBody A.\n<!-- peaks-memory:end kind=lesson -->\n`,
      extracted: 0,
      wants: END_MARKER
    },
    {
      name: 'no-spaces',
      content: `<!--peaks-memory:start-->\ntitle: A\nkind: lesson\n---\nBody A.\n${END}\n`,
      extracted: 0,
      wants: START_MARKER
    },
    {
      name: 'extra-space',
      content: `<!--  peaks-memory:start -->\ntitle: A\nkind: lesson\n---\nBody A.\n${END}\n`,
      extracted: 0,
      wants: START_MARKER
    }
  ];

  it('reports every near-miss, naming the text found and the literal wanted', () => {
    for (const { name, content, extracted, wants } of NEAR_MISSES) {
      const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(content, `probe/${name}.md`);

      expect(memories.length, `${name}: a near-miss marker must still extract nothing`).toBe(extracted);
      expect(memories.length, `${name}: nothing new may be extracted`).toBe(
        extractStableProjectMemories(content, `probe/${name}.md`).length
      );

      const nearMisses = dropped.filter((drop) => drop.reason === 'unrecognized-marker');
      expect(nearMisses, `${name}: the unusable marker must be reported`).toHaveLength(1);
      expect(nearMisses[0]!.sourceArtifact).toBe(`probe/${name}.md`);

      const [warning] = describeMemoryBlockDrops(nearMisses);
      expect(warning, `${name}: the warning must name the file`).toContain(`probe/${name}.md`);
      expect(warning, `${name}: the warning must show what was found`).toContain('peaks-memory:');
      expect(warning, `${name}: the warning must show the literal the locator wants`).toContain(wants);
    }
  });

  it('reports the near-miss even when the artifact has no usable block at all', () => {
    // The exact shape of the old doc's instruction: one attribute-shaped marker,
    // nothing else. Before N1 this was `extractedCount: 0, warnings: []`.
    const only = `<!-- peaks-memory:start kind=lesson -->\n\nA memory the author meant to keep.\n\n${END}\n`;
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(only, 'sc/handoff.md');
    expect(memories).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.reason).toBe('unrecognized-marker');
    const [warning] = describeMemoryBlockDrops(dropped);
    expect(warning).toContain('sc/handoff.md');
    expect(warning).toContain('kind=lesson');
  });

  it('ANTI-NOISE: a clean artifact with correct markers stays silent', () => {
    // The near-miss scan must not fire on a correctly written block. If it did,
    // every existing handoff in every downstream project would sprout warnings.
    const clean = `${block('title: A\nkind: lesson\n---\nBody A.')}\n${block('title: B\nkind: rule\n---\nBody B.')}\n`;
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(clean, 'probe/clean.md');
    expect(memories).toHaveLength(2);
    expect(dropped, 'a correct marker must produce no drop of any kind').toEqual([]);
    expect(describeMemoryBlockDrops(dropped)).toEqual([]);
  });

  it('ANTI-NOISE: prose that merely mentions the marker is not a near-miss', () => {
    const prose = [
      '# Notes',
      'See the peaks-memory:start docs, and `peaks-memory:end` too.',
      '<!-- the peaks-memory:start marker must be bare -->',
      `${START}`,
      'title: A',
      'kind: lesson',
      '---',
      'Body A.',
      `${END}`
    ].join('\n');
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(prose, 'probe/prose.md');
    expect(memories, 'the one real block still extracts').toHaveLength(1);
    expect(dropped, 'a mention is not an attempted marker').toEqual([]);
  });

  it('ANTI-NOISE: a near-miss inside a real block body is body text, not a marker', () => {
    const content = block(`title: A\nkind: lesson\n---\nDocs say <!-- peaks-memory:start kind=lesson --> is wrong.`);
    const { memories, dropped } = extractStableProjectMemoriesWithDiagnostics(content, 'probe/body.md');
    expect(memories).toHaveLength(1);
    expect(dropped).toEqual([]);
  });

  it('keeps every block-level drop reason the scanner can produce (no reason was replaced)', () => {
    // N1 adds a reason; it must not shadow the M2 reasons. `empty-body` is
    // absent from this list on purpose and not by omission: the scanner trims
    // the block before parsing, so a separator with nothing after it can never
    // survive the trim — that precondition is only reachable through a direct
    // `parseBlockResult` call, asserted immediately below.
    const reasons = new Set<string>();
    for (const raw of [
      'title: A\nkind: lesson\nBody.',
      'kind: lesson\n---\nBody.',
      'title: A\n---\nBody.',
      'title: A\nkind: note\n---\nBody.'
    ]) {
      const { dropped } = extractStableProjectMemoriesWithDiagnostics(block(raw), 'probe/reasons.md');
      for (const drop of dropped) reasons.add(drop.reason);
    }
    expect([...reasons].sort()).toEqual(['missing-kind', 'missing-separator', 'missing-title', 'unknown-kind']);

    const emptied = parseBlockResult('title: A\nkind: lesson\n---\n   ', 'probe/reasons.md');
    expect(emptied.ok).toBe(false);
    if (!emptied.ok) expect(emptied.reason).toBe('empty-body');
  });
});
