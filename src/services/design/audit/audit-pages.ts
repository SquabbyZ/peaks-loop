/**
 * The per-unit page loop for the S7 audit, split from `audit-project.ts` when
 * Task 6a added the scope accounting and the project reader crossed the
 * file-size ceiling.
 *
 * One app path at a time: read the page (or reuse the stylesheet the CSS reader
 * already read), follow its bounded import closure so the states detector can
 * see a child-held empty state, and fan the unit through every detector. Every
 * closure file is recorded in `context`; the scope builder later subtracts the
 * scored paths, so "context" means exactly "read only through an import".
 *
 * The loop also accumulates `valueFiles` (Task 6d): every page plus every
 * closure file its value dimensions read. That union is what the scope note
 * reports, so a person can see that spacing/type/colour/surface were not
 * measured on the entry module alone.
 */

import { extname } from 'node:path';

import type { PavedRoadFile } from '../paved-road.js';
import { isExcluded } from '../source-scan/inputs.js';
import { routeForFile } from '../design-routes.js';
import type {
  AuditDimension,
  AuditFinding,
  AuditSource,
  DimensionJudgement
} from './audit-finding.js';
import { isRouteEntry, isUnderRoots } from './audit-scope.js';
import { auditUnit, type AuditContract } from './audit-unit.js';
import { stateNames, type CssVariableTable } from './css-variables.js';
import { walkFiles } from './audit-walk.js';
import { readImportClosure } from './import-closure.js';
import type { PathAlias } from './path-aliases.js';
import { captureMatchesRoute } from './render/render-captures.js';
import type { RenderFrame } from './render/render-audit.js';
import type { SourceCache } from './source-cache.js';
import { isTestFile } from './source-filters.js';

/** Page units: markup documents. Stylesheets are added from the CSS reader. */
export const PAGE_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte']);

/**
 * The total page-unit bound (Task 6e). Work is O(pages × closure), so a
 * 10k-route repository would otherwise run for ~20 minutes; the cap is reported
 * as a read gap instead of silently dropping the tail.
 */
export const DEFAULT_MAX_PAGES = 2000;

/** Which units the page walk may score. */
export type PageScope = {
  appRoot: string;
  roots: readonly string[];
  declaredRoots: boolean;
  exclude: readonly string[];
  cssFiles: ReadonlyMap<string, AuditSource>;
};

/** The optional bounds and gap sink `pagePaths` accepts. */
export type PagePathOptions = {
  /** Receives the truncation line when the page bound is hit. */
  gaps?: string[];
  maxPages?: number;
};

/**
 * The audited units: route-entry markup under the page roots plus every
 * stylesheet the CSS reader read. A test module is never a unit (Task 6c). When
 * the contract declares no page root, the route-entry derivation is not applied
 * — the documented pre-6a behaviour ("every UI source scored") is kept, because
 * the rule exists to narrow a DECLARED root that turned out to be a feature
 * tree, not to invent a scope for a contract that declared none.
 */
export function pagePaths(scope: PageScope, options: PagePathOptions = {}): string[] {
  const walkOptions = options.gaps === undefined ? {} : { gaps: options.gaps };
  const markup = walkFiles(scope.appRoot, '.', PAGE_EXTENSIONS, walkOptions).filter(
    (file) =>
      isUnderRoots(file, scope.roots) &&
      !isExcluded(file, scope.exclude) &&
      !isTestFile(file) &&
      (!scope.declaredRoots || isRouteEntry(file, scope.roots))
  );
  const styles = [...scope.cssFiles.keys()].filter((file) => !isTestFile(file));
  const all = [...new Set([...markup, ...styles])].sort((left, right) => left.localeCompare(right));
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  if (all.length <= maxPages) return all;
  options.gaps?.push(`page units stopped at the ${maxPages}-page bound (${all.length} found)`);
  return all.slice(0, maxPages);
}

/** The runtime state a report names: what was scored and what was skipped. */
export type AuditRuntimeState = {
  /** States under which at least one variable resolved to one value. */
  scored: string[];
  /** Declared states no audited value was scored under. */
  skipped: string[];
  /** Files or imports the reader could not follow, so the report can say why. */
  readGaps: string[];
  /** True when the stylesheet walk hit its file bound. */
  truncated: boolean;
};

/** One audited unit: a page file, or a stylesheet inside the page roots. */
export type AuditPage = {
  path: string;
  findings: AuditFinding[];
  /** Value counts per ratio dimension, so the score is not recomputed from text. */
  judgements: Partial<Record<AuditDimension, DimensionJudgement>>;
  /** Which cost dimensions had input to judge (it survives into the score). */
  judged: Partial<Record<AuditDimension, boolean>>;
  /** True when this page's import closure stopped at its file bound. */
  truncated: boolean;
  /** The capture bound to this page, when one was supplied for its route. */
  capture?: string;
};

/** What one page's import walk needs, bundled to keep the signature small. */
type ImportScan = {
  appRoot: string;
  source: AuditSource;
  aliases: readonly PathAlias[];
  state: AuditRuntimeState;
  context: Set<string>;
  cache: SourceCache;
};

/**
 * The markup modules one page imports (Task 5), bounded by the closure reader.
 * A stylesheet unit imports nothing this reader can judge, so it gets none.
 * Every gap the walk leaves is folded into the report's read gaps; an alias
 * gap is prefixed so the project reader can squash the set into one counted
 * line instead of thousands of near-identical entries, and a symlink escape is
 * named so a module skipped for containment is never silent (Task 6e).
 */
