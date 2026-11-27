/**
 * Reading one entry and choosing among entries. A missing or ambiguous request
 * is a refusal value with the available keys, never a first-match answer. The
 * measured document a caller holds is validated here too, before any entry is
 * compared against it.
 */
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { parseEntry, type AsciiRead } from './layout-graph-parse.js';
import type { CoverageKey } from './layout-graph-paths.js';
import {
  entryPath,
  keyRefusal,
  readIndex,
  viewportKey,
  type EntryKey,
  type IndexedEntry
} from './layout-graph-store.js';
import type {
  LayoutCaptureInput,
  LayoutGeometry,
  LayoutPageResult,
  Viewport
} from './layout-geometry.js';

export function readEntry(projectRoot: string, key: EntryKey): AsciiRead {
  const refusal = keyRefusal(key);
  if (refusal !== null) return { ok: false, reason: refusal };
  try {
    return parseEntry(readFileSync(entryPath(projectRoot, key), 'utf8'));
  } catch {
    return {
      ok: false,
      reason: `no entry exists for ${key.route} ${key.state}@${viewportKey(key.viewport)}`
    };
  }
}

export type EntrySelection =
  { ok: true; entry: IndexedEntry } | { ok: false; reason: string; available: string[] };

/** The entry a caller asked for; ambiguity is a refusal, never a first match. */
export function selectEntry(
  projectRoot: string,
  query: { route: string; state?: string; viewport?: Viewport }
): EntrySelection {
  const index = readIndex(projectRoot);
  if (!index.ok) return { ok: false, reason: index.reason, available: [] };
  const forRoute = index.entries.filter((entry) => entry.route === query.route);
  const available = forRoute.map((entry) => `${entry.state}@${viewportKey(entry.viewport)}`);
  const withState =
    query.state === undefined ? forRoute : forRoute.filter((entry) => entry.state === query.state);
  if (withState.length === 0) {
    return { ok: false, reason: `no entry for ${query.route}`, available };
  }
  const withViewport =
    query.viewport === undefined
      ? withState
      : withState.filter(
          (entry) =>
            entry.viewport.width === query.viewport?.width &&
            entry.viewport.height === query.viewport?.height
        );
  if (withViewport.length === 1) {
    const only = withViewport[0];
    if (only !== undefined) return { ok: true, entry: only };
  }
  return {
    ok: false,
    reason:
      withViewport.length === 0
        ? `${query.route} has no such viewport`
        : 'state or viewport is ambiguous',
    available
  };
}

const SIDE_KEYS = ['top', 'right', 'bottom', 'left'] as const;

/** A box or a padding record: all four sides present as finite numbers. */
function isSides(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return SIDE_KEYS.every((key) => {
    const side = record[key];
    return typeof side === 'number' && Number.isFinite(side);
  });
}

function isElement(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const element = value as Record<string, unknown>;
  return (
    typeof element.parent === 'number' &&
    typeof element.tag === 'string' &&
    typeof element.display === 'string' &&
    typeof element.ownText === 'string' &&
    typeof element.text === 'string' &&
    typeof element.painted === 'boolean' &&
    isSides(element.box) &&
    isSides(element.padding)
  );
}

function isCapture(value: unknown): value is LayoutGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const viewport = record.viewport as Record<string, unknown> | undefined;
  return (
    typeof record.route === 'string' &&
    Array.isArray(record.elements) &&
    record.elements.every(isElement) &&
    viewport !== undefined &&
    typeof viewport.width === 'number' &&
    typeof viewport.height === 'number'
  );
}

export const STATES_FILE = 'layout-states.json';
export const LAYOUT_STATES = ['default', 'empty', 'error', 'loading'] as const;
export type LayoutState = (typeof LAYOUT_STATES)[number];

/** The three breakpoints driven for every state when every state is measured. */
export const ALL_STATES_VIEWPORTS = '390x844,834x1112,1280x800';

/** How a state is reached: a navigable address, optionally followed by one page action. */
export type StateDeclaration = { url: string; click?: string };

export type StateDeclarations =
  | { ok: true; states: Partial<Record<LayoutState, StateDeclaration>> }
  | { ok: false; reason: string };

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function declarationOf(value: unknown): StateDeclaration | null {
  const record = recordOf(value);
  const url = record?.['url'];
  const click = record?.['click'];
  if (record === null || typeof url !== 'string' || url.trim() === '') return null;
  if (click !== undefined && typeof click !== 'string') return null;
  return click === undefined ? { url } : { url, click };
}

