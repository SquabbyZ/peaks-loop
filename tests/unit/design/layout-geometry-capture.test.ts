import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { buildLayoutIndex } from '../../../src/services/design/layout/layout-align.js';
import {
  buildLayoutEntry,
  freshnessOf,
  type EntryFreshness
} from '../../../src/services/design/layout/layout-graph.js';
import { serializeEntry } from '../../../src/services/design/layout/layout-graph-ascii.js';
import { parseEntry } from '../../../src/services/design/layout/layout-graph-parse.js';
import {
  captureLayoutGeometry,
  LAYOUT_CAPTURE_VERSION,
  LAYOUT_GEOMETRY_SCRIPT,
  LAYOUT_READY_SCRIPT,
  type LayoutElement,
  type LayoutGeometry,
  type PlaywrightBrowser
} from '../../../src/services/design/layout/layout-geometry.js';
import { readSpacingTokens } from '../../../src/services/design/layout/layout-tokens.js';

declareDimensions(
  'tests/unit/design/layout-geometry-capture.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'the capture records geometry and declared identity; it renders no human-facing text'
    }
  ]
);

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../../fixtures/design/layout');
const TOKENS = readSpacingTokens(FIXTURES);
const VIEWPORT = { width: 390, height: 844 };
const URL = 'http://127.0.0.1/fixture.html';

type FakeStyle = Record<string, string>;
type FakeAttribute = { name: string; value: string };
type FakeBox = { left: number; top: number; right: number; bottom: number };
type FakeElement = {
  tagName: string;
  parentElement: FakeElement | null;
  childNodes: { nodeType: number; textContent: string }[];
  textContent: string;
  attributes: FakeAttribute[];
  style: FakeStyle;
  getAttribute: (name: string) => string | null;
  getBoundingClientRect: () => FakeBox;
};

const BASE_STYLE: FakeStyle = {
  display: 'block',
  visibility: 'visible',
  backgroundColor: 'rgba(0, 0, 0, 0)',
  borderTopWidth: '0px',
  borderRightWidth: '0px',
  borderBottomWidth: '0px',
  borderLeftWidth: '0px',
  borderTopStyle: 'none',
  borderRightStyle: 'none',
  borderBottomStyle: 'none',
  borderLeftStyle: 'none',
  boxShadow: 'none',
  paddingTop: '0px',
  paddingRight: '0px',
  paddingBottom: '0px',
  paddingLeft: '0px',
  marginTop: '0px',
  marginRight: '0px',
  marginBottom: '0px',
  marginLeft: '0px'
};

function fakeElement(input: {
  tag: string;
  box: FakeBox;
  text?: string;
  style?: FakeStyle;
  attributes?: Record<string, string>;
  parent?: FakeElement;
}): FakeElement {
  const attributes = Object.entries(input.attributes ?? {}).map(([name, value]) => ({
    name,
    value
  }));
  return {
    tagName: input.tag.toUpperCase(),
    parentElement: input.parent ?? null,
    childNodes: [{ nodeType: 3, textContent: input.text ?? '' }],
    textContent: input.text ?? '',
    attributes,
    style: { ...BASE_STYLE, ...input.style },
    getAttribute: (name) => attributes.find((attribute) => attribute.name === name)?.value ?? null,
    getBoundingClientRect: () => input.box
  };
}

/** One body-only page, enough for the capture to measure something. */
function plainPage(text: string): FakeElement[] {
  return [fakeElement({ tag: 'body', box: { left: 0, top: 0, right: 390, bottom: 844 }, text })];
}

/** A body and one card declaring four-sided spacing and every peaks marker. */
function spacedCard(): FakeElement[] {
  const body = fakeElement({
    tag: 'body',
    box: { left: 0, top: 0, right: 390, bottom: 844 },
    text: 'Card'
  });
  const card = fakeElement({
    tag: 'div',
    parent: body,
    box: { left: 0, top: 0, right: 390, bottom: 120 },
    text: 'Card',
    style: {
      marginTop: '8px',
      marginRight: '10px',
      marginBottom: '12px',
      marginLeft: '14px',
      paddingTop: '4px',
      paddingRight: '6px',
      paddingBottom: '8px',
      paddingLeft: '10px'
    },
    attributes: {
      'data-peaks-object': 'card',
      'data-peaks-component': 'FeatureCard',
      'data-peaks-prop-variant': 'primary',
      'data-peaks-prop-density': 'compact'
    }
  });
  return [body, card];
}

/** Run the injected script against a fake document, as the page would. */
function measuredByScript(elements: FakeElement[]): LayoutElement[] {
  const fakeDocument = { body: elements[0], querySelectorAll: (): FakeElement[] => elements };
  const getComputedStyle = (element: FakeElement): FakeStyle => element.style;
  const measured: unknown = runInNewContext(LAYOUT_GEOMETRY_SCRIPT, {
    document: fakeDocument,
    getComputedStyle
  });
  return measured as LayoutElement[];
}

/** A browser seam that executes the real scripts and records each evaluation. */
function scriptedLauncher(elements: FakeElement[]): {
  launch: () => Promise<PlaywrightBrowser>;
  calls: string[];
} {
  const calls: string[] = [];
  const page = {
    goto: async (): Promise<unknown> => undefined,
    evaluate: async <T>(expression: string): Promise<T> => {
      calls.push(expression);
      const value: unknown =
        expression === LAYOUT_GEOMETRY_SCRIPT ? measuredByScript(elements) : true;
      return value as T;
    },
    close: async (): Promise<void> => undefined
  };
  return {
    launch: async () => ({
      newPage: async (): Promise<typeof page> => page,
      close: async (): Promise<void> => undefined
    }),
    calls
  };
}