function importsFor(scan: ImportScan): { imports: AuditSource[]; truncated: boolean } {
  if (!PAGE_EXTENSIONS.has(extname(scan.source.file).toLowerCase())) {
    return { imports: [], truncated: false };
  }
  const closure = readImportClosure({
    appRoot: scan.appRoot,
    file: scan.source.file,
    source: scan.source.source,
    aliases: scan.aliases,
    cache: scan.cache
  });
  for (const imported of closure.sources) scan.context.add(imported.file);
  for (const gap of closure.skipped) scan.state.readGaps.push(gap);
  for (const gap of closure.aliasGaps) scan.state.readGaps.push(gap);
  for (const gap of closure.escapes) scan.state.readGaps.push(gap);
  if (closure.truncated) {
    scan.state.readGaps.push(`${scan.source.file} (import closure stopped at its file bound)`);
  }
  return { imports: closure.sources, truncated: closure.truncated };
}

/** The units one page loop shares: paths, the stylesheet map and the contract. */
export type PageLoop = {
  appRoot: string;
  paths: readonly string[];
  cssFiles: ReadonlyMap<string, AuditSource>;
  paved: PavedRoadFile;
  contract: AuditContract;
  variables: CssVariableTable;
  styles: readonly AuditSource[];
  /** The project's declared path aliases, so the closure can follow `@/…`. */
  aliases: readonly PathAlias[];
  /** Decoded captures (S8); a page is bound to one by its derived route. */
  render: readonly RenderFrame[];
  /** The per-run source cache shared by every page and the CSS reader. */
  cache: SourceCache;
  state: AuditRuntimeState;
  /** Accumulates every import-closure file, so the scope can report context. */
  context: Set<string>;
  /** Accumulates every file the value dimensions read (page + closure). */
  valueFiles: Set<string>;
};

/** The page source, or null after recording why it could not be read. */
function readPageSource(path: string, loop: PageLoop): AuditSource | null {
  const cached = loop.cssFiles.get(path);
  if (cached !== undefined) return cached;
  const read = loop.cache.read(path);
  if (read.kind === 'read') return read.source;
  if (read.kind === 'oversize') {
    loop.state.readGaps.push(`${read.file} (larger than its source byte cap)`);
  } else if (read.kind === 'escapes') {
    loop.state.readGaps.push(`${read.file} (symlink escapes app root)`);
  }
  loop.state.readGaps.push(`${path} (unreadable)`);
  return null;
}

/**
 * The capture bound to a markup page by the route it derives, if any. A
 * `--render` capture carries the probe SLUG instead of a route, so matching
 * also accepts a slug that ends with the route's probe slug (the directory
 * normally prefixes the host:port, e.g. `127-0-0-1-7421-about`).
 */
function frameFor(path: string, loop: PageLoop): RenderFrame | undefined {
  if (!PAGE_EXTENSIONS.has(extname(path).toLowerCase())) return undefined;
  const route = routeForFile(path, loop.paved.pageRoots);
  if (route === null) return undefined;
  return loop.render.find(
    (entry) =>
      entry.route === route || (entry.slug !== null && captureMatchesRoute(entry.slug, route))
  );
}

/** Audit each page unit once; unreadable files become a read gap, never a page. */
export function auditPages(loop: PageLoop): AuditPage[] {
  const pages: AuditPage[] = [];
  for (const path of loop.paths) {
    const source = readPageSource(path, loop);
    if (source === null) continue;
    const { imports, truncated } = importsFor({
      appRoot: loop.appRoot,
      source,
      aliases: loop.aliases,
      state: loop.state,
      context: loop.context,
      cache: loop.cache
    });
    loop.valueFiles.add(path);
    for (const imported of imports) loop.valueFiles.add(imported.file);
    const frame = frameFor(path, loop);
    const unit = auditUnit({
      source,
      tokenScale: loop.paved.tokenScale,
      contract: loop.contract,
      variables: loop.variables,
      imports,
      styles: loop.styles,
      ...(frame === undefined ? {} : { render: frame })
    });
    pages.push({
      path,
      findings: unit.findings,
      judgements: unit.judgements,
      judged: unit.judged,
      truncated,
      ...(frame === undefined ? {} : { capture: frame.capture })
    });
  }
  return pages;
}

/**
 * States in which a variable resolved to exactly one value — the ones used.
 * Moved here from `audit-runtime.ts` (close-out E: the file was a cap-only
 * split of this one).
 */
function scoredStates(table: CssVariableTable): string[] {
  const names = new Set<string>();
  for (const definitions of table.values()) {
    if (new Set(definitions.map((definition) => definition.value)).size !== 1) continue;
    const states = new Set(definitions.map((definition) => definition.state));
    if (states.size !== 1) continue;
    const only = [...states][0];
    if (only !== null && only !== undefined) names.add(only);
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/** The runtime state a report names, from the CSS project the reader returned. */
export function runtimeState(cssProject: {
  variables: CssVariableTable;
  skipped: readonly string[];
  truncated: boolean;
}): AuditRuntimeState {
  const scored = scoredStates(cssProject.variables);
  const skipped = stateNames(cssProject.variables).filter((state) => !scored.includes(state));
  const readGaps = [...cssProject.skipped];
  if (cssProject.truncated) readGaps.push('stylesheet walk stopped at its file bound');
  return {
    scored,
    skipped,
    readGaps: readGaps.sort((left, right) => left.localeCompare(right)),
    truncated: cssProject.truncated
  };
}
