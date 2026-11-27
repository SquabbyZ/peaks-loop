/**
 * The QD1 cut: which measured elements are visual objects, and which are folded.
 *
 * A visual object is what a person can point at — a heading, a paragraph, a
 * widget, a painted card/form panel — never a DOM element and never a component
 * instance. The rules are structural, with no selector and no fixture-specific
 * tag:
 *
 *   1. an atomic widget (img/svg/canvas/video/iframe/input/textarea/select/hr)
 *      is an object on its own;
 *   2. an element is a TEXT BLOCK when it is not inline, its subtree has text,
 *      and no descendant block also has text — so `div > h2` yields the heading,
 *      not the wrapper, and `p > span` yields the paragraph, not the span;
 *   3. an outermost PAINTED box (a background distinct from the body's, a
 *      visible border, or a shadow) is one object and folds every descendant
 *      into it — a card with a title and body is one node, not three.
 *
 * Numbering, the parent chain and anchors live in `layout-objects.ts` /
 * `layout-align.ts`; this module only answers "which elements are objects".
 */
import type { LayoutElement } from './layout-geometry.js';

const ROLE_BY_TAG: Readonly<Record<string, string>> = {
  body: 'document',
  h1: 'heading',
  h2: 'heading',
  h3: 'heading',
  h4: 'heading',
  h5: 'heading',
  h6: 'heading',
  p: 'paragraph',
  a: 'link',
  button: 'button',
  label: 'label',
  img: 'img',
  svg: 'img',
  canvas: 'img',
  video: 'img',
  iframe: 'document',
  input: 'textbox',
  textarea: 'textbox',
  select: 'combobox',
  ul: 'list',
  ol: 'list',
  li: 'listitem',
  table: 'table',
  form: 'form',
  nav: 'navigation',
  main: 'main',
  header: 'banner',
  footer: 'contentinfo',
  aside: 'complementary',
  section: 'region',
  article: 'article',
  dialog: 'dialog',
  figure: 'figure',
  figcaption: 'caption',
  blockquote: 'blockquote',
  pre: 'code',
  code: 'code'
};

/** Replaced content a person points at, independent of any text it carries. */
const ATOMIC_TAGS: ReadonlySet<string> = new Set([
  'img',
  'svg',
  'canvas',
  'video',
  'iframe',
  'input',
  'textarea',
  'select',
  'hr'
]);

/** Tags that are never the outermost structural container of a page. */
const NEVER_PAINTED_OBJECT: ReadonlySet<string> = new Set(['html', 'body']);

/** The explicit ARIA role wins; otherwise the tag's implicit role; else generic. */
export function roleOf(tag: string, ariaRole: string | null): string {
  if (ariaRole !== null && ariaRole.trim() !== '') return ariaRole.trim().toLowerCase();
  return ROLE_BY_TAG[tag] ?? 'generic';
}

/** Inline and display:contents elements are never their own block-level object. */
function isBox(display: string): boolean {
  return display !== 'inline' && display !== 'contents';
}

/** One child-index adjacency list for the captured elements. */
function childrenOf(elements: readonly LayoutElement[]): number[][] {
  const children = elements.map((): number[] => []);
  elements.forEach((element, index) => {
    if (element.parent >= 0) children[element.parent]?.push(index);
  });
  return children;
}

/** True when a descendant is itself a non-inline block carrying text. */
function hasBlockTextDescendant(
  index: number,
  elements: readonly LayoutElement[],
  children: readonly number[][]
): boolean {
  for (const child of children[index] ?? []) {
    const element = elements[child];
    if (element === undefined) continue;
    if (isBox(element.display) && element.text !== '') return true;
    if (hasBlockTextDescendant(child, elements, children)) return true;
  }
  return false;
}

function hasPaintedAncestor(index: number, elements: readonly LayoutElement[]): boolean {
  let parent = elements[index]?.parent ?? -1;
  while (parent >= 0) {
    const ancestor = elements[parent];
    if (ancestor?.painted === true && !NEVER_PAINTED_OBJECT.has(ancestor.tag)) return true;
    parent = ancestor?.parent ?? -1;
  }
  return false;
}

/** The outermost painted boxes: each is one object that absorbs its subtree. */
function paintedObjects(elements: readonly LayoutElement[]): number[] {
  const picked: number[] = [];
  elements.forEach((element, index) => {
    if (!element.painted || !isBox(element.display)) return;
    if (NEVER_PAINTED_OBJECT.has(element.tag) || element.text === '') return;
    if (hasPaintedAncestor(index, elements)) return;
    picked.push(index);
  });
  return picked;
}

function absorbDescendants(
  index: number,
  children: readonly number[][],
  absorbed: Set<number>
): void {
  for (const child of children[index] ?? []) {
    absorbed.add(child);
    absorbDescendants(child, children, absorbed);
  }
}

function isObjectElement(
  index: number,
  elements: readonly LayoutElement[],
  children: readonly number[][],
  absorbed: ReadonlySet<number>
): boolean {
  const element = elements[index];
  if (element === undefined || absorbed.has(index)) return false;
  if (ATOMIC_TAGS.has(element.tag)) return true;
  if (!isBox(element.display) || element.text === '') return false;
  return !hasBlockTextDescendant(index, elements, children);
}

/**
 * Select the visual objects of one measured document. Painted roots win over
 * their descendants, so a painted card contributes exactly one object.
 */
export function selectObjects(elements: readonly LayoutElement[]): Set<number> {
  const children = childrenOf(elements);
  const painted = paintedObjects(elements);
  const absorbed = new Set<number>();
  for (const index of painted) absorbDescendants(index, children, absorbed);
  const objects = new Set<number>(painted);
  elements.forEach((_element, index) => {
    if (isObjectElement(index, elements, children, absorbed)) objects.add(index);
  });
  return objects;
}
