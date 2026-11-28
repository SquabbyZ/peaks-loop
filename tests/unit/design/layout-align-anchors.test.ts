import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  buildLayoutIndex,
  type LayoutIndex
} from '../../../src/services/design/layout/layout-align.js';
import {
  captureLayoutGeometry,
  LAYOUT_GEOMETRY_SCRIPT,
  type ElementBox,
  type LayoutElement,
  type LayoutGeometry,
  type PlaywrightBrowser
} from '../../../src/services/design/layout/layout-geometry.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';

declareDimensions('tests/unit/design/layout-align-anchors.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/layout');
const TOKENS = readSpacingTokens(FIXTURES);

function readGeometry(name: string): LayoutGeometry {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as LayoutGeometry;
}

/** Every field present so a partial fixture stays readable. */
function el(part: Partial<LayoutElement> & { parent: number; tag: string }): LayoutElement {
  return {
    ariaRole: null,
    display: 'block',
    ownText: '',
    text: '',
    box: { left: 0, top: 0, right: 390, bottom: 20 },
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    painted: false,
    ...part
  };
}

function indexOf(geometry: LayoutGeometry): LayoutIndex {
  return buildLayoutIndex({ geometry, spacingTokens: TOKENS });
}

/** Two root-level paragraphs with the given boxes, in document order. */
function pairGeometry(route: string, first: ElementBox, second: ElementBox): LayoutGeometry {
  return {
    route,
    viewport: { width: 390, height: 844 },
    elements: [
      el({ parent: -1, tag: 'p', ownText: 'A', text: 'A', box: first }),
      el({ parent: -1, tag: 'p', ownText: 'B', text: 'B', box: second })
    ]
  };
}

const MISMATCHED = readGeometry('geometry-mismatched.json');
const ALIGNED = readGeometry('geometry-aligned.json');

function fakeLauncher(elements: readonly LayoutElement[]): () => Promise<PlaywrightBrowser> {
  const page = {
    goto: async (): Promise<unknown> => undefined,
    evaluate: async <T>(): Promise<T> => elements as unknown as T,
    close: async (): Promise<void> => undefined
  };
  return async () => ({
    newPage: async (): Promise<typeof page> => page,
    close: async (): Promise<void> => undefined
  });
}

