/**
 * The reader for a rebuilt preview: it parses the emitted HTML, reproduces the
 * boxes from the inline offsets, and returns the same element geometry the
 * capture would have measured. It reads the artifact, never the graph.
 */
import {
  LAYOUT_TEXT_CAP,
  type ElementBox,
  type LayoutElement,
  type LayoutGeometry,
  type PaddingSides,
  type Viewport
} from './layout-geometry.js';
import { TAG_PATTERN, VOID_TAGS } from './layout-preview.js';

const ATTRIBUTE_PATTERN = /([a-z-]+)="([^"]*)"/g;
const SIDE_COUNT = 4;
const PX_SUFFIX = 2;
const BODY_INDEX = 1;
const COMMENT_CLOSE = '-->';

type Parsed = {
  tag: string;
  role: string | null;
  style: string;
  parent: number;
  direct: string[];
};

type Tree = { elements: Parsed[]; children: number[][] };

function unescapeHtml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function attributesOf(source: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    const name = match[1];
    const value = match[2];
    if (name !== undefined && value !== undefined) found.set(name, value);
  }
  return found;
}

function styleMap(style: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const part of style.split(';')) {
    const cut = part.indexOf(':');
    if (cut > 0) found.set(part.slice(0, cut).trim(), part.slice(cut + 1).trim());
  }
  return found;
}

function pxValue(style: Map<string, string>, key: string): number | null {
  const raw = style.get(key);
  if (raw === undefined || !raw.endsWith('px')) return null;
  const value = Number(raw.slice(0, -PX_SUFFIX));
  return Number.isFinite(value) ? value : null;
}

function paddingOf(style: Map<string, string>): PaddingSides | null {
  const raw = style.get('padding');
  if (raw === undefined) return null;
  const parts = raw
    .split(' ')
    .map((part) => (part.endsWith('px') ? Number(part.slice(0, -PX_SUFFIX)) : Number.NaN));
  if (parts.length !== SIDE_COUNT || parts.some((value) => !Number.isFinite(value))) return null;
  return { top: parts[0] ?? 0, right: parts[1] ?? 0, bottom: parts[2] ?? 0, left: parts[3] ?? 0 };
}

function findTagEnd(html: string, start: number): number {
  const end = html.indexOf('>', start);
  return end === -1 ? html.length : end;
}

/** One element from one opening tag, linked to the element on top of the stack. */
function openElement(raw: string, tree: Tree, stack: number[]): boolean {
  const space = raw.search(/\s/);
  const tag = (space === -1 ? raw : raw.slice(0, space)).toLowerCase();
  const parent = stack[stack.length - 1];
  if (parent === undefined || !TAG_PATTERN.test(tag)) return false;
  const attributes = attributesOf(raw);
  const index = tree.elements.length;
  tree.elements.push({
    tag,
    role: attributes.get('role') ?? null,
    style: attributes.get('style') ?? '',
    parent,
    direct: []
  });
  tree.children.push([]);
  tree.children[parent]?.push(index);
  if (!VOID_TAGS.has(tag)) stack.push(index);
  return true;
}

function appendText(tree: Tree, stack: readonly number[], text: string): void {
  const top = stack[stack.length - 1];
  const element = top === undefined ? undefined : tree.elements[top];
  if (element !== undefined && text !== '') element.direct.push(unescapeHtml(text));
}

/** Close one element; a false result means the document closed out of order. */
function closeElement(tree: Tree, stack: number[], raw: string): { ok: boolean; body: boolean } {
  const closing = raw.slice(1).trim().toLowerCase();
  const top = stack.pop();
  if (top === undefined || tree.elements[top]?.tag !== closing) return { ok: false, body: false };
  return { ok: true, body: closing === 'body' };
}

/** Skip a comment node; the returned cursor is where scanning continues. */
function skipComment(html: string, next: number): number {
  const close = html.indexOf(COMMENT_CLOSE, next);
  return close === -1 ? html.length : close + COMMENT_CLOSE.length;
}

function walkTree(html: string, bodyStart: number): Tree | null {
  const tree: Tree = {
    elements: [
      { tag: 'html', role: null, style: '', parent: -1, direct: [] },
      { tag: 'body', role: null, style: '', parent: 0, direct: [] }
    ],
    children: [[BODY_INDEX], []]
  };
  const stack = [BODY_INDEX];
  let cursor = bodyStart;
  while (cursor < html.length) {
    const next = html.indexOf('<', cursor);
    appendText(tree, stack, next === -1 ? html.slice(cursor) : html.slice(cursor, next));
    if (next === -1) break;
    if (html.startsWith('<!--', next)) {
      cursor = skipComment(html, next);
      continue;
    }
    const tagEnd = findTagEnd(html, next);
    const raw = html.slice(next + 1, tagEnd);
    cursor = tagEnd + 1;
    if (raw.startsWith('/')) {
      const closed = closeElement(tree, stack, raw);
      if (!closed.ok) return null;
      if (closed.body) return tree;
      continue;
    }
    if (!openElement(raw, tree, stack)) return null;
  }
  return stack.length === 1 ? tree : null;
}

