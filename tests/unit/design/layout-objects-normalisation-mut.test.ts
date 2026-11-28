/**
 * Boundary assertions for the layout cut: numbering and text normalisation.
 *
 * These tests distinguish the production branches of `layout-objects.ts` from
 * their mutants: the whitespace-collapse variants, the 80-character text cap,
 * the empty-text defaults, the ancestor-chain walk and the document-order sort.
 * They assert the observable shape of the exported `cutVisualObjects` and
 * `structuralId` only.
 *
 * Four-dimension split: render (numbered node shape) and behavior (text
 * normalisation, id composition). Integration is omitted because the module is
 * a pure function with no fs, subprocess, network, environment or clock
 * boundary; a11y is omitted because the cut exposes no human-facing text.
 */
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  cutVisualObjects,
  structuralId,
  type CutNode
} from '../../../src/services/design/layout/layout-objects.js';
import type {
  LayoutElement,
  LayoutGeometry,
  PaddingSides
} from '../../../src/services/design/layout/layout-geometry.js';

declareDimensions(
  'tests/unit/design/layout-objects-normalisation-mut.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason:
        'the cut is a pure function with no fs, subprocess, network, environment or clock boundary'
    },
    { dim: 'a11y', reason: 'the cut exposes no human-facing text or exit code' }
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

function cutOf(elements: LayoutElement[], route = '/mut'): CutNode[] {
  return cutVisualObjects(geometryOf(elements, route));
}

describe('(render) the numbered cut', () => {
  it('when a page is cut, should number only its ancestors and objects in order', () => {
    // given: html > body > section > heading, so two ancestors are containers
    // when: the geometry is cut
    // then: html is excluded and the remaining nodes keep document order
    const nodes = cutOf([
      element({ parent: -1, tag: 'html', text: 'Title' }),
      element({ parent: 0, tag: 'body', text: 'Title' }),
      element({ parent: 1, tag: 'section', ownText: 'Section A', text: 'Title' }),
      element({ parent: 2, tag: 'h2', ownText: 'Title', text: 'Title' })
    ]);
    expect(nodes.map((node) => node.tag)).toEqual(['body', 'section', 'h2']);
    expect(nodes.map((node) => node.kind)).toEqual(['container', 'container', 'object']);
  });

  it('when container and object indices interleave, should still emit document order', () => {
    // given: container, object, container, object in document order
    // when: the geometry is cut
    // then: the nodes follow the element indices, not the container-first grouping
    const nodes = cutOf([
      element({
        parent: -1,
        tag: 'div',
        text: 'A B',
        box: { left: 0, top: 0, right: 390, bottom: 80 }
      }),
      element({
        parent: 0,
        tag: 'p',
        ownText: 'A',
        text: 'A',
        box: { left: 0, top: 0, right: 390, bottom: 20 }
      }),
      element({
        parent: -1,
        tag: 'div',
        text: 'C D',
        box: { left: 0, top: 80, right: 390, bottom: 160 }
      }),
      element({
        parent: 2,
        tag: 'p',
        ownText: 'C',
        text: 'C',
        box: { left: 0, top: 80, right: 390, bottom: 100 }
      })
    ]);
    expect(nodes.map((node) => node.tag)).toEqual(['div', 'p', 'div', 'p']);
  });

  it('when a node is numbered, should fingerprint its real ancestor roles and text', () => {
    // given: html > body > section carrying direct text, holding a heading
    // when: the geometry is cut
    // then: each id equals the fingerprint of its true role chain and own text
    const nodes = cutOf([
      element({ parent: -1, tag: 'html', text: 'Title' }),
      element({ parent: 0, tag: 'body', text: 'Title' }),
      element({ parent: 1, tag: 'section', ownText: 'Section A', text: 'Title' }),
      element({ parent: 2, tag: 'h2', ownText: 'Title', text: 'Title' })
    ]);
    const body = nodes.find((node) => node.tag === 'body');
    const section = nodes.find((node) => node.tag === 'section');
    const heading = nodes.find((node) => node.tag === 'h2');
    expect(body?.id).toBe(structuralId('/mut', ['generic'], 'document', ''));
    expect(section?.id).toBe(structuralId('/mut', ['generic', 'document'], 'region', 'Section A'));
    expect(section?.ownText).toBe('Section A');
    expect(section?.text).toBe('Section A');
    expect(heading?.id).toBe(
      structuralId('/mut', ['generic', 'document', 'region'], 'heading', 'Title')
    );
    expect(heading?.text).toBe('Title');
  });

  it('when a container is the root element, should still link its object to it', () => {
    // given: a section at index 0 (no html wrapper) holding two headings
    // when: the geometry is cut
    // then: the section is a numbered container and each heading names it as parent
    const nodes = cutOf([
      element({ parent: -1, tag: 'section', text: 'A B' }),
      element({ parent: 0, tag: 'h2', ownText: 'A', text: 'A' }),
      element({ parent: 0, tag: 'h2', ownText: 'B', text: 'B' })
    ]);
    const section = nodes.find((node) => node.tag === 'section');
    const heading = nodes.find((node) => node.tag === 'h2');
    expect(section?.kind).toBe('container');
    expect(heading?.parentId).toBe(section?.id);
    expect(heading?.parentChain).toEqual([section?.id]);
  });

  it('when two objects share one fingerprint, should suffix only the second', () => {
    // given: two paragraphs with identical text under the same parent
    // when: the geometry is cut
    // then: the first id is bare and the second carries the occurrence suffix
    const nodes = cutOf([
      element({ parent: -1, tag: 'section', text: 'Same Same' }),
      element({ parent: 0, tag: 'p', ownText: 'Same', text: 'Same' }),
      element({ parent: 0, tag: 'p', ownText: 'Same', text: 'Same' })
    ]);
    const ids = nodes.filter((node) => node.kind === 'object').map((node) => node.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^[0-9a-f]{12}$/);
    expect(ids[0]).toBe(structuralId('/mut', ['region'], 'paragraph', 'Same'));
    expect(ids[1]).toBe(`${ids[0] ?? 'missing'}-2`);
  });
});