describe('(render) the numbered layout index', () => {
  it('when a measured route is cut, should give every node a unique structural id', () => {
    // given: the fixture route measured at 390 with two headings under different parents
    // when: the layout index is built
    // then: every node carries a 12-hex structural id and no id repeats
    const ids = indexOf(MISMATCHED).nodes.map((node) => node.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{12}(-\d+)?$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('when a route has two comparable headings, should emit an anchor naming the parent token', () => {
    // given: the mismatched fixture, whose parents declare space.section 16px and space.roomy 24px
    // when: the layout index is built
    // then: at least one anchor carries a parent node id and a token name/value
    const index = indexOf(MISMATCHED);
    const sourced = index.anchors.find(
      (anchor) => anchor.source !== null && anchor.source.token !== null
    );
    expect(sourced?.edge).toBe('left');
    expect(sourced?.source?.parentId).toMatch(/^[0-9a-f]{12}$/);
    expect(sourced?.source?.token?.name).toBe('space.section');
    expect(sourced?.source?.token?.value).toBe('16px');
    const ids = new Set(index.nodes.map((node) => node.id));
    expect(ids.has(sourced?.source?.parentId ?? '')).toBe(true);
  });

  it('when the same input is rendered twice, should produce the same ids in the same order', () => {
    // given: one measured geometry document
    // when: the index is built twice from the same input
    // then: the id sequence is identical
    const first = indexOf(MISMATCHED).nodes.map((node) => node.id);
    const second = indexOf(MISMATCHED).nodes.map((node) => node.id);
    expect(second).toEqual(first);
  });

  it('when an object is numbered, should record its complete container chain', () => {
    // given: a heading whose ancestors are body and its section
    // when: the layout index is built
    // then: the heading's parent chain resolves to real nodes and ends at its parent
    const index = indexOf(MISMATCHED);
    const heading = index.nodes.find((node) => node.kind === 'object' && node.tag === 'h2');
    expect(heading?.kind).toBe('object');
    const ids = new Set(index.nodes.map((node) => node.id));
    expect(heading?.parentChain.length).toBeGreaterThan(0);
    for (const id of heading?.parentChain ?? []) expect(ids.has(id)).toBe(true);
    expect(heading?.parentChain.at(-1)).toBe(heading?.parentId);
  });

  it('when the mismatched fixture is judged, should report a not-aligned left edge from both parents', () => {
    // given: two headings whose parents differ only in padding-left (16px vs 24px)
    // when: the layout index is built
    // then: one finding names both parent ids and both spacing tokens
    const index = indexOf(MISMATCHED);
    const findings = index.findings.filter((finding) => finding.code === 'layout-not-aligned');
    expect(findings).toHaveLength(1);
    const finding = findings[0];
    expect(finding?.edge).toBe('left');
    expect(finding?.difference).toBe(8);
    expect(finding?.source?.parentId).toMatch(/^[0-9a-f]{12}(-\d+)?$/);
    expect(finding?.otherSource?.parentId).toMatch(/^[0-9a-f]{12}(-\d+)?$/);
    expect(finding?.source?.parentId).not.toBe(finding?.otherSource?.parentId);
    expect(finding?.source?.token?.name).toBe('space.section');
    expect(finding?.source?.token?.value).toBe('16px');
    expect(finding?.otherSource?.token?.name).toBe('space.roomy');
    expect(finding?.otherSource?.token?.value).toBe('24px');
  });

  it('when both parents declare the same token, should report aligned and no finding', () => {
    // given: the control fixture, whose parents both declare space.section 16px
    // when: the layout index is built
    // then: the pair is aligned
    const index = indexOf(ALIGNED);
    expect(index.anchors.length).toBeGreaterThan(0);
    expect(index.anchors.every((anchor) => anchor.verdict === 'aligned')).toBe(true);
  });

  it('when both parents declare the same token, should produce zero not-aligned findings', () => {
    // given: the control fixture, identical in structure to the mismatch arm
    // when: the layout index is built
    // then: the zero false-positive count is asserted on its own
    expect(indexOf(ALIGNED).findings).toHaveLength(0);
  });
});

describe('(behavior) cutting and attribution', () => {
  it('when an inline span carries the text, should fold it into the block paragraph', () => {
    // given: a paragraph whose whole text sits inside a span
    // when: the geometry is cut
    // then: the paragraph is the object and the span is never numbered
    const geometry: LayoutGeometry = {
      route: '/inline',
      viewport: { width: 390, height: 844 },
      elements: [
        el({ parent: -1, tag: 'html', text: 'Hello' }),
        el({ parent: 0, tag: 'body', text: 'Hello' }),
        el({
          parent: 1,
          tag: 'div',
          text: 'Hello',
          padding: { top: 0, right: 0, bottom: 0, left: 16 }
        }),
        el({
          parent: 2,
          tag: 'p',
          ownText: '',
          text: 'Hello',
          box: { left: 16, top: 0, right: 300, bottom: 20 }
        }),
        el({
          parent: 3,
          tag: 'span',
          display: 'inline',
          text: 'Hello',
          box: { left: 16, top: 0, right: 60, bottom: 20 }
        })
      ]
    };
    const index = indexOf(geometry);
    const objects = index.nodes.filter((node) => node.kind === 'object');
    expect(objects.map((node) => node.tag)).toEqual(['p']);
    expect(index.nodes.some((node) => node.tag === 'span')).toBe(false);
  });

  it('when the page itself is painted, should still fold a painted card into one node', () => {
    // given: a bordered card on a page whose body carries its own background
    // when: the geometry is cut
    // then: the page-level paint does not swallow the card and the card folds its children
    const geometry: LayoutGeometry = {
      route: '/card',
      viewport: { width: 390, height: 844 },
      elements: [
        el({ parent: -1, tag: 'html', text: 'Card title Body copy' }),
        el({ parent: 0, tag: 'body', text: 'Card title Body copy', painted: true }),
        el({
          parent: 1,
          tag: 'div',
          text: 'Card title Body copy',
          painted: true,
          box: { left: 0, top: 0, right: 390, bottom: 120 }
        }),
        el({ parent: 2, tag: 'h3', text: 'Card title' }),
        el({ parent: 2, tag: 'p', text: 'Body copy' })
      ]
    };
    const objects = indexOf(geometry).nodes.filter((node) => node.kind === 'object');
    expect(objects).toHaveLength(1);
    expect(objects[0]?.tag).toBe('div');
  });

  it('when a painted card contains a heading and a paragraph, should fold them into one card node', () => {
    // given: a bordered card holding a heading and a paragraph
    // when: the geometry is cut
    // then: the card is the only object and its children are not numbered
    const geometry: LayoutGeometry = {
      route: '/card',
      viewport: { width: 390, height: 844 },
      elements: [
        el({ parent: -1, tag: 'html', text: 'Card title Body copy' }),
        el({ parent: 0, tag: 'body', text: 'Card title Body copy' }),
        el({
          parent: 1,
          tag: 'div',
          text: 'Card title Body copy',
          painted: true,
          box: { left: 0, top: 0, right: 390, bottom: 120 }
        }),
        el({
          parent: 2,
          tag: 'h3',
          text: 'Card title',
          box: { left: 16, top: 16, right: 300, bottom: 40 }
        }),
        el({
          parent: 2,
          tag: 'p',
          text: 'Body copy',
          box: { left: 16, top: 40, right: 300, bottom: 100 }
        })
      ]
    };
    const index = indexOf(geometry);
    const objects = index.nodes.filter((node) => node.kind === 'object');
    expect(objects).toHaveLength(1);
    expect(objects[0]?.tag).toBe('div');
    expect(index.nodes.some((node) => node.tag === 'h3' || node.tag === 'p')).toBe(false);
  });

  it('when no declared token matches the parent padding, should report the value without a token', () => {
    // given: the mismatched fixture judged against only the space.roomy token
    // when: the layout index is built
    // then: the 16px source keeps its measured value but names no token
    const onlyRoomy = TOKENS.filter((token) => token.name === 'space.roomy');
    const index = buildLayoutIndex({ geometry: MISMATCHED, spacingTokens: onlyRoomy });
    const finding = index.findings.find((entry) => entry.code === 'layout-not-aligned');
    expect(finding?.source?.token).toBeNull();
    expect(finding?.source?.value).toBe('16px');
  });

  it('when two structurally identical twins exist, should disambiguate their ids by occurrence', () => {
    // given: two headings with identical text under structurally identical parents
    // when: the layout index is built
    // then: ids stay unique and an occurrence suffix carries the second twin
    const twin: LayoutGeometry = {
      route: '/twins',
      viewport: { width: 390, height: 844 },
      elements: [
        el({ parent: -1, tag: 'html', text: 'Same' }),
        el({ parent: 0, tag: 'body', text: 'Same' }),
        el({
          parent: 1,
          tag: 'div',
          text: 'Same',
          padding: { top: 24, right: 24, bottom: 24, left: 16 },
          box: { left: 0, top: 0, right: 390, bottom: 73 }
        }),
        el({
          parent: 2,
          tag: 'h2',
          ownText: 'Same',
          text: 'Same',
          box: { left: 16, top: 24, right: 366, bottom: 49 }
        }),
        el({
          parent: 1,
          tag: 'div',
          text: 'Same',
          padding: { top: 24, right: 24, bottom: 24, left: 16 },
          box: { left: 0, top: 73, right: 390, bottom: 146 }
        }),
        el({
          parent: 4,
          tag: 'h2',
          ownText: 'Same',
          text: 'Same',
          box: { left: 16, top: 97, right: 366, bottom: 122 }
        })
      ]
    };
    const index = indexOf(twin);
    const ids = index.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id) => /-[2-9]$/.test(id))).toBe(true);
  });

  it('when the later object sits above, should pair the touching edges on the left', () => {
    // given: two root-level paragraphs where the second ends at the first's top
    // when: the layout index is built
    // then: the second stacked comparison is the one that detects the adjacency
    const index = indexOf(
      pairGeometry(
        '/reversed-stack',
        { left: 7, top: 40, right: 200, bottom: 60 },
        { left: 23, top: 20, right: 200, bottom: 40 }
      )
    );
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('left');
  });

  it('when the later object sits to the left, should pair the touching edges on top', () => {
    // given: two paragraphs whose second right edge meets the first left edge
    // when: the layout index is built
    // then: the second side-by-side comparison detects the adjacency
    const index = indexOf(
      pairGeometry(
        '/reversed-row',
        { left: 100, top: 0, right: 200, bottom: 20 },
        { left: 40, top: 0, right: 100, bottom: 20 }
      )
    );
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('top');
  });

  it('when two horizontal boxes touch, should pair them on the top edge', () => {
    // given: two paragraphs whose first right edge meets the second left edge
    // when: the layout index is built
    // then: touching counts as side by side
    const index = indexOf(
      pairGeometry(
        '/touching-row',
        { left: 0, top: 0, right: 100, bottom: 20 },
        { left: 100, top: 0, right: 200, bottom: 20 }
      )
    );
    expect(index.anchors).toHaveLength(1);
    expect(index.anchors[0]?.edge).toBe('top');
  });
});

