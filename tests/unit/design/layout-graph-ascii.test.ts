import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { entryOf, geometryOf, textOf, TOKENS } from './_layout-graph-fixtures.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  freshnessOf,
  geometryFingerprint,
  indexFromEntry
} from '../../../src/services/design/layout/layout-graph.js';
import { parseEntry } from '../../../src/services/design/layout/layout-graph-parse.js';

declareDimensions(
  'tests/unit/design/layout-graph-ascii.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'the entry format has no human-facing surface; readers get a CLI fragment'
    }
  ]
);

describe('(render) the ASCII entry', () => {
  it('when an entry is written, should name the route, state, viewport, digest and tokens', () => {
    // given: the mismatched fixture entry
    // when: it is serialized
    // then: the header carries every fact a rebuild needs
    const text = textOf(entryOf('mismatched'));
    expect(text.startsWith('lg 1\n')).toBe(true);
    expect(text).toContain('route /');
    expect(text).toContain('state default');
    expect(text).toContain('viewport 390x844');
    expect(text).toMatch(/fingerprint [0-9a-f]{16}/);
    expect(text).toContain('tokens space.page=0px space.roomy=24px space.section=16px');
    expect(text).not.toContain('tokensFingerprint');
    expect(text).not.toMatch(/^a /m);
  });

  it('when a written entry is parsed, should return the same nodes and derived anchors', () => {
    // given: a serialized entry
    // when: it is parsed back
    // then: ids and parents are unchanged and the anchors are re-derived exactly
    const entry = entryOf('mismatched');
    const read = parseEntry(textOf(entry));
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.entry.nodes.map((node) => node.id)).toEqual(entry.nodes.map((node) => node.id));
      expect(read.entry.nodes.map((node) => node.parentId)).toEqual(
        entry.nodes.map((node) => node.parentId)
      );
      expect(read.entry.anchors).toEqual(entry.anchors);
      expect(read.entry.tokensFingerprint).toBe(entry.tokensFingerprint);
    }
  });

  it('when the same entry is written twice, should produce identical bytes', () => {
    // given: one built entry
    // when: it is serialized twice
    // then: the two texts are byte-identical and re-serialization is idempotent
    const entry = entryOf('aligned');
    const first = textOf(entry);
    const second = textOf(entry);
    const parsed = parseEntry(first);
    expect(second).toBe(first);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(textOf(parsed.entry)).toBe(first);
  });

  it('when anchors are derived from the nodes, should name both parents and both tokens', () => {
    // given: the mismatched fixture entry
    // when: its written entry is parsed
    // then: the derived anchor names both parents and both token names
    const read = parseEntry(textOf(entryOf('mismatched')));
    expect(read.ok).toBe(true);
    if (read.ok) {
      const anchor = read.entry.anchors[0];
      expect(anchor?.verdict).toBe('not-aligned');
      expect(anchor?.source?.token?.name).toBe('space.section');
      expect(anchor?.otherSource?.token?.name).toBe('space.roomy');
    }
  });
});