function subtreeText(index: number, children: readonly number[][], own: readonly string[]): string {
  const parts = [own[index] ?? ''];
  for (const child of children[index] ?? []) parts.push(subtreeText(child, children, own));
  return parts.join(' ');
}

type Body = {
  attributes: Map<string, string>;
  box: ElementBox;
  padding: PaddingSides;
  start: number;
};

function readBody(html: string): Body | null {
  const match = /<body\b([^>]*)>/.exec(html);
  if (match === null) return null;
  const attributes = attributesOf(match[1] ?? '');
  const style = styleMap(attributes.get('style') ?? '');
  const left = pxValue(style, 'left');
  const top = pxValue(style, 'top');
  const width = pxValue(style, 'width');
  const height = pxValue(style, 'height');
  const padding = paddingOf(style);
  if (left === null || top === null || width === null || height === null || padding === null) {
    return null;
  }
  return {
    attributes,
    box: { left, top, right: left + width, bottom: top + height },
    padding,
    start: match.index + (match[0] ?? '').length
  };
}

function boxOf(
  element: Parsed,
  parent: ElementBox
): { box: ElementBox; padding: PaddingSides } | null {
  const style = styleMap(element.style);
  const left = pxValue(style, 'left');
  const top = pxValue(style, 'top');
  const width = pxValue(style, 'width');
  const height = pxValue(style, 'height');
  const padding = paddingOf(style);
  if (left === null || top === null || width === null || height === null || padding === null) {
    return null;
  }
  return {
    box: {
      left: parent.left + left,
      top: parent.top + top,
      right: parent.left + left + width,
      bottom: parent.top + top + height
    },
    padding
  };
}

function measureTree(
  tree: Tree,
  body: Body,
  viewport: Viewport
): { elements: LayoutElement[] } | { reason: string } {
  const own = tree.elements.map((element) => collapse(element.direct.join(' ')));
  const boxes: ElementBox[] = [
    { left: 0, top: 0, right: viewport.width, bottom: viewport.height },
    body.box
  ];
  const paddings: PaddingSides[] = [{ top: 0, right: 0, bottom: 0, left: 0 }, body.padding];
  for (let index = BODY_INDEX + 1; index < tree.elements.length; index += 1) {
    const element = tree.elements[index];
    const parent = element === undefined ? undefined : boxes[element.parent];
    if (element === undefined || parent === undefined) {
      return { reason: `preview element ${String(index)} has no measured parent` };
    }
    const measured = boxOf(element, parent);
    if (measured === null)
      return { reason: `preview element ${element.tag} carries no usable box` };
    boxes.push(measured.box);
    paddings.push(measured.padding);
  }
  const elements = tree.elements.map((element, index) => ({
    parent: element.parent,
    tag: element.tag,
    ariaRole: element.role,
    display: styleMap(element.style).get('display') ?? 'block',
    ownText: own[index] ?? '',
    text: collapse(subtreeText(index, tree.children, own)).slice(0, LAYOUT_TEXT_CAP),
    box: boxes[index] ?? { left: 0, top: 0, right: 0, bottom: 0 },
    padding: paddings[index] ?? { top: 0, right: 0, bottom: 0, left: 0 },
    painted: false
  }));
  return { elements };
}

/**
 * Measure a preview page the same way the capture does: document order, parent
 * indices, and boxes taken from the inline offsets. The html element is
 * synthetic because a preview never numbers it.
 */
export function readPreviewGeometry(
  html: string,
  route: string,
  viewport: Viewport
): { ok: true; geometry: LayoutGeometry } | { ok: false; reason: string } {
  const body = readBody(html);
  if (body === null) return { ok: false, reason: 'the preview body carries no usable box' };
  const tree = walkTree(html, body.start);
  if (tree === null) return { ok: false, reason: 'the preview body is not balanced' };
  const node = tree.elements[BODY_INDEX];
  if (node !== undefined) {
    node.role = body.attributes.get('role') ?? null;
    node.style = body.attributes.get('style') ?? '';
  }
  const measured = measureTree(tree, body, viewport);
  if ('reason' in measured) return { ok: false, reason: measured.reason };
  return { ok: true, geometry: { route, viewport, elements: measured.elements } };
}