describe('(integration) the contract and the capture seam', () => {
  it('when the injected geometry script is parsed, should be a syntactically valid expression', () => {
    // given: the script string the capture evaluates inside the page
    // when: a JavaScript parser parses it
    // then: it has no syntax diagnostics, so a syntax error cannot stay hidden until a live page
    const parsed = ts.transpileModule(`(${LAYOUT_GEOMETRY_SCRIPT});`, {
      compilerOptions: { target: ts.ScriptTarget.ESNext },
      reportDiagnostics: true
    });
    expect(parsed.diagnostics ?? []).toEqual([]);
  });

  it('when the fixture token contract is read, should return only literal pixel spacing tokens', () => {
    // given: a tokens.json with three px spacing tokens and one rem token
    // when: the token reader runs on the fixture directory
    // then: the px tokens are reported sorted and the rem token is skipped
    expect(readSpacingTokens(FIXTURES)).toEqual([
      { name: 'space.page', value: '0px', px: 0 },
      { name: 'space.roomy', value: '24px', px: 24 },
      { name: 'space.section', value: '16px', px: 16 }
    ]);
  });

  it('when a page is captured through an injected browser, should return the measured geometry', async () => {
    // given: an injected browser whose evaluation yields the mismatched elements
    // when: the capture runs at the given viewport
    // then: the result carries the route, the viewport and the elements
    const result = await captureLayoutGeometry({
      route: '/',
      url: 'http://127.0.0.1/fixture.html',
      viewport: { width: 390, height: 844 },
      launch: fakeLauncher(MISMATCHED.elements)
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geometry.route).toBe('/');
      expect(result.geometry.viewport).toEqual({ width: 390, height: 844 });
      expect(result.geometry.elements).toHaveLength(MISMATCHED.elements.length);
    }
  });

  it('when the browser cannot launch, should return a reason instead of throwing', async () => {
    // given: a launcher that rejects
    // when: the capture runs
    // then: the result is an error value naming the launch failure
    const result = await captureLayoutGeometry({
      route: '/',
      url: 'http://127.0.0.1/fixture.html',
      viewport: { width: 390, height: 844 },
      launch: async () => {
        throw new Error('no chromium');
      }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('could not launch');
  });

  it('when the page navigation fails, should return a reason instead of throwing', async () => {
    // given: a browser whose page rejects on goto
    // when: the capture runs
    // then: the result is an error value and the browser still closes
    let closed = false;
    const result = await captureLayoutGeometry({
      route: '/',
      url: 'http://127.0.0.1/fixture.html',
      viewport: { width: 390, height: 844 },
      launch: async () => ({
        newPage: async () => ({
          goto: async (): Promise<unknown> => {
            throw new Error('navigation timeout');
          },
          evaluate: async <T>(): Promise<T> => [] as unknown as T,
          close: async (): Promise<void> => undefined
        }),
        close: async (): Promise<void> => {
          closed = true;
        }
      })
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('could not read');
    expect(closed).toBe(true);
  });
});

describe('(a11y) the finding text', () => {
  it('when a finding is produced, should name both parents, both tokens and its non-blocking nature', () => {
    // given: the mismatched fixture
    // when: the finding is written
    // then: the text carries both parent ids, both token names and values, and says it is non-blocking
    const finding = indexOf(MISMATCHED).findings[0];
    expect(finding?.code).toBe('layout-not-aligned');
    const text = finding?.humanText ?? '';
    expect(text).toContain(finding?.source?.parentId ?? 'missing-parent');
    expect(text).toContain(finding?.otherSource?.parentId ?? 'missing-peer');
    expect(text).toContain('space.section');
    expect(text).toContain('16px');
    expect(text).toContain('space.roomy');
    expect(text).toContain('24px');
    expect(text).toContain('非阻塞');
    expect(text).toContain('不进入 design check 判定');
  });
});