describe('(behavior) fingerprints and freshness', () => {
  it('when the measured document is unchanged, should produce the same fingerprint', () => {
    // given: two reads of the same fixture document
    // when: both are fingerprinted
    // then: the digest is identical
    expect(geometryFingerprint(geometryOf('aligned'))).toBe(
      geometryFingerprint(geometryOf('aligned'))
    );
  });

  it('when a computed padding moves, should change the fingerprint', () => {
    // given: the aligned document and a copy with one padding changed by a whole pixel
    // when: both are fingerprinted
    // then: the digests differ
    const changed = geometryOf('aligned');
    const target = changed.elements[2];
    expect(target).toBeDefined();
    if (target !== undefined) target.padding.left = 17;
    expect(geometryFingerprint(changed)).not.toBe(geometryFingerprint(geometryOf('aligned')));
  });

  it('when both current inputs match, should report the entry as current', () => {
    // given: an entry and the same geometry and tokens it was built from
    // when: freshness is read
    // then: the entry is current with no reasons
    const entry = entryOf('aligned');
    const read = freshnessOf(entry, { geometry: geometryOf('aligned'), tokens: TOKENS });
    expect(read).toEqual({ status: 'current', reasons: [] });
  });

  it('when a current input differs, should report the entry as stale and name the axis', () => {
    // given: an entry and a token table whose value moved
    // when: freshness is read
    // then: the entry is stale on the token axis
    const entry = entryOf('aligned');
    const moved = TOKENS.map((token) =>
      token.name === 'space.section' ? { ...token, value: '18px', px: 18 } : token
    );
    const read = freshnessOf(entry, { geometry: geometryOf('aligned'), tokens: moved });
    expect(read.status).toBe('stale');
    expect(read.reasons).toContain('spacing-tokens-changed');
  });

  it('when a token the entry does not cite moves, should keep the entry current', () => {
    // given: the card entry, whose paddings carry 0 and 16 but never the 24 token
    // when: freshness is read against a contract whose 24 token moved
    // then: the cited subset is unchanged, so the entry stays current
    const moved = TOKENS.map((token) =>
      token.name === 'space.roomy' ? { ...token, value: '28px', px: 28 } : token
    );
    const read = freshnessOf(entryOf('card'), { geometry: geometryOf('card'), tokens: moved });
    expect(read).toEqual({ status: 'current', reasons: [] });
  });

  it('when a token the entry cites moves, should report the entry stale', () => {
    // given: the card entry and a contract whose shared 16 token moved
    // when: freshness is read against it
    // then: the cited subset moved, so the entry is stale on the token axis
    const moved = TOKENS.map((token) =>
      token.name === 'space.section' ? { ...token, value: '20px', px: 20 } : token
    );
    const read = freshnessOf(entryOf('card'), { geometry: geometryOf('card'), tokens: moved });
    expect(read.status).toBe('stale');
    expect(read.reasons).toContain('spacing-tokens-changed');
  });

  it('when no current input is supplied, should report the entry as unverified rather than current', () => {
    // given: an entry and no fresh measurement
    // when: freshness is read
    // then: it is unverified and names both unchecked axes
    const read = freshnessOf(entryOf('aligned'), {});
    expect(read.status).toBe('unverified');
    expect(read.reasons).toContain('source-geometry-not-checked');
    expect(read.reasons).toContain('spacing-tokens-not-checked');
  });

  it('when an entry is damaged, should refuse it with a reason instead of guessing', () => {
    // given: a written entry with its closing line removed
    // when: it is parsed
    // then: the parser returns a failure reason
    const lines = textOf(entryOf('aligned')).trimEnd().split('\n');
    const damaged = `${lines.slice(0, -1).join('\n')}\n`;
    const read = parseEntry(damaged);
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain('does not close');
  });

  it('when a node names an absent parent, should refuse the entry', () => {
    // given: a written entry whose second node names a parent that does not exist
    // when: it is parsed
    // then: the parser returns a reason naming the parent rule
    const lines = textOf(entryOf('aligned')).split('\n');
    const nodeLine = lines[8];
    expect(nodeLine).toBeDefined();
    const fields = (nodeLine ?? '').split(' ');
    fields[6] = 'ffffffffffff';
    lines[8] = fields.join(' ');
    const read = parseEntry(lines.join('\n'));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain('parent');
  });

  it('when a stored text is edited after numbering, should refuse the entry', () => {
    // given: a written entry whose first object text no longer matches its id
    // when: it is parsed
    // then: the re-cut check refuses it instead of accepting the new text
    const lines = textOf(entryOf('aligned')).split('\n');
    expect(lines[9]).toBeDefined();
    lines[9] = (lines[9] ?? '').replace('"Quarterly report"', '"somewhere else entirely"');
    const read = parseEntry(lines.join('\n'));
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.reason).toContain('no longer matches');
  });
});

describe('(integration) the entry and the cut', () => {
  it('when an entry is re-cut, should reproduce the ids and anchors of the fixture', () => {
    // given: the fixture index and the entry built from it
    // when: the entry is converted back to measured geometry and cut again
    // then: ids and anchors are identical
    const entry = entryOf('aligned');
    const again = indexFromEntry(entry);
    expect(again.ok).toBe(true);
    if (again.ok) {
      expect(again.index.nodes.map((node) => node.id)).toEqual(entry.nodes.map((node) => node.id));
      expect(again.index.anchors).toEqual(entry.anchors);
    }
  });

  it('when an object carries an atomic child, should keep both nodes and their texts', () => {
    // given: a paragraph object with an image child
    // when: the entry is built and re-cut
    // then: the paragraph's own text and subtree text both survive
    const geometry = geometryOf('object-child');
    const entry = buildLayoutEntry({
      index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
      geometry,
      state: 'default',
      tokens: TOKENS
    });
    const paragraph = entry.nodes.find((node) => node.tag === 'p');
    const image = entry.nodes.find((node) => node.tag === 'img');
    expect(paragraph?.ownText).toBe('Subscribe');
    expect(paragraph?.text).toBe('Subscribe');
    expect(image?.parentId).toBe(paragraph?.id);
    const read = parseEntry(textOf(entry));
    expect(read.ok).toBe(true);
    if (read.ok)
      expect(read.entry.nodes.map((node) => node.id)).toEqual(entry.nodes.map((node) => node.id));
  });
});
