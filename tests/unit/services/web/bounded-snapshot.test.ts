// tests/unit/services/web/bounded-snapshot.test.ts
//
// AC2's mechanism layer (tech-doc §4.3/§4.4). The 1/5 RATIO is a live-browser
// measurement against the MCP snapshot and is QA's E2E job; what is provable
// here, with no browser at all, is boundedness — the actual P1 fix:
//   - `capText` never returns more bytes than its ceiling, never splits a
//     codepoint, and reports what it dropped;
//   - `pruneAriaSnapshot` drops + hoists noise, honours the depth cap, honours
//     the node cap, and is deterministic.
//
// Dimensions covered:
//   - behavior:    pure functions over fixture trees / fixture strings
//   - render:      the rendered snapshot's shape and its byte ceiling
//   - integration: not exercised (no fs, process, network or clock boundary)
//   - a11y:        not applicable (no user-visible text or exit code)

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/web/bounded-snapshot.test.ts',
  ['behavior', 'render'],
  [
    { dim: 'integration', reason: 'pure string / tree transformations; no fs, process, network or clock' },
    { dim: 'a11y', reason: 'no user-visible text or exit code is produced at this layer' },
  ],
);

import {
  capText,
  MAX_SNAP_BYTES,
  MAX_SNAP_DEPTH,
  MAX_SNAP_NODES,
} from '../../../../src/services/web/bounded-output.js';
import {
  pruneAriaSnapshot,
  renderSnapshot,
  SNAPSHOT_NOISE_ROLES,
  type AriaNode,
} from '../../../../src/services/web/snapshot-pruner.js';

/** A CJK payload: every character is 3 UTF-8 bytes, so byte != char length. */
const CJK_FIXTURE = `${'中文测试内容'.repeat(400)}\n${'尾部文本'.repeat(50)}`;

function node(role: string, extra: Partial<AriaNode> = {}): AriaNode {
  return { role, ...extra };
}

/** A tree with `count` nodes, all inside one unnamed `generic` wrapper. */
function wideTree(count: number): AriaNode[] {
  const children: AriaNode[] = [];
  for (let index = 0; index < count; index += 1) {
    children.push(node('button', { name: `button ${index}` }));
  }
  return [node('generic', { children })];
}

/** A single chain of `depth` nested NAMED wrappers, so the drop pass keeps them. */
function deepTree(depth: number): AriaNode[] {
  let current: AriaNode = node('button', { name: 'leaf' });
  for (let index = 0; index < depth; index += 1) {
    current = node('group', { name: `level ${index}`, children: [current] });
  }
  return [current];
}

describe('behavior — capText', () => {
  it('when the text already fits, should return it untouched and report zero dropped bytes', () => {
    // given: a payload well under the cap
    // when:  the cap is applied
    // then:  nothing is truncated and no marker is appended
    const capped = capText('hello\nworld', 4096);
    expect(capped.truncated).toBe(false);
    expect(capped.droppedBytes).toBe(0);
    expect(capped.text).toBe('hello\nworld');
  });

  it('when CJK text is over the cap, should never split a codepoint', () => {
    // given: a multi-byte payload and a small byte ceiling
    // when:  the cap is applied
    // then:  the result is valid UTF-8 with no replacement character
    const capped = capText(CJK_FIXTURE, 501);
    expect(capped.truncated).toBe(true);
    expect(capped.text.includes('�')).toBe(false);
    expect(Buffer.from(capped.text, 'utf8').toString('utf8')).toBe(capped.text);
  });

  it('when the text is over the cap, should keep the result within the ceiling', () => {
    // given: a payload larger than the cap, marker included in the budget
    // when:  the cap is applied
    // then:  the returned bytes never exceed the ceiling
    const capped = capText(CJK_FIXTURE, 600);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(600);
  });

  it('when the cap is narrower than the truncation marker, should still stay within it', () => {
    // given: a payload and a cap smaller than the marker itself
    // when:  the cap is applied
    // then:  the documented ceiling holds unconditionally
    const capped = capText('a'.repeat(100), 10);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(10);
    expect(capped.truncated).toBe(true);
    expect(capped.droppedBytes).toBe(100);
  });

  it('when text is truncated, should report the number of bytes it dropped', () => {
    // given: a payload of known byte length
    // when:  the cap is applied
    // then:  the kept prefix is a prefix of the input and the dropped count is exact
    const total = Buffer.byteLength(CJK_FIXTURE, 'utf8');
    const capped = capText(CJK_FIXTURE, 700);
    const keptBytes = total - capped.droppedBytes;
    const prefix = Buffer.from(capped.text, 'utf8').subarray(0, keptBytes).toString('utf8');
    expect(capped.droppedBytes).toBeGreaterThan(0);
    expect(capped.droppedBytes).toBeLessThan(total);
    expect(CJK_FIXTURE.startsWith(prefix)).toBe(true);
  });
});

