/**
 * The graph entry: the numbered nodes and anchors of one rendered route at one
 * `(state, viewport)`, plus the two fingerprints that decide whether the entry
 * still describes its source.
 *
 * A node stores the measured text as `text` (subtree text, capped at capture)
 * and `ownText` (direct text only). The cut numbers containers by `ownText` and
 * objects by `text`, so both are read back when geometry is reconstructed.
 */
import { createHash } from 'node:crypto';

import { buildLayoutIndex, type LayoutAnchor, type LayoutIndex } from './layout-align.js';
import {
  LAYOUT_CAPTURE_VERSION,
  type ElementBox,
  type LayoutElement,
  type LayoutGeometry,
  type PaddingSides,
  type Viewport
} from './layout-geometry.js';
import type { SpacingToken } from './layout-tokens.js';

export type GraphNode = {
  id: string;
  kind: 'object' | 'container';
  tag: string;
  role: string;
  box: ElementBox;
  padding: PaddingSides;
  ownText: string;
  text: string;
  parentId: string | null;
};

export type LayoutEntry = {
  route: string;
  state: string;
  viewport: Viewport;
  /** The capture format the geometry declared; a versionless geometry yields no value. */
  captureVersion?: string;
  /** Fingerprint of the measured document; a source change moves it. */
  fingerprint: string;
  /** Fingerprint of the declared spacing tokens the anchors were attributed to. */
  tokensFingerprint: string;
  tokens: SpacingToken[];
  nodes: GraphNode[];
  anchors: LayoutAnchor[];
};

export type EntryFreshness = {
  status: 'current' | 'stale' | 'unverified';
  reasons: string[];
};

export type FreshnessCheck = {
  geometry?: LayoutGeometry;
  tokens?: readonly SpacingToken[];
  /** True when the contract could not be read: the token axis is judged stale, never matched. */
  tokensUnreadable?: boolean;
};

/** A token an entry cites, kept as the name/value pair its digest covers. */
export type CitedToken = { name: string; value: string };

const PADDING_SIDES = ['top', 'right', 'bottom', 'left'] as const;
/** A computed pixel matches a declared value when it differs by no fraction. */
const PX_EPSILON = 0.01;

function compareText(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * The declared tokens these nodes cite: a token is cited when its pixel value
 * equals a padding side of any node. Value matching is the rule the anchor
 * attribution uses; when two names declare one value the nodes cite both, which
 * over-refreshes rather than missing a dependency.
 */
export function citedTokens(
  nodes: readonly GraphNode[],
  tokens: readonly SpacingToken[]
): CitedToken[] {
  const sides: number[] = [];
  for (const node of nodes) {
    for (const side of PADDING_SIDES) sides.push(node.padding[side]);
  }
  return tokens
    .filter((token) => sides.some((px) => Math.abs(px - token.px) <= PX_EPSILON))
    .map((token) => ({ name: token.name, value: token.value }))
    .sort(
      (left, right) => compareText(left.name, right.name) || compareText(left.value, right.value)
    );
}

/** Numbers are emitted in one canonical form so two runs cannot differ in text. */
export function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return String(rounded === 0 ? 0 : rounded);
}

/** Sixty-four bits of digest: enough to detect a moved source, short enough to read. */
const FINGERPRINT_LENGTH = 16;

function hashLines(lines: readonly string[]): string {
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, FINGERPRINT_LENGTH);
}

function boxText(box: ElementBox): string {
  return [box.left, box.top, box.right, box.bottom].map(formatNumber).join(',');
}

function paddingText(padding: PaddingSides): string {
  return [padding.top, padding.right, padding.bottom, padding.left].map(formatNumber).join(',');
}

/**
 * The measured document as one digest. Only the fields the capture truly
 * measured enter it: DOM structure, computed display/padding and geometry.
 * Screenshot bytes, anti-aliasing and font metrics are not read by the
 * capture at all, so they cannot enter this hash.
 */
export function geometryFingerprint(geometry: LayoutGeometry): string {
  const header = `${geometry.route}|${String(geometry.viewport.width)}x${String(geometry.viewport.height)}`;
  const lines = geometry.elements.map((element) =>
    [
      String(element.parent),
      element.tag,
      element.ariaRole ?? '',
      element.display,
      element.ownText,
      element.text,
      boxText(element.box),
      paddingText(element.padding),
      element.painted ? '1' : '0'
    ].join('\u0000')
  );
  return hashLines([header, ...lines]);
}

/** The cited subset as one digest: the entry's dependency set, not the whole vocabulary. */
export function dependencyFingerprint(cited: readonly CitedToken[]): string {
  const lines = cited.map((token) => `${token.name}=${token.value}`).sort();
  return hashLines(lines);
}

