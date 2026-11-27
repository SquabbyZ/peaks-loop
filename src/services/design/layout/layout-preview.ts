/**
 * Deterministic preview HTML for one graph entry.
 *
 * Every node becomes an absolutely positioned element whose offsets are taken
 * from its stored box relative to its parent's border box, so no browser layout
 * rule (margins, font metrics, flow) decides a measured position. The page
 * carries a fixed, high-contrast banner and a title that both say it is a
 * direction preview, and the banner is a pseudo-element so it adds no element
 * the reader could mistake for a measured object.
 */
import type { ElementBox, PaddingSides } from './layout-geometry.js';
import { formatNumber, type GraphNode, type LayoutEntry } from './layout-graph.js';

export const PREVIEW_MARKER = 'DIRECTION PREVIEW — NOT A REAL IMPLEMENTATION';
export const PREVIEW_MARKER_ZH = '方向预览，不是真实实现';

export const VOID_TAGS: ReadonlySet<string> = new Set([
  'img',
  'input',
  'hr',
  'br',
  'meta',
  'link',
  'source',
  'track',
  'wbr',
  'area',
  'base',
  'col',
  'embed'
]);
export const TAG_PATTERN = /^[a-z][a-z0-9-]*$/;
const ROLE_PATTERN = /^[a-z][a-z-]*$/;

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function styleOf(box: ElementBox, padding: PaddingSides, origin: ElementBox | null): string {
  const left = origin === null ? box.left : box.left - origin.left;
  const top = origin === null ? box.top : box.top - origin.top;
  return [
    'position:absolute',
    `left:${formatNumber(left)}px`,
    `top:${formatNumber(top)}px`,
    `width:${formatNumber(box.right - box.left)}px`,
    `height:${formatNumber(box.bottom - box.top)}px`,
    `padding:${formatNumber(padding.top)}px ${formatNumber(padding.right)}px ${formatNumber(padding.bottom)}px ${formatNumber(padding.left)}px`,
    'box-sizing:border-box',
    'display:block',
    'margin:0'
  ].join(';');
}

export function pageHead(): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="x-layout-preview" content="direction-preview;not-an-implementation">',
    `<title>${PREVIEW_MARKER} · ${PREVIEW_MARKER_ZH}</title>`,
    '<style>',
    'html{min-width:100%;min-height:100%}',
    `body::before{content:"${PREVIEW_MARKER} · ${PREVIEW_MARKER_ZH}";position:fixed;bottom:0;left:0;right:0;padding:12px 16px;background:#fff3cd;color:#663c00;border-top:3px solid #b45309;font:700 14px/1.4 system-ui,sans-serif;text-align:center;z-index:2147483647;pointer-events:none}`,
    '</style>',
    '</head>'
  ].join('\n');
}

type Children = ReadonlyMap<string, readonly GraphNode[]>;

function childrenOf(entry: LayoutEntry): Children {
  const children = new Map<string, GraphNode[]>();
  for (const node of entry.nodes) {
    if (node.parentId === null) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  return children;
}

/** Why the entry's root cannot be previewed, or null when it can. */
function rootRefusal(entry: LayoutEntry): string | null {
  const body = entry.nodes.filter((node) => node.tag === 'body');
  if (body.length !== 1) return 'the entry has no single body node';
  if (body[0]?.parentId !== null) return 'the body node is not the tree root';
  if (new Set(entry.nodes.map((node) => node.id)).size !== entry.nodes.length) {
    return 'the entry repeats a node id';
  }
  const stray = entry.nodes.find((node) => node.tag !== 'body' && node.parentId === null);
  return stray === undefined ? null : `node ${stray.id} is not under the body`;
}

/** Why one node cannot become an element, or null when it can. */
function nodeRefusal(node: GraphNode, children: Children): string | null {
  if (!TAG_PATTERN.test(node.tag)) return `tag "${node.tag}" is not an element name`;
  if (!ROLE_PATTERN.test(node.role)) return `role "${node.role}" is not a role name`;
  if (node.box.right < node.box.left || node.box.bottom < node.box.top) {
    return `node ${node.id} has an inverted box`;
  }
  const hasContent = node.text !== '' || (children.get(node.id)?.length ?? 0) > 0;
  if (VOID_TAGS.has(node.tag) && hasContent) return `void tag "${node.tag}" carries content`;
  return null;
}

function rebuildRefusal(entry: LayoutEntry, children: Children): string | null {
  const root = rootRefusal(entry);
  if (root !== null) return root;
  for (const node of entry.nodes) {
    const refusal = nodeRefusal(node, children);
    if (refusal !== null) return refusal;
  }
  return null;
}

function renderNode(node: GraphNode, origin: ElementBox, children: Children): string {
  const own = children.get(node.id) ?? [];
  const open = `<${node.tag} role="${node.role}" style="${styleOf(node.box, node.padding, origin)}">`;
  if (VOID_TAGS.has(node.tag)) return open;
  const content = own.length === 0 ? escapeHtml(node.text) : escapeHtml(node.ownText);
  const inner = own.map((child) => renderNode(child, node.box, children)).join('');
  return `${open}${content}${inner}</${node.tag}>`;
}

/** The preview page for one entry; the same entry always yields the same bytes. */
export function rebuildHtml(
  entry: LayoutEntry
): { ok: true; html: string } | { ok: false; reason: string } {
  const children = childrenOf(entry);
  const refusal = rebuildRefusal(entry, children);
  if (refusal !== null) return { ok: false, reason: refusal };
  const body = entry.nodes.find((node) => node.tag === 'body');
  if (body === undefined) return { ok: false, reason: 'the entry has no body node' };
  const bodyMarkup = [
    `<body role="${body.role}" style="${styleOf(body.box, body.padding, null)}">`,
    escapeHtml(body.ownText),
    ...(children.get(body.id) ?? []).map((child) => renderNode(child, body.box, children))
  ].join('');
  return { ok: true, html: `${pageHead()}\n${bodyMarkup}</body>\n</html>\n` };
}
