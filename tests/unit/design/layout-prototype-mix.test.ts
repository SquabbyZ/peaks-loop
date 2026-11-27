import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { captureIo, disposeProjects, entryOf, tempProject } from './_layout-graph-fixtures.js';
import {
  runDesignLayoutMix,
  runDesignLayoutPrototype
} from '../../../src/cli/commands/design-layout-prototype-command.js';
import {
  graphRoot,
  routeSlug,
  writeEntry
} from '../../../src/services/design/layout/layout-graph-store.js';
import { mixSequence, precheckPair } from '../../../src/services/design/layout/layout-mix.js';
import {
  filterPrototypes,
  generatePrototypes,
  type Prototype,
  type PrototypeBlock
} from '../../../src/services/design/layout/layout-prototype.js';
import { PREVIEW_MARKER } from '../../../src/services/design/layout/layout-preview.js';
import type { LayoutEntry } from '../../../src/services/design/layout/layout-graph.js';

declareDimensions('tests/unit/design/layout-prototype-mix.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

type Generated = { entry: LayoutEntry; prototypes: Prototype[] };

function generated(): Generated {
  const entry = entryOf('aligned');
  const result = generatePrototypes(entry);
  if (!result.ok) throw new Error(result.reason);
  return { entry, prototypes: result.prototypes };
}

function named(prototypeList: readonly Prototype[], name: string): Prototype {
  const found = prototypeList.find((prototype) => prototype.name === name);
  if (found === undefined) throw new Error(`no prototype named ${name}`);
  return found;
}

function blockOf(prototypeList: readonly Prototype[], name: string, index: number): PrototypeBlock {
  const block = named(prototypeList, name).blocks[index];
  if (block === undefined) throw new Error(`no block ${String(index)} on ${name}`);
  return block;
}

function declaredOf(entry: LayoutEntry): Set<string> {
  return new Set(entry.tokens.map((token) => token.name));
}

function envelopeOf(out: string): Record<string, unknown> {
  return JSON.parse(out) as Record<string, unknown>;
}

function sideBySide(block: PrototypeBlock, left: number, parent: string, value: string) {
  return {
    ...block,
    box: { left, top: 0, right: left + 100, bottom: 50 },
    sources: {
      ...block.sources,
      top: {
        parentId: parent,
        property: 'padding-top' as const,
        value,
        tokenName: value === '24px' ? 'space.roomy' : 'space.section'
      }
    }
  };
}

describe('(render) parallel prototypes', () => {
  it('when one entry is prototyped, should produce five independent marked pages', () => {
    // given: an entry with two visual objects
    // when: the prototypes are generated in one pass
    // then: each page is a complete document that names itself and carries the marker
    const { prototypes } = generated();
    expect(prototypes.length).toBeGreaterThanOrEqual(5);
    for (const prototype of prototypes) {
      expect(prototype.html.startsWith('<!doctype html>')).toBe(true);
      expect(prototype.html).toContain(`data-prototype="${prototype.name}"`);
      expect(prototype.html).toContain(PREVIEW_MARKER);
      expect(prototype.marker).toBe(PREVIEW_MARKER);
    }
  });

  it('when a block is taken, should take it from the entry object nodes', () => {
    // given: a generated prototype and the entry it came from
    // when: the block ids and the object node ids are compared
    // then: every block is one object node and no container becomes a block
    const { entry, prototypes } = generated();
    const objectIds = entry.nodes.filter((node) => node.kind === 'object').map((node) => node.id);
    const blockIds = named(prototypes, 'stack').blocks.map((block) => block.blockId);
    expect(blockIds).toEqual(objectIds);
  });
});

describe('(behavior) the mix pre-check', () => {
  it('when a conflicting block is checked, should report the conflict and name both sources', () => {
    // given: a heading from the graph spacing and a heading from the roomy spacing
    // when: the stacked pair is pre-checked
    // then: the verdict is conflict on the left edge and both parents and tokens are carried
    const { entry, prototypes } = generated();
    const check = precheckPair(
      blockOf(prototypes, 'roomy', 0),
      blockOf(prototypes, 'stack', 1),
      declaredOf(entry)
    );
    expect(check.verdict).toBe('conflict');
    if (check.verdict === 'conflict') {
      expect(check.code).toBe('ANCHOR_SOURCE_CONFLICT');
      expect(check.conflict.edge).toBe('left');
      expect(check.conflict.candidate.parentId).not.toBe(check.conflict.neighbour.parentId);
      expect(check.conflict.candidate.value).toBe('24px');
      expect(check.conflict.neighbour.value).toBe('16px');
    }
  });

  it('when two blocks share a parent token, should allow the pair', () => {
    // given: the same heading from two prototypes that share the graph spacing
    // when: the pair is pre-checked
    // then: the verdict is allow, not a manufactured conflict
    const { entry, prototypes } = generated();
    const check = precheckPair(
      blockOf(prototypes, 'outline', 0),
      blockOf(prototypes, 'stack', 0),
      declaredOf(entry)
    );
    expect(check.verdict).toBe('allow');
  });

  it('when a side-by-side pair has different top tokens, should report a top-edge conflict', () => {
    // given: two blocks side by side whose parents carry 16px and 24px top padding
    // when: the pair is pre-checked
    // then: the edge is top and the two sources are named
    const { entry, prototypes } = generated();
    const left = sideBySide(blockOf(prototypes, 'stack', 0), 0, 'p16', '16px');
    const right = sideBySide(blockOf(prototypes, 'stack', 1), 120, 'p24', '24px');
    const check = precheckPair(left, right, declaredOf(entry));
    expect(check.verdict).toBe('conflict');
    if (check.verdict === 'conflict') {
      expect(check.conflict.edge).toBe('top');
      expect(check.conflict.candidate.value).toBe('16px');
      expect(check.conflict.neighbour.value).toBe('24px');
    }
  });

  it('when a side-by-side pair shares its top token, should allow the pair', () => {
    // given: two side-by-side blocks whose parents carry the same top padding
    // when: the pair is pre-checked
    // then: the verdict is allow, so the top rule is not a blanket refusal
    const { entry, prototypes } = generated();
    const left = sideBySide(blockOf(prototypes, 'stack', 0), 0, 'p16', '16px');
    const right = sideBySide(blockOf(prototypes, 'stack', 1), 120, 'q16', '16px');
    expect(precheckPair(left, right, declaredOf(entry)).verdict).toBe('allow');
  });

  it('when a block would lose its parent chain, should refuse the mix', () => {
    // given: a flat block whose chain stops at the document
    // when: it is checked against a block under the region chain
    // then: the check refuses and says the chain cannot be preserved
    const { entry, prototypes } = generated();
    const check = precheckPair(
      blockOf(prototypes, 'flat', 0),
      blockOf(prototypes, 'stack', 1),
      declaredOf(entry)
    );
    expect(check.verdict).toBe('refuse');
    if (check.verdict === 'refuse') {
      expect(check.code).toBe('PARENT_CHAIN_BROKEN');
      expect(check.detail).toContain('cannot be preserved');
    }
  });

  it('when a token is not declared, should refuse at the contract layer first', () => {
    // given: a copy of a sound block whose left token is undeclared
    // when: the pair is pre-checked
    // then: the contract refusal wins over the anchor layer
    const { entry, prototypes } = generated();
    const base = blockOf(prototypes, 'stack', 0);
    const suspect: PrototypeBlock = {
      ...base,
      sources: { ...base.sources, left: { ...base.sources.left, tokenName: 'space.card' } }
    };
    const check = precheckPair(suspect, blockOf(prototypes, 'stack', 1), declaredOf(entry));
    expect(check.verdict).toBe('refuse');
    if (check.verdict === 'refuse') expect(check.layer).toBe('contract');
  });

  it('when a lone candidate breaks the page chain, should refuse instead of allowing', () => {
    // given: a one-block base whose replaced block keeps the region chain
    // when: a flat block is the only candidate and has no neighbour
    // then: the sequence refuses the chain and produces no page
    const { entry, prototypes } = generated();
    const single: Prototype = {
      ...named(prototypes, 'stack'),
      name: 'single',
      blocks: [blockOf(prototypes, 'stack', 0)]
    };
    const result = mixSequence(entry, [...prototypes, single], 'single', [
      { blockId: blockOf(prototypes, 'flat', 0).blockId, from: 'flat' }
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PARENT_CHAIN_BROKEN');
    expect('html' in result).toBe(false);
  });

  it('when a lone candidate keeps the page chain, should allow the replacement', () => {
    // given: a one-block base and a candidate that shares its chain and tokens
    // when: the sequence runs
    // then: the move is allowed and a marked page is produced
    const { entry, prototypes } = generated();
    const single: Prototype = {
      ...named(prototypes, 'stack'),
      name: 'single',
      blocks: [blockOf(prototypes, 'stack', 0)]
    };
    const result = mixSequence(entry, [...prototypes, single], 'single', [
      { blockId: blockOf(prototypes, 'outline', 0).blockId, from: 'outline' }
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.html).toContain(PREVIEW_MARKER);
  });

  it('when the base itself violates a rule, should refuse the sequence', () => {
    // given: a prototype marked with a contract violation
    // when: it is used as the base
    // then: the sequence refuses before any move
    const { entry, prototypes } = generated();
    const invalid: Prototype = {
      ...named(prototypes, 'stack'),
      name: 'invalid-base',
      violations: [{ code: 'contract-violation', blockId: 'x', detail: 'undeclared token' }]
    };
    const result = mixSequence(entry, [...prototypes, invalid], 'invalid-base', []);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('CONTRACT_BASE_INVALID');
  });

  it('when one allowed move is applied, should replace one block and pre-check it', () => {
    // given: the stack prototype as the base
    // when: one block is taken from the outline prototype
    // then: the sequence allows it, writes a marked page and logs one step
    const { entry, prototypes } = generated();
    const target = blockOf(prototypes, 'stack', 0);
    const result = mixSequence(entry, prototypes, 'stack', [
      { blockId: target.blockId, from: 'outline' }
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.steps).toHaveLength(1);
      expect(result.steps[0]?.precheck.verdict).toBe('allow');
      expect(result.html).toContain(PREVIEW_MARKER);
    }
  });

  it('when a later move conflicts, should stop after the blocks already accepted', () => {
    // given: one allowed move followed by a conflicting move
    // when: the sequence runs
    // then: the first step is allowed, the second conflicts, and no page is produced
    const { entry, prototypes } = generated();
    const target = blockOf(prototypes, 'stack', 0);
    const result = mixSequence(entry, prototypes, 'stack', [
      { blockId: target.blockId, from: 'outline' },
      { blockId: target.blockId, from: 'roomy' }
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ANCHOR_SOURCE_CONFLICT');
      expect(result.steps.map((step) => step.precheck.verdict)).toEqual(['allow', 'conflict']);
      expect(result.conflict).not.toBeNull();
    }
    expect('html' in result).toBe(false);
  });

  it('when a block loses its chain in a sequence, should refuse before any page exists', () => {
    // given: a move that takes a flat block into the stack base
    // when: the sequence runs
    // then: it refuses with the chain code and produces no html
    const { entry, prototypes } = generated();
    const target = blockOf(prototypes, 'stack', 0);
    const result = mixSequence(entry, prototypes, 'stack', [
      { blockId: target.blockId, from: 'flat' }
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PARENT_CHAIN_BROKEN');
    expect('html' in result).toBe(false);
  });
});

describe('(integration) filtering and the commands', () => {
  it('when the generated prototypes are filtered, should keep at most two in order', () => {
    // given: five direction prototypes that are structurally clean
    // when: the structural filter runs
    // then: two are kept in direction order and the rest are capped, not dropped
    const { prototypes } = generated();
    const filter = filterPrototypes(prototypes);
    expect(filter.kept.length).toBeLessThanOrEqual(2);
    expect(filter.kept.map((prototype) => prototype.name)).toEqual(['stack', 'outline']);
    expect(filter.capped.map((entry) => entry.name)).toEqual(['roomy', 'compact', 'flat']);
    expect(filter.dropped).toEqual([]);
  });

  it('when a prototype breaks a structural rule, should drop it with the rule name', () => {
    // given: a clean set plus one prototype marked with a contract violation
    // when: the structural filter runs
    // then: only the marked prototype is dropped and its code is reported
    const { prototypes } = generated();
    const invalid: Prototype = {
      ...named(prototypes, 'roomy'),
      name: 'bad-token',
      violations: [{ code: 'contract-violation', blockId: 'x', detail: 'undeclared token' }]
    };
    const filter = filterPrototypes([...prototypes, invalid]);
    expect(filter.dropped.map((entry) => entry.name)).toEqual(['bad-token']);
    expect(filter.dropped[0]?.violations[0]?.code).toBe('contract-violation');
  });

  it('when the prototype command runs, should write five files and report two kept', async () => {
    // given: a project holding one written entry
    // when: the prototype command runs
    // then: five pages exist on disk and the envelope reports two kept and three capped
    const root = tempProject();
    writeEntry(root, entryOf('aligned'));
    const capture = captureIo();
    await runDesignLayoutPrototype({ project: root, route: '/', json: true }, capture.io);
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      prototypes: Array<{ path: string }>;
      kept: string[];
      capped: Array<{ name: string }>;
    };
    expect(data.prototypes).toHaveLength(5);
    for (const prototype of data.prototypes) {
      expect(existsSync(prototype.path)).toBe(true);
      expect(readFileSync(prototype.path, 'utf8')).toContain(PREVIEW_MARKER);
    }
    expect(data.kept).toEqual(['stack', 'outline']);
    expect(data.capped.map((entry) => entry.name)).toEqual(['roomy', 'compact', 'flat']);
  });

  it('when the mix command applies an allowed move, should write a marked mixed page', () => {
    // given: a project holding one written entry
    // when: the mix command takes one block from the outline prototype
    // then: the mixed page exists and the envelope reports a sha256
    const root = tempProject();
    const entry = entryOf('aligned');
    writeEntry(root, entry);
    const target = entry.nodes.find((node) => node.kind === 'object');
    if (target === undefined) throw new Error('no object');
    const capture = captureIo();
    runDesignLayoutMix(
      { project: root, route: '/', base: 'stack', move: [`${target.id}=outline`], json: true },
      capture.io
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { path: string; sha256: string };
    expect(readFileSync(data.path, 'utf8')).toContain(PREVIEW_MARKER);
    expect(data.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('when the mix command hits a conflict, should exit refused and remove a stale page', () => {
    // given: a project with a stale mixed page from an earlier allowed mix
    // when: the mix command takes a block from the roomy prototype
    // then: the envelope names the conflict, no page remains, and no mix is written
    const root = tempProject();
    const entry = entryOf('aligned');
    writeEntry(root, entry);
    const target = entry.nodes.find((node) => node.kind === 'object');
    if (target === undefined) throw new Error('no object');
    const mixed = join(graphRoot(root), routeSlug('/'), 'prototypes', 'mixed.html');
    runDesignLayoutMix(
      { project: root, route: '/', base: 'stack', move: [`${target.id}=outline`], json: true },
      captureIo().io
    );
    expect(existsSync(mixed)).toBe(true);
    const capture = captureIo();
    runDesignLayoutMix(
      { project: root, route: '/', base: 'stack', move: [`${target.id}=roomy`], json: true },
      capture.io
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('DESIGN_LAYOUT_MIX_CONFLICT');
    expect(process.exitCode).toBe(2);
    expect(existsSync(mixed)).toBe(false);
  });

  it('when the mix command breaks the chain, should exit refused and write no page', () => {
    // given: a project whose base keeps the region chain
    // when: the mix command takes a flat block
    // then: the refusal names the chain code and no mixed file is written
    const root = tempProject();
    const entry = entryOf('aligned');
    writeEntry(root, entry);
    const target = entry.nodes.find((node) => node.kind === 'object');
    if (target === undefined) throw new Error('no object');
    const capture = captureIo();
    runDesignLayoutMix(
      { project: root, route: '/', base: 'stack', move: [`${target.id}=flat`], json: true },
      capture.io
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.code).toBe('DESIGN_LAYOUT_MIX_PARENT_CHAIN_BROKEN');
    expect(process.exitCode).toBe(2);
    const mixed = join(graphRoot(root), routeSlug('/'), 'prototypes', 'mixed.html');
    expect(existsSync(mixed)).toBe(false);
  });

  it('when the contract marks the entry stale, should refuse the mix and write no page', () => {
    // given: a project holding one entry whose contract then moved the shared token
    // when: the mix command runs without an explicit allowance
    // then: it refuses with the stale code and no mixed page exists
    const root = tempProject();
    const entry = entryOf('aligned');
    writeEntry(root, entry);
    const contractPath = join(root, 'design', 'tokens.json');
    const parsed = JSON.parse(readFileSync(contractPath, 'utf8')) as {
      space: Record<string, { $value: string }>;
    };
    const section = parsed.space.section;
    if (section === undefined) throw new Error('the fixture contract has no space.section');
    section.$value = '20px';
    writeFileSync(contractPath, JSON.stringify(parsed), 'utf8');
    const target = entry.nodes.find((node) => node.kind === 'object');
    if (target === undefined) throw new Error('no object');
    const capture = captureIo();
    runDesignLayoutMix(
      { project: root, route: '/', base: 'stack', move: [`${target.id}=outline`], json: true },
      capture.io
    );
    expect(envelopeOf(capture.out()).code).toBe('DESIGN_LAYOUT_ENTRY_STALE');
    const mixed = join(graphRoot(root), routeSlug('/'), 'prototypes', 'mixed.html');
    expect(existsSync(mixed)).toBe(false);
  });
});

describe('(a11y) the messages', () => {
  it('when a conflict is reported, should name both parent containers and both token values', () => {
    // given: the conflicting pair
    // when: the conflict detail and the structured sources are read
    // then: each side carries its own parent and token
    const { entry, prototypes } = generated();
    const check = precheckPair(
      blockOf(prototypes, 'roomy', 0),
      blockOf(prototypes, 'stack', 1),
      declaredOf(entry)
    );
    expect(check.verdict).toBe('conflict');
    if (check.verdict === 'conflict') {
      expect(check.conflict.detail).toContain(check.conflict.candidate.parentId ?? '');
      expect(check.conflict.detail).toContain(check.conflict.neighbour.parentId ?? '');
      expect(check.conflict.detail).toContain('space.roomy=24px');
      expect(check.conflict.detail).toContain('space.section=16px');
      expect(check.conflict.edge).toBe('left');
    }
  });

  it('when a prototype is capped or dropped, should say which rule decided it', () => {
    // given: a clean set plus one marked prototype
    // when: the filter result is read
    // then: the capped reason names the cap and the dropped entry names its code
    const { prototypes } = generated();
    const invalid: Prototype = {
      ...named(prototypes, 'compact'),
      name: 'bad-chain',
      violations: [{ code: 'parent-chain-broken', blockId: 'x', detail: 'chain differs' }]
    };
    const filter = filterPrototypes([...prototypes, invalid]);
    expect(filter.capped[0]?.reason).toContain('handoff cap');
    expect(filter.dropped[0]?.violations[0]?.code).toBe('parent-chain-broken');
  });
});