/** The entry for one built index, with both fingerprints taken from its inputs. */
export function buildLayoutEntry(input: {
  index: LayoutIndex;
  geometry: LayoutGeometry;
  state: string;
  tokens: readonly SpacingToken[];
}): LayoutEntry {
  const nodes: GraphNode[] = input.index.nodes.map((node) => ({
    id: node.id,
    kind: node.kind,
    tag: node.tag,
    role: node.role,
    box: node.box,
    padding: node.padding,
    ownText: node.ownText,
    text: node.text,
    parentId: node.parentId
  }));
  return {
    route: input.index.route,
    state: input.state,
    viewport: input.index.viewport,
    ...(input.geometry.captureVersion === undefined
      ? {}
      : { captureVersion: input.geometry.captureVersion }),
    fingerprint: geometryFingerprint(input.geometry),
    tokensFingerprint: dependencyFingerprint(citedTokens(nodes, input.tokens)),
    tokens: [...input.tokens],
    nodes,
    anchors: input.index.anchors
  };
}

/**
 * The measured geometry a stored entry describes. The html element is synthetic
 * because the cut never numbers it; every node keeps the parent its id was
 * numbered under.
 */
export function entryGeometry(
  entry: LayoutEntry
): { ok: true; geometry: LayoutGeometry } | { ok: false; reason: string } {
  const seen = new Map<string, number>();
  const elements: LayoutElement[] = [
    {
      parent: -1,
      tag: 'html',
      ariaRole: null,
      display: 'block',
      ownText: '',
      text: entry.nodes.map((node) => node.text).join(' '),
      box: { left: 0, top: 0, right: entry.viewport.width, bottom: entry.viewport.height },
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      painted: false
    }
  ];
  for (const node of entry.nodes) {
    let parent = 0;
    if (node.parentId !== null) {
      const found = seen.get(node.parentId);
      if (found === undefined) {
        return { ok: false, reason: `node ${node.id} names a parent that is absent or later` };
      }
      parent = found;
    }
    seen.set(node.id, elements.length);
    elements.push({
      parent,
      tag: node.tag,
      ariaRole: node.role,
      display: 'block',
      ownText: node.ownText,
      text: node.text,
      box: node.box,
      padding: node.padding,
      painted: false
    });
  }
  return { ok: true, geometry: { route: entry.route, viewport: entry.viewport, elements } };
}

/** Re-cut a stored entry; the ids and anchors must be the ones it recorded. */
export function indexFromEntry(
  entry: LayoutEntry
): { ok: true; index: LayoutIndex } | { ok: false; reason: string } {
  const read = entryGeometry(entry);
  if (!read.ok) return read;
  return {
    ok: true,
    index: buildLayoutIndex({ geometry: read.geometry, spacingTokens: entry.tokens })
  };
}

/** Every node's ancestor id chain, root first, direct parent last. */
export function chainsOf(nodes: readonly GraphNode[]): Map<string, string[]> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const chains = new Map<string, string[]>();
  for (const node of nodes) {
    const chain: string[] = [];
    let parent = node.parentId;
    while (parent !== null && byId.has(parent)) {
      chain.push(parent);
      parent = byId.get(parent)?.parentId ?? null;
    }
    chains.set(node.id, chain.reverse());
  }
  return chains;
}

/**
 * Whether an entry may be cited as current alignment evidence. An entry built
 * under another capture format is stale outright; otherwise a checked axis that
 * moved makes it stale and an unchecked axis leaves it unverified. Only both
 * axes matching is `current`.
 */
export function freshnessOf(entry: LayoutEntry, check: FreshnessCheck): EntryFreshness {
  const reasons: string[] = [];
  const unchecked: string[] = [];
  if (entry.captureVersion !== LAYOUT_CAPTURE_VERSION) reasons.push('capture-version-outdated');
  if (check.geometry === undefined) unchecked.push('source-geometry-not-checked');
  else if (geometryFingerprint(check.geometry) !== entry.fingerprint) {
    reasons.push('source-geometry-changed');
  }
  if (check.tokensUnreadable === true) reasons.push('spacing-tokens-unreadable');
  else if (check.tokens === undefined) unchecked.push('spacing-tokens-not-checked');
  else if (
    dependencyFingerprint(citedTokens(entry.nodes, check.tokens)) !== entry.tokensFingerprint
  ) {
    reasons.push('spacing-tokens-changed');
  }
  if (reasons.length > 0) return { status: 'stale', reasons };
  if (unchecked.length > 0) return { status: 'unverified', reasons: unchecked };
  return { status: 'current', reasons: [] };
}
