/**
 * Changed-route derivation for G3.
 *
 * G3 judges only the routes THIS change touched, so the route set comes from
 * the change set G1 already scanned, never from `render.pages` (an untouched
 * configured page with a stale baseline must not fail a clean change).
 *
 * The convention, documented once here because every project maps files to
 * routes the same way for this gate: a changed file under a
 * `design/paved-road.json` pageRoot has the page root and the file extension
 * stripped, and the remainder is the route. A trailing `index` segment
 * collapses to its directory; a page at the root maps to `/`. A changed UI
 * file that maps to no route is `route-unknown` — a recorded skip, never a
 * hard failure and never silence.
 */
import { extname } from 'node:path';

import { normalizePath } from '../../shared/path-utils.js';
import type { PavedRoadFile } from './paved-road.js';

/** UI file families, matching the G1 surface test. */
const UI_EXTENSIONS = new Set('.tsx .jsx .vue .svelte .css .scss .sass .less .html'.split(' '));

const INDEX_SEGMENT = /(^|\/)index$/;
const EXTENSION = /\.[^./]+$/;

function normalizeRoot(root: string): string {
  return normalizePath(root).replace(/^\.\//, '').replace(/\/+$/, '');
}

/** The longest page root `file` (app-relative) sits under, or null. */
function matchingRoot(file: string, pageRoots: readonly string[]): string | null {
  let best: string | null = null;
  for (const raw of pageRoots) {
    const root = normalizeRoot(raw);
    if (root === '') continue;
    if (file !== root && !file.startsWith(`${root}/`)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

/** The route one app-relative file names, or null when no page root matches. */
export function routeForFile(file: string, pageRoots: readonly string[]): string | null {
  const normalized = normalizePath(file);
  const root = matchingRoot(normalized, pageRoots);
  if (root === null) return null;
  const remainder = normalized.slice(root.length + 1).replace(EXTENSION, '');
  if (remainder === '') return null;
  const route = remainder.replace(INDEX_SEGMENT, '');
  return route === '' ? '/' : `/${route}`;
}

export type ChangedRoutes = {
  /** Distinct routes, in first-seen order. */
  routes: string[];
  /** Changed UI files that map to no route; reported as `skipped('route-unknown')`. */
  unknown: string[];
};

/** Derive the changed routes and the UI files that have none. */
export function deriveChangedRoutes(
  files: readonly string[],
  paved: Pick<PavedRoadFile, 'pageRoots'>
): ChangedRoutes {
  const routes: string[] = [];
  const unknown: string[] = [];
  for (const file of files) {
    const route = routeForFile(file, paved.pageRoots);
    if (route !== null) {
      if (!routes.includes(route)) routes.push(route);
      continue;
    }
    if (UI_EXTENSIONS.has(extname(file).toLowerCase())) unknown.push(normalizePath(file));
  }
  return { routes, unknown };
}