async function capture(elements: FakeElement[]): Promise<LayoutGeometry> {
  const { launch } = scriptedLauncher(elements);
  const result = await captureLayoutGeometry({ route: '/', url: URL, viewport: VIEWPORT, launch });
  if (!result.ok) throw new Error(result.reason);
  return result.geometry;
}

function readGeometry(name: string): LayoutGeometry {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as LayoutGeometry;
}

describe('(render) what one element records', () => {
  it('when an element declares four-sided spacing and peaks markers, should record them all', async () => {
    // given: a card carrying margin, padding, an object, a component and two props
    // when: the capture runs through the injected browser seam
    // then: all four sides of both spacing boxes and every declared marker are recorded
    const geometry = await capture(spacedCard());
    const measured = geometry.elements[1];
    expect(measured?.padding).toEqual({ top: 4, right: 6, bottom: 8, left: 10 });
    expect(measured?.margin).toEqual({ top: 8, right: 10, bottom: 12, left: 14 });
    expect(measured?.peaks).toEqual({
      object: 'card',
      component: 'FeatureCard',
      props: { variant: 'primary', density: 'compact' }
    });
  });

  it('when an element declares no peaks marker, should record no peaks field at all', async () => {
    // given: a page whose only element carries no data-peaks attribute
    // when: the capture runs
    // then: the element keeps the legacy shape rather than an empty object
    const geometry = await capture(plainPage('Plain'));
    expect(geometry.elements[0]?.peaks).toBeUndefined();
  });
});

describe('(behavior) the pre-measure wait', () => {
  it('when a page is captured, should await fonts and one frame before measuring', async () => {
    // given: a browser seam that records every evaluation
    // when: the capture runs
    // then: the ready script is evaluated first, then the geometry script
    const { launch, calls } = scriptedLauncher(plainPage('Waiting'));
    await captureLayoutGeometry({ route: '/', url: URL, viewport: VIEWPORT, launch });
    expect(calls).toEqual([LAYOUT_READY_SCRIPT, LAYOUT_GEOMETRY_SCRIPT]);
    expect(LAYOUT_READY_SCRIPT).toContain('document.fonts.ready');
    expect(LAYOUT_READY_SCRIPT).toContain('requestAnimationFrame');
  });
});

describe('(integration) the capture version', () => {
  it('when a capture is written now, should carry the explicit capture version', async () => {
    // given: any page captured today
    // when: the capture product is read
    // then: it declares the current capture format
    const geometry = await capture(plainPage('Version'));
    expect(geometry.captureVersion).toBe(LAYOUT_CAPTURE_VERSION);
    expect(LAYOUT_CAPTURE_VERSION).toBe('2');
  });

  it('when an entry is built, should keep only the version its geometry declares', () => {
    // given: one geometry with no version, one at '1', and one at the current '2'
    // when: each is built into an entry and judged against its own source and tokens
    // then: the two old ones are stale and only the current one is current
    const at = (version?: string): LayoutGeometry => {
      const geometry = readGeometry('geometry-aligned.json');
      if (version === undefined) delete geometry.captureVersion;
      else geometry.captureVersion = version;
      return geometry;
    };
    const judge = (version?: string): EntryFreshness => {
      const geometry = at(version);
      const entry = buildLayoutEntry({
        index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
        geometry,
        state: 'default',
        tokens: TOKENS
      });
      return freshnessOf(entry, { geometry, tokens: TOKENS });
    };
    expect(judge()).toEqual({ status: 'stale', reasons: ['capture-version-outdated'] });
    expect(judge('1')).toEqual({ status: 'stale', reasons: ['capture-version-outdated'] });
    expect(judge(LAYOUT_CAPTURE_VERSION)).toEqual({ status: 'current', reasons: [] });
  });

  it('when a stored entry predates the capture version, should read as stale rather than current', () => {
    // given: the current fixture entry, written and then read with its version marker removed
    // when: the legacy entry is judged against the document it was built from
    // then: it is stale on the capture-version axis alone, with no new error code
    const geometry = readGeometry('geometry-aligned.json');
    const entry = buildLayoutEntry({
      index: buildLayoutIndex({ geometry, spacingTokens: TOKENS }),
      geometry,
      state: 'default',
      tokens: TOKENS
    });
    const written = serializeEntry(entry);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const read = parseEntry(written.text.replace(` capture ${LAYOUT_CAPTURE_VERSION}`, ''));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entry.captureVersion).toBeUndefined();
    expect(freshnessOf(read.entry, { geometry, tokens: TOKENS })).toEqual({
      status: 'stale',
      reasons: ['capture-version-outdated']
    });
  });

  it('when the recorded geometry fixtures are read, should accept them without the new optional fields', () => {
    // given: every geometry fixture on disk, written before margin and peaks existed
    // when: each fixture is cut into a layout index
    // then: every one cuts successfully, so the optional fields broke no fixture
    const names = readdirSync(FIXTURES).filter(
      (name) => name.startsWith('geometry-') && name.endsWith('.json')
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const index = buildLayoutIndex({ geometry: readGeometry(name), spacingTokens: TOKENS });
      expect(index.nodes.length, name).toBeGreaterThan(0);
    }
  });
});