describe('behavior — pruneAriaSnapshot', () => {
  it('when an unnamed generic wraps content, should drop it and hoist its children', () => {
    // given: a generic wrapper with no name, text or state
    // when:  the tree is pruned
    // then:  the wrapper is gone and its children survive at the parent level
    const pruned = pruneAriaSnapshot([node('generic', { children: [node('button', { name: 'Submit' })] })]);
    expect(pruned.droppedNodes).toBe(1);
    expect(pruned.nodes).toHaveLength(1);
    expect(pruned.nodes[0]?.role).toBe('button');
  });

  it('when a noise-role node carries a name, should keep it', () => {
    // given: a generic node that does have a name
    // when:  the tree is pruned
    // then:  it is not treated as noise
    const pruned = pruneAriaSnapshot([node('generic', { name: 'Landmark' })]);
    expect(pruned.droppedNodes).toBe(0);
    expect(pruned.nodes).toHaveLength(1);
  });

  it('when a noise-role node carries state, should keep it', () => {
    // given: a generic node that is disabled
    // when:  the tree is pruned
    // then:  its state makes it load-bearing and it survives
    const pruned = pruneAriaSnapshot([node('generic', { disabled: true })]);
    expect(pruned.droppedNodes).toBe(0);
    expect(pruned.nodes).toHaveLength(1);
  });

  it('when the tree is deeper than the cap, should cut it and flag depthCapped', () => {
    // given: a chain deeper than MAX_SNAP_DEPTH
    // when:  the tree is pruned
    // then:  the truncation is reported and a marker replaces the cut children
    const pruned = pruneAriaSnapshot(deepTree(MAX_SNAP_DEPTH + 5));
    expect(pruned.depthCapped).toBe(true);
    expect(renderSnapshot(pruned.nodes)).toContain('…');
  });

  it('when the tree has more nodes than the cap, should flag nodeCapped and append one marker', () => {
    // given: a tree with far more real nodes than MAX_SNAP_NODES
    // when:  the tree is pruned
    // then:  emission stops and exactly one [N more nodes] marker is appended
    const pruned = pruneAriaSnapshot(wideTree(MAX_SNAP_NODES * 4));
    expect(pruned.nodeCapped).toBe(true);
    const markers = renderSnapshot(pruned.nodes)
      .split('\n')
      .filter((line: string) => line.includes('more nodes'));
    expect(markers).toHaveLength(1);
  });

  it('when the same tree is pruned twice, should produce identical output', () => {
    // given: a mixed tree of noise and content
    // when:  the pruner runs twice on equal inputs
    // then:  the results are structurally identical (deterministic)
    const tree = wideTree(50);
    const first = pruneAriaSnapshot(tree);
    const second = pruneAriaSnapshot(tree);
    expect(second).toEqual(first);
  });

  it('when a tree is one node past the module cap, should fire the node cap exactly there', () => {
    // given: a tree of MAX_SNAP_NODES + 1 real nodes (no options object exists)
    // when:  the tree is pruned
    // then:  the cap fires on the module constant, not on a caller override
    const pruned = pruneAriaSnapshot(wideTree(MAX_SNAP_NODES + 1));
    expect(pruned.nodeCapped).toBe(true);
    const atCap = pruneAriaSnapshot(wideTree(MAX_SNAP_NODES));
    expect(atCap.nodeCapped).toBe(false);
  });

  it('when a page hands over 130000 siblings, should prune without throwing', () => {
    // given: one generic wrapper holding more siblings than V8's spread limit
    // when:  the tree is pruned and rendered
    // then:  the pass completes and the output is still bounded
    const pruned = pruneAriaSnapshot(wideTree(130_000));
    expect(pruned.nodeCapped).toBe(true);
    const rendered = renderSnapshot(pruned.nodes);
    expect(rendered.length).toBeGreaterThan(0);
  });

  it('when a page hands over a 6000-deep chain, should prune without overflowing the stack', () => {
    // given: a chain deeper than the call-stack budget of a recursive traversal
    // when:  the tree is pruned
    // then:  the pass completes and reports the depth cap instead of crashing
    const pruned = pruneAriaSnapshot(deepTree(6_000));
    expect(pruned.depthCapped).toBe(true);
  });

  it('when noise roles are declared, should expose the role set used to drop them', () => {
    // given: the exported noise-role set
    // when:  it is inspected
    // then:  it names the wrapper roles the drop pass relies on
    expect(SNAPSHOT_NOISE_ROLES.has('generic')).toBe(true);
    expect(SNAPSHOT_NOISE_ROLES.has('StaticText')).toBe(true);
    expect(SNAPSHOT_NOISE_ROLES.has('button')).toBe(false);
  });
});

