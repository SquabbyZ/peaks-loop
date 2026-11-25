/**
 * The audit's page scope (S7 Task 6a).
 *
 * A "page" is a markup source under a `design/paved-road.json` page root. A
 * markup module OUTSIDE the roots is not a page: it is context the import
 * closure may read (a dialog, a drawer, a table component) and is reported by
 * count, never scored. When the contract declares no page root at all the
 * pre-Task-6a behaviour is kept — every UI source is scored — and the note says
 * so, so the wider scope is never silent.
 *
 * The note is the report's one-line answer to "what did this score?". It is
 * produced here, once, so the markdown and the JSON sibling cannot disagree.
 *
 * THE VALUE SCOPE IS WIDER THAN THE PAGE SCOPE (Task 6d). `spacing`, `type`,
 * `color` and `surface`'s radius/shadow rules judge the page PLUS its import
 * closure: on the pilot, route-entry scoping alone cut 4,500 measured spacing
 * values to 24, because the values live in the components the page renders. A
 * shared component is read once per page that imports it — that is what the
 * page renders, so it belongs in each page's ratio — while a context file no
 * page imports is read by nothing and scores nothing. `valueFiles` is the
 * distinct-file count that read, and the note states both facts.
 */

import { normalizePath } from '../../../shared/path-utils.js';
import { capDetail, plainText } from '../evidence-text.js';

/** How the audit decided which sources are pages. */
export type AuditScope = {
  /** Declared page roots, as the contract spells them; empty when none declared. */
  pageRoots: string[];
  /** False when every UI source was scored because no page root was declared. */
  pageRootsDeclared: boolean;
  /** Page units scored: markup pages plus the stylesheets the reader followed. */
  scored: number;
  /** Markup/script files read only through the import closure, never scored. */
  context: number;
  /**
   * Distinct files the value dimensions read (each page plus its closure).
   * A shared component counts once here, however many pages import it.
   */
  valueFiles: number;
  /** One line the report prints; never silent about the scope. */
  note: string;
};

/** The roots to walk: the declared ones, or `.` when the contract declares none. */
export function pageRootsOf(pageRoots: readonly string[]): string[] {
  return pageRoots.length > 0 ? [...pageRoots] : ['.'];
}

/** True when a markup file sits under one of the declared page roots. */
export function isUnderRoots(file: string, roots: readonly string[]): boolean {
  return roots.some((root) => {
    const normalized = normalizePath(root.trim())
      .replace(/^(?:\.\/)+/, '')
      .replace(/\/+$/, '');
    return (
      normalized === '' ||
      normalized === '.' ||
      file === normalized ||
      file.startsWith(`${normalized}/`)
    );
  });
}

/** Path segments that name a router's route-entry directory. */
const ROUTE_SEGMENTS = new Set(['routes', 'pages', 'app']);

/** The `index.*` module that represents a directory. */
const INDEX_MODULE = /^index\./;

/** How many directory levels `file` sits below `root` (0 = directly inside). */
function depthBelowRoot(file: string, root: string): number {
  const normalized = normalizePath(root.trim())
    .replace(/^(?:\.\/)+/, '')
    .replace(/\/+$/, '');
  const prefix = normalized === '' || normalized === '.' ? '' : `${normalized}/`;
  if (prefix !== '' && !file.startsWith(prefix)) return -1;
  const relative = prefix === '' ? file : file.slice(prefix.length);
  return relative.split('/').filter((segment) => segment !== '').length - 1;
}

/**
 * True when a markup file under a page root is a ROUTE ENTRY (Task 6c).
 *
 * The pilot declared its feature directory as a page root, so every dialog, drawer,
 * table column module and section fragment was scored as a page — 773 "pages"
 * of which most were components. The title lives in a layout, the empty state
 * in a sibling; judging the fragment produced the 0/8 and 0/13 true-positive
 * rates the calibration report records. A route entry is now:
 *
 *   - a file under a `pages/`, `routes/` or `app/` path segment (any depth), or
 *   - the root's own `index.*` module — the index module sitting directly in
 *     a declared root.
 *
 * A feature's `index.tsx` is NOT a route entry: it is a composition module a
 * route imports, so it is context like any other component. Everything else
 * inside the roots is context: read by the closure, never scored. The rule is
 * stated in the scope note so the report is never silent about the scope it
 * chose.
 */
export function isRouteEntry(file: string, roots: readonly string[]): boolean {
  const segments = normalizePath(file).split('/');
  if (segments.slice(0, -1).some((segment) => ROUTE_SEGMENTS.has(segment))) return true;
  const name = segments[segments.length - 1] ?? '';
  if (!INDEX_MODULE.test(name)) return false;
  return roots.some((root) => depthBelowRoot(file, root) === 0);
}

/** The derivation rule every scope note prints, so the scope is not silent. */
export const ROUTE_ENTRY_RULE =
  'route entries only (a pages/routes/app path segment, or a root-level index module)';

/**
 * The declared roots as one bounded, control-free field. A root is contract
 * text and the note is persisted: a control byte in a root would repaint the
 * terminal that reads `audit-*.md`, and a list of thousands of roots must not
 * turn the report's one-line scope into a page. The full list stays in
 * `scope.pageRoots`; this is the printed summary.
 */
function rootText(roots: readonly string[]): string {
  return capDetail(plainText(roots.join(', ')));
}

function scopeNote(
  roots: readonly string[],
  scored: number,
  context: number,
  valueFiles: number
): string {
  const valueLine =
    'value dimensions (spacing, type, colour, surface) read each page plus its import closure ' +
    `(${valueFiles} distinct files; a shared component counts once per page that imports it)`;
  if (roots.length === 0) {
    return `pageRoots not declared — every UI source scored (${scored} page units); ${valueLine}`;
  }
  const contextLine =
    context === 0
      ? 'no UI source outside them was read'
      : `${context} UI source files outside them were read only through the import closure (not scored)`;
  return `scored ${scored} page units under pageRoots ${rootText(roots)}; ${contextLine}; ${ROUTE_ENTRY_RULE}; ${valueLine}`;
}

export type AuditScopeInput = {
  /** Page roots exactly as the contract declares them. */
  declaredRoots: readonly string[];
  /** Number of page units the audit scored. */
  scoredPages: number;
  /** Every file an import closure read (scored pages included; filtered here). */
  contextFiles: Iterable<string>;
  /** The scored page paths, so a page imported by another page is not context. */
  scoredPaths: ReadonlySet<string>;
  /** Every file a value dimension read (page + closure), for the scope note. */
  valueFiles: Iterable<string>;
};

/** Build the scope once; the markdown and JSON report both read it. */
export function buildAuditScope(input: AuditScopeInput): AuditScope {
  const declared = input.declaredRoots.filter((root) => root.trim() !== '');
  const context = [...new Set(input.contextFiles)].filter(
    (file) => !input.scoredPaths.has(file)
  ).length;
  const valueFiles = new Set(input.valueFiles).size;
  return {
    pageRoots: [...declared],
    pageRootsDeclared: declared.length > 0,
    scored: input.scoredPages,
    context,
    valueFiles,
    note: scopeNote(declared, input.scoredPages, context, valueFiles)
  };
}

/** The scope a non-UI verdict carries: nothing scored, and it says why. */
export function notUiScope(): AuditScope {
  return {
    pageRoots: [],
    pageRootsDeclared: false,
    scored: 0,
    context: 0,
    valueFiles: 0,
    note: 'not a UI project — nothing scored'
  };
}