/** One route's states, or why the block cannot be read as declarations. */
function statesOf(value: unknown): Partial<Record<LayoutState, StateDeclaration>> | string {
  const record = recordOf(value);
  if (record === null) return 'the route declaration must be an object of states';
  const states: Partial<Record<LayoutState, StateDeclaration>> = {};
  for (const [state, raw] of Object.entries(record)) {
    if (!(LAYOUT_STATES as readonly string[]).includes(state)) {
      return `"${state}" is not one of ${LAYOUT_STATES.join(', ')}`;
    }
    const declaration = declarationOf(raw);
    if (declaration === null) return `the declaration for ${state} is not { url, click? }`;
    states[state as LayoutState] = declaration;
  }
  return states;
}

/** The declarations written for one route, or why the file cannot be used at all. */
export function readStateDeclarations(designRoot: string, route: string): StateDeclarations {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(designRoot, STATES_FILE), 'utf8'));
  } catch (error) {
    return {
      ok: false,
      reason: `the state declaration could not be read (${getErrorMessage(error)})`
    };
  }
  const routes = recordOf(recordOf(raw)?.['routes']);
  if (routes === null) return { ok: false, reason: 'the state declaration has no routes object' };
  if (!(route in routes)) {
    return { ok: false, reason: `the state declaration does not name the route ${route}` };
  }
  const states = statesOf(routes[route]);
  if (typeof states === 'string') return { ok: false, reason: `${route}: ${states}` };
  return { ok: true, states };
}

/** The declared address as an absolute URL, or null when it cannot be resolved. */
export function declaredUrl(declaration: StateDeclaration, baseUrl: string): string | null {
  if (!URL.canParse(declaration.url, baseUrl)) return null;
  return new URL(declaration.url, baseUrl).toString();
}

export type StateDriveRequest = {
  route: string;
  baseUrl: string;
  declarations: StateDeclarations;
  viewports: readonly Viewport[];
  trusted: (url: string) => boolean;
};

export type StateBuildResult<T> =
  { ok: true; built: T } | { ok: false; code: string; reason: string };

export type StateDrive<T> = { built: T[]; keys: CoverageKey[] };

type StateTarget = { ok: true; url: string; click?: string } | { ok: false; reason: string };

/** The declared address and action for one state, or the named reason it has none. */
function stateTargetOf(request: StateDriveRequest, state: LayoutState): StateTarget {
  const declaration = request.declarations.ok ? request.declarations.states[state] : undefined;
  if (declaration === undefined) {
    const reason = request.declarations.ok
      ? `no declaration for state ${state}`
      : request.declarations.reason;
    return { ok: false, reason };
  }
  const url = declaredUrl(declaration, request.baseUrl);
  if (url === null) return { ok: false, reason: `the URL declared for ${state} is not usable` };
  if (!request.trusted(url))
    return { ok: false, reason: `the URL declared for ${state} is untrusted` };
  return declaration.click === undefined
    ? { ok: true, url }
    : { ok: true, url, click: declaration.click };
}

/**
 * Drive every declared state at every viewport through the capture seam. A state
 * with no usable declaration is a named `state-unavailable` key; a capture or
 * build failure is a named `failed` key. Only a built entry is `real`.
 */
export async function driveStates<T>(
  request: StateDriveRequest,
  capture: (input: LayoutCaptureInput) => Promise<LayoutPageResult>,
  build: (state: string, viewport: Viewport, page: LayoutPageResult) => StateBuildResult<T>
): Promise<StateDrive<T>> {
  const built: T[] = [];
  const keys: CoverageKey[] = [];
  for (const state of LAYOUT_STATES) {
    for (const viewport of request.viewports) {
      const target = stateTargetOf(request, state);
      if (!target.ok) {
        keys.push({ state, viewport, verdict: 'state-unavailable', reason: target.reason });
        continue;
      }
      let page: LayoutPageResult;
      try {
        const input = { route: request.route, url: target.url, viewport };
        page = await (target.click === undefined
          ? capture(input)
          : capture({ ...input, click: target.click }));
      } catch (error) {
        page = { ok: false, reason: getErrorMessage(error) };
      }
      const one = build(state, viewport, page);
      if (!one.ok) {
        keys.push({ state, viewport, verdict: 'failed', reason: `${one.code}: ${one.reason}` });
        continue;
      }
      built.push(one.built);
      keys.push({ state, viewport, verdict: 'real' });
    }
  }
  return { built, keys };
}

/** The measured document a caller passes back, or why it cannot be used. */
export function readCapture(
  path: string
): { ok: true; geometry: LayoutGeometry } | { ok: false; reason: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resolve(path), 'utf8'));
  } catch (error) {
    return { ok: false, reason: `the capture file could not be read (${getErrorMessage(error)})` };
  }
  return isCapture(raw)
    ? { ok: true, geometry: raw }
    : { ok: false, reason: 'the capture is not a measured layout document' };
}
