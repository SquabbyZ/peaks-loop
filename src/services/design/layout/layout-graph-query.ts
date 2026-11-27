/**
 * Reading one entry and choosing among entries. A missing or ambiguous request
 * is a refusal value with the available keys, never a first-match answer. The
 * measured document a caller holds is validated here too, before any entry is
 * compared against it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { parseEntry, type AsciiRead } from './layout-graph-parse.js';
import {
  entryPath,
  keyRefusal,
  readIndex,
  viewportKey,
  type EntryKey,
  type IndexedEntry
} from './layout-graph-store.js';
import type { LayoutGeometry, Viewport } from './layout-geometry.js';

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
