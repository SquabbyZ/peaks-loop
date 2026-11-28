/**
 * Boundary assertions for the layout pairing and token attribution rules.
 *
 * These tests distinguish the production branches of `layout-align.ts` from
 * their mutants: the `>=`/`>` epsilon boundary, the always-true/always-false
 * pairing guards, the padding-side ternary and the human-facing finding text.
 * They assert the observable shape of `tokenFor` and `buildLayoutIndex` only.
 *
 * Four-dimension split: render (anchor and finding shape), behavior (pairing,
 * token attribution) and a11y (the human-facing finding text). Integration is
 * omitted because both functions are pure with no fs, subprocess, network,
 * environment or clock boundary.
 */
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  buildLayoutIndex,
  tokenFor,
  type LayoutIndex
} from '../../../src/services/design/layout/layout-align.js';
import type {
  LayoutElement,
  LayoutGeometry,
  PaddingSides
} from '../../../src/services/design/layout/layout-geometry.js';
import type { SpacingToken } from '../../../src/services/design/layout/layout-tokens.js';

declareDimensions(
  'tests/unit/design/layout-align-boundary-mut.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        'both functions are pure with no fs, subprocess, network, environment or clock boundary'
    }
  ]
);

const NO_PADDING: PaddingSides = { top: 0, right: 0, bottom: 0, left: 0 };

/** Every element field present, so a fixture states only what it varies. */
function element(part: Partial<LayoutElement> & { parent: number; tag: string }): LayoutElement {
  return {
    ariaRole: null,
    display: 'block',
    ownText: '',
    text: '',
    box: { left: 0, top: 0, right: 100, bottom: 20 },
    padding: NO_PADDING,
    painted: false,
    ...part
  };
}

function geometryOf(elements: LayoutElement[], route = '/mut'): LayoutGeometry {
  return { route, viewport: { width: 390, height: 844 }, elements };
}

function indexOf(elements: LayoutElement[], tokens: readonly SpacingToken[] = []): LayoutIndex {
  return buildLayoutIndex({ geometry: geometryOf(elements), spacingTokens: tokens });
}

function token(name: string, px: number): SpacingToken {
  return { name, value: `${String(px)}px`, px };
}

/** html > body > section(padding 12/7) > two touching paragraphs. */
function stackedPage(): LayoutElement[] {
  return [
    element({ parent: -1, tag: 'html', text: 'A B' }),
    element({ parent: 0, tag: 'body', text: 'A B' }),
    element({
      parent: 1,
      tag: 'section',
      text: 'A B',
      box: { left: 0, top: 0, right: 390, bottom: 140 },
      padding: { top: 12, right: 0, bottom: 0, left: 7 }
    }),
    element({
      parent: 2,
      tag: 'p',
      ownText: 'A',
      text: 'A',
      box: { left: 7, top: 12, right: 200, bottom: 32 }
    }),
    element({
      parent: 2,
      tag: 'p',
      ownText: 'B',
      text: 'B',
      box: { left: 23, top: 32, right: 200, bottom: 52 }
    })
  ];
}

/** html > body > section(padding 12/7) > two paragraphs side by side. */
function sideBySidePage(): LayoutElement[] {
  return [
    element({ parent: -1, tag: 'html', text: 'A B' }),
    element({ parent: 0, tag: 'body', text: 'A B' }),
    element({
      parent: 1,
      tag: 'section',
      text: 'A B',
      box: { left: 0, top: 0, right: 390, bottom: 60 },
      padding: { top: 12, right: 0, bottom: 0, left: 7 }
    }),
    element({
      parent: 2,
      tag: 'p',
      ownText: 'A',
      text: 'A',
      box: { left: 7, top: 12, right: 100, bottom: 32 }
    }),
    element({
      parent: 2,
      tag: 'p',
      ownText: 'B',
      text: 'B',
      box: { left: 120, top: 20, right: 200, bottom: 40 }
    })
  ];
}

/** Two root-level images with no numbered parent, 4px apart on the left. */
function rootPairPage(): LayoutElement[] {
  return [
    element({
      parent: -1,
      tag: 'img',
      box: { left: 0, top: 0, right: 10, bottom: 10 }
    }),
    element({
      parent: -1,
      tag: 'img',
      box: { left: 4, top: 20, right: 14, bottom: 30 }
    })
  ];
}

describe('(behavior) token attribution', () => {
  it('when a token differs by exactly the epsilon, should attribute it', () => {
    // given: px 0 and a declared token at 0.01, the exact tolerance boundary
    // when: tokenFor attributes the pixel value
    // then: the boundary token is a match
    const boundary = token('space.hairline', 0.01);
    expect(tokenFor([boundary], 0)).toBe(boundary);
  });

  it('when a token differs by more than the epsilon, should not attribute it', () => {
    // given: px 0 and a token one representable step past the tolerance
    // when: tokenFor attributes the pixel value
    // then: no token is reported
    expect(tokenFor([token('space.past', 0.010000000000000002)], 0)).toBeNull();
  });

  it('when several tokens declare one value, should pick the smallest name', () => {
    // given: two same-pixel tokens, in both file orders
    // when: tokenFor attributes the pixel value
    // then: the lexicographically smallest name wins regardless of order
    const alpha = token('space.alpha', 16);
    const zulu = token('space.zulu', 16);
    expect(tokenFor([alpha, zulu], 16)).toBe(alpha);
    expect(tokenFor([zulu, alpha], 16)).toBe(alpha);
  });
});