describe('(behavior) text normalisation', () => {
  it('when text differs only in whitespace, should collapse it to one id', () => {
    // given: five spellings of the same two words
    // when: structural ids are computed
    // then: every spelling is the same fingerprint
    const base = structuralId('/r', ['region'], 'paragraph', 'alpha beta');
    expect(structuralId('/r', ['region'], 'paragraph', 'alpha  beta')).toBe(base);
    expect(structuralId('/r', ['region'], 'paragraph', 'alpha\tbeta')).toBe(base);
    expect(structuralId('/r', ['region'], 'paragraph', 'alpha\nbeta')).toBe(base);
    expect(structuralId('/r', ['region'], 'paragraph', ' alpha beta ')).toBe(base);
  });

  it('when text content differs, should produce a different id', () => {
    // given: three distinct texts, one without the separating space
    // when: structural ids are computed
    // then: the text is part of the fingerprint and the space is kept
    expect(structuralId('/r', ['region'], 'paragraph', 'alpha beta')).not.toBe(
      structuralId('/r', ['region'], 'paragraph', 'alpha gamma')
    );
    expect(structuralId('/r', ['region'], 'paragraph', 'alpha beta')).not.toBe(
      structuralId('/r', ['region'], 'paragraph', 'alphabeta')
    );
  });

  it('when text differs only after the 80-character cap, should keep one id', () => {
    // given: two texts sharing their first 80 characters, differing at 81
    // when: structural ids are computed
    // then: the cap makes them identical
    const head = 'x'.repeat(80);
    expect(structuralId('/r', ['region'], 'paragraph', `${head}A`)).toBe(
      structuralId('/r', ['region'], 'paragraph', `${head}B`)
    );
  });

  it('when any fingerprint component differs, should produce a different id', () => {
    // given: a baseline fingerprint and one variant per component
    // when: structural ids are computed
    // then: route, ancestor chain, role and text each shift the id
    const base = structuralId('/r', ['region'], 'paragraph', 'alpha');
    expect(base).toMatch(/^[0-9a-f]{12}$/);
    expect(structuralId('/other', ['region'], 'paragraph', 'alpha')).not.toBe(base);
    expect(structuralId('/r', ['article'], 'paragraph', 'alpha')).not.toBe(base);
    expect(structuralId('/r', ['region'], 'heading', 'alpha')).not.toBe(base);
    expect(structuralId('/r', ['region'], 'paragraph', 'beta')).not.toBe(base);
  });

  it('when components would run together, should still separate them', () => {
    // given: fingerprints whose components concatenate to the same characters
    // when: structural ids are computed
    // then: the separators keep them distinct
    expect(structuralId('rx', [], 'y', 't')).not.toBe(structuralId('r', ['x'], 'y', 't'));
    expect(structuralId('/r', ['a', 'b'], 'p', 't')).not.toBe(structuralId('/r', ['ab'], 'p', 't'));
  });
});