describe('render — renderSnapshot', () => {
  it('when a node has a name and state, should render one line with the state flags', () => {
    // given: a checkbox node with a name, checked and disabled
    // when:  the tree is rendered
    // then:  the line carries role, quoted name and both flags
    const rendered = renderSnapshot([
      node('checkbox', { name: 'Subscribe', checked: true, disabled: true }),
    ]);
    expect(rendered).toBe('- checkbox "Subscribe" [checked] [disabled]');
  });

  it('when a link has a url and an input a placeholder, should render both truncated to 80 chars', () => {
    // given: a link with an over-long url and an input with an over-long placeholder
    // when:  the tree is rendered
    // then:  both attributes appear at exactly 80 characters
    const longUrl = `https://example.test/${'a'.repeat(200)}`;
    const longPlaceholder = 'b'.repeat(200);
    const rendered = renderSnapshot([
      node('link', { name: 'Docs', url: longUrl }),
      node('textbox', { placeholder: longPlaceholder }),
    ]);
    expect(rendered).toContain(`url=${longUrl.slice(0, 80)}`);
    expect(rendered).toContain(`placeholder=${longPlaceholder.slice(0, 80)}`);
  });

  it('when a node carries the state flags that protect it from pruning, should render every one', () => {
    // given: nodes carrying the four flags hasStateFlags counts but stateFlags dropped
    // when:  the tree is rendered
    // then:  each flag appears, so a selected tab is distinguishable
    const rendered = renderSnapshot([
      node('tab', { name: 'Second', selected: true, active: true, pressed: true }),
      node('textbox', { name: 'Email', invalid: 'mixed' }),
    ]);
    expect(rendered).toContain('[selected]');
    expect(rendered).toContain('[active]');
    expect(rendered).toContain('[pressed]');
    expect(rendered).toContain('[invalid=mixed]');
  });

  it('when a noise node is kept only for a rendered state flag, should not be pruned', () => {
    // given: a generic node whose only surviving property is `active`
    // when:  the tree is pruned and rendered
    // then:  the node survives AND shows the flag that saved it
    const pruned = pruneAriaSnapshot([node('generic', { active: true })]);
    expect(pruned.droppedNodes).toBe(0);
    expect(renderSnapshot(pruned.nodes)).toContain('[active]');
  });

  it('when a node name contains a newline, should keep one line per node', () => {
    // given: a page-controlled name containing a line break
    // when:  the tree is rendered
    // then:  the name is escaped and the line count is unchanged
    const rendered = renderSnapshot([node('button', { name: 'a\nb' })]);
    expect(rendered.split('\n')).toHaveLength(1);
    expect(rendered).toContain('"a\\nb"');
  });

  it('when a 5000-node tree is rendered through the pipeline, should stay within MAX_SNAP_BYTES', () => {
    // given: a 5000-node fixture
    // when:  the tree is pruned, rendered, and byte-capped
    // then:  the payload fits the snapshot ceiling
    const pruned = pruneAriaSnapshot(wideTree(5000));
    const capped = capText(renderSnapshot(pruned.nodes), MAX_SNAP_BYTES);
    expect(Buffer.byteLength(capped.text, 'utf8')).toBeLessThanOrEqual(MAX_SNAP_BYTES);
    expect(capped.text.length).toBeGreaterThan(0);
  });
});