describe('(behavior) pairing', () => {
  it('when two stacked boxes touch, should pair them on the left edge', () => {
    // given: two paragraphs whose bottom and top are exactly equal
    // when: the layout index is built
    // then: touching still counts as stacked
    const index = indexOf(stackedPage());
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('left');
    expect(index.anchors[0]?.verdict).toBe('not-aligned');
  });

  it('when two boxes sit side by side, should pair them on the top edge', () => {
    // given: two paragraphs separated horizontally, tops 12px vs 20px
    // when: the layout index is built
    // then: the edge is top and the source is the parent's padding-top
    const index = indexOf(sideBySidePage());
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('top');
    const finding = index.findings[0];
    expect(finding?.difference).toBe(8);
    expect(finding?.source?.property).toBe('padding-top');
    expect(finding?.source?.value).toBe('12px');
    expect(finding?.source?.token).toBeNull();
  });

  it('when two boxes overlap, should not pair them at all', () => {
    // given: two paragraphs overlapping on both axes
    // when: the layout index is built
    // then: neither a stacked nor a side-by-side pair is emitted
    const index = indexOf([
      element({ parent: -1, tag: 'html', text: 'A B' }),
      element({
        parent: 0,
        tag: 'p',
        ownText: 'A',
        text: 'A',
        box: { left: 0, top: 0, right: 100, bottom: 100 }
      }),
      element({
        parent: 0,
        tag: 'p',
        ownText: 'B',
        text: 'B',
        box: { left: 50, top: 50, right: 150, bottom: 150 }
      })
    ]);
    expect(index.anchors).toEqual([]);
    expect(index.findings).toEqual([]);
  });

  it('when the ancestor roles differ, should not compare the two objects', () => {
    // given: two headings with one role each under a section and an article
    // when: the layout index is built
    // then: different ancestor chains keep them in separate groups
    const index = indexOf([
      element({ parent: -1, tag: 'html', text: 'A B' }),
      element({ parent: 0, tag: 'body', text: 'A B' }),
      element({
        parent: 1,
        tag: 'section',
        text: 'A',
        box: { left: 0, top: 0, right: 390, bottom: 100 }
      }),
      element({
        parent: 2,
        tag: 'h2',
        ownText: 'A',
        text: 'A',
        box: { left: 16, top: 10, right: 100, bottom: 35 }
      }),
      element({
        parent: 1,
        tag: 'article',
        text: 'B',
        box: { left: 0, top: 100, right: 390, bottom: 200 }
      }),
      element({
        parent: 4,
        tag: 'h2',
        ownText: 'B',
        text: 'B',
        box: { left: 48, top: 110, right: 140, bottom: 135 }
      })
    ]);
    expect(index.anchors).toEqual([]);
    expect(index.findings).toEqual([]);
  });

  it('when containers share a role, should not compare them as objects', () => {
    // given: two sibling sections with one heading each
    // when: the layout index is built
    // then: only the two headings form one anchor
    const index = indexOf([
      element({ parent: -1, tag: 'html', text: 'A B' }),
      element({ parent: 0, tag: 'body', text: 'A B' }),
      element({
        parent: 1,
        tag: 'section',
        ownText: 'A',
        text: 'A',
        box: { left: 0, top: 0, right: 195, bottom: 100 }
      }),
      element({
        parent: 2,
        tag: 'h2',
        ownText: 'A',
        text: 'A',
        box: { left: 16, top: 10, right: 100, bottom: 35 }
      }),
      element({
        parent: 1,
        tag: 'section',
        ownText: 'B',
        text: 'B',
        box: { left: 195, top: 0, right: 390, bottom: 100 }
      }),
      element({
        parent: 4,
        tag: 'h2',
        ownText: 'B',
        text: 'B',
        box: { left: 211, top: 10, right: 300, bottom: 35 }
      })
    ]);
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('top');
    expect(index.nodes.filter((node) => node.kind === 'container')).toHaveLength(3);
  });

  it('when a pair has no numbered parent, should report null sources', () => {
    // given: two root-level images at different left edges
    // when: the layout index is built
    // then: the finding carries null sources rather than throwing
    const index = indexOf(rootPairPage());
    expect(index.findings).toHaveLength(1);
    expect(index.findings[0]?.source).toBeNull();
    expect(index.findings[0]?.otherSource).toBeNull();
  });
});

describe('(a11y) the finding text', () => {
  it('when a stacked pair is not aligned, should name the edge, values and source', () => {
    // given: the stacked mismatch whose left edges are 7px and 23px
    // when: the finding is written
    // then: the text carries the edge, both values, the gap and the unmatched source
    const text = indexOf(stackedPage()).findings[0]?.humanText ?? '';
    expect(text).toContain('边缘未对齐');
    expect(text).toContain('7px vs 23px');
    expect(text).toContain('相差 16px');
    expect(text).toContain('padding-left = 7px（未匹配已声明 token）');
    expect(text).toContain('非阻塞');
  });

  it('when a pair has no source, should say so instead of leaving a blank', () => {
    // given: two root-level images with no numbered parent
    // when: the finding is written
    // then: both sides name the absent container
    const text = indexOf(rootPairPage()).findings[0]?.humanText ?? '';
    expect(text).toContain('没有可指认的父容器');
    expect(text.match(/没有可指认的父容器/gu)).toHaveLength(2);
  });

  it('when the pair is side by side, should describe the top-edge source', () => {
    // given: the side-by-side mismatch whose parents differ in padding-top
    // when: the finding is written
    // then: the text names padding-top, not the left padding
    const text = indexOf(sideBySidePage()).findings[0]?.humanText ?? '';
    expect(text).toContain('padding-top = 12px（未匹配已声明 token）');
    expect(text).toContain('12px vs 20px');
  });
});
