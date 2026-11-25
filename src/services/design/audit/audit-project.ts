/**
 * The S7 audit's project reader (Task 4): one app root in, every audited source
 * unit and its findings out.
 *
 * Contract files are `design/tokens.json` (the colour oracle and any declared
 * contrast pairs) and `design/paved-road.json` (page roots, excludes and the
 * declared `tokenScale`). A UI source set with no contract is a refusal — the
 * audit will not judge a project against a ladder it never declared — and so is
 * a contract file past the 2 MiB cap: an over-cap blob is not a declaration
 * this audit can trust, so it is refused by name, never parsed as an empty one.
 * A tree with no UI source at all is the explicit `not-a-ui-project` verdict: no
 * dimension is scored, so it is neither 0 nor a pass.
 *
 * Pages are the markup files under the paved road's page roots, plus every
 * stylesheet the CSS reader followed (`readCssProject`), so a plain-CSS page's
 * declarations are judged on their own file. Within a declared page root a
 * markup file is scored only when it is a ROUTE ENTRY (Task 6c; the derivation
 * is `isRouteEntry`), and a test module is never scored at all. Anything else
 * is context: the import closure may read it, but it is never a scored page
 * (Task 6a; see `audit-scope.ts`) — though value dimensions read it per page
 * (Task 6d). The same variable table feeds every unit: a `var()` resolves only
 * when all its definitions agree, and a state-dependent variable stays
 * unmeasured (Task 3b's rule).
 *
 * The import closure follows RELATIVE imports and the project's PATH ALIASES
 * (Task 6c): the alias table is read from the app's tsconfig, an alias that
 * names no file is counted in `readGaps`, and test modules are never followed.
 * Runtime CSS-in-JS remains a named gap, never silently absent.
 *
 * S8 render evidence is optional: `render` carries captures decoded once and
 * bound to a page by route or probe slug. `renderGap` carries the `--render`
 * reader's truncation/skip note. The result's `render` summary names every
 * capture, its measured non-app share and the page it bound to, so the report
 * can show what was used instead of implying full coverage.
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { oversizedContracts, type OversizedFile } from '../file-cap.js';
import type { PavedRoadFile } from '../paved-road.js';
import { readPavedRoad } from '../source-scan/inputs.js';
import type { AuditFinding, AuditSource, AuditDimension } from './audit-finding.js';
import { readAuditContract } from './audit-contract.js';
import { readCssProject, type CssProject } from './audit-css.js';
import { pageRootsOf, type AuditScope } from './audit-scope.js';
import { auditedOutcome, unmatchedCaptureGap } from './audit-outcome.js';
import {
  auditPages,
  pagePaths,
  runtimeState,
  type AuditPage,
  type AuditRuntimeState
} from './audit-pages.js';
import type { AuditContract } from './audit-unit.js';
import { walkFiles } from './audit-walk.js';
import { readPathAliases, type PathAlias } from './path-aliases.js';
import {
  readRenderFrames,
  type RenderCapture,
  type RenderEvidenceSummary,
  type RenderFrame
} from './render/render-audit.js';
import { createSourceCache, type SourceCache } from './source-cache.js';
import { isNonUiRoot } from './source-filters.js';

export type { AuditPage, AuditRuntimeState } from './audit-pages.js';

/** Files that make an app root a UI project (a `.ts`-only repo is not one). */
const UI_EXTENSIONS = new Set(['.tsx', '.jsx', '.vue', '.svelte', '.css', '.scss']);

/** The two contract files the audit cannot run without. */
const CONTRACT_FILES = ['tokens.json', 'paved-road.json'] as const;

/** The contract paths a report cites, app-root relative. */
export type AuditContractRef = { tokens: string; pavedRoad: string };

/** The four outcomes a project read can have: two verdicts, two refusals. */
export type AuditProjectResult =
  | { kind: 'not-a-ui-project'; appRoot: string }
  | { kind: 'contract-missing'; appRoot: string; missing: string[] }
  | { kind: 'contract-too-large'; appRoot: string; files: OversizedFile[] }
  | {
      kind: 'audited';
      appRoot: string;
      designRoot: string;
      contract: AuditContractRef;
      contractSource: AuditContract;
      state: AuditRuntimeState;
      /** Which sources were pages and what was context only (Task 6a). */
      scope: AuditScope;
      /** Contract warnings (a malformed tokenScale) the CLI surfaces, never hides. */
      warnings: string[];
      pages: AuditPage[];
      globalFindings: AuditFinding[];
      /** Which contract-level dimensions were actually judged (S8). */
      contractJudged: Partial<Record<AuditDimension, boolean>>;
      /** The captures supplied, what was measured from each, and the read gap. */
      render: RenderEvidenceSummary;
    };

/**
 * True when the app root holds at least one UI-bearing source file. A tree
 * whose only UI files are a shipped `examples/` demo, the `docs/` site or a
 * `fixtures/` set is not a UI project.
 */
export function hasUiSources(appRoot: string): boolean {
  return walkFiles(appRoot, '.', UI_EXTENSIONS).some((file) => !isNonUiRoot(file));
}

/** Squash the per-import alias gaps into ONE counted read-gap line. */
function summarizeAliasGaps(gaps: readonly string[]): string[] {
  const aliases = gaps.filter((gap) => gap.startsWith('alias '));
  const rest = gaps.filter((gap) => !gap.startsWith('alias '));
  if (aliases.length > 0) {
    const witness = (aliases[0] ?? '').replace(/^alias /, '');
    rest.push(`${aliases.length} path-alias imports could not be resolved (${witness})`);
  }
  return rest;
}

/** Everything one contract read produces, so the entry point stays short. */
export type ContractRead = {
  appRoot: string;
  paved: PavedRoadFile;
  contract: AuditContract;
  roots: string[];
  aliases: PathAlias[];
  cssProject: CssProject;
  cssFiles: Map<string, AuditSource>;
};

/** The two contract files, the aliases, and the stylesheet walk. */
function readContractProject(
  appRoot: string,
  designRoot: string,
  cache: SourceCache
): ContractRead {
  const paved = readPavedRoad(designRoot);
  const roots = pageRootsOf(paved.pageRoots);
  const cssProject = readCssProject({ appRoot, pageRoots: roots, exclude: paved.exclude, cache });
  return {
    appRoot,
    paved,
    contract: readAuditContract(designRoot),
    roots,
    aliases: readPathAliases(appRoot, cssProject.skipped),
    cssProject,
    cssFiles: new Map(cssProject.sources.map((source) => [source.file, source]))
  };
}

/**
 * The three verdicts/refusals that stop before any page is read: no UI source
 * at all, a missing contract file, or a contract file past the byte cap.
 */
function refusedBeforeReading(appRoot: string, designRoot: string): AuditProjectResult | null {
  if (!hasUiSources(appRoot)) return { kind: 'not-a-ui-project', appRoot };
  const missing = CONTRACT_FILES.filter((file) => !existsSync(join(designRoot, file)));
  if (missing.length > 0) return { kind: 'contract-missing', appRoot, missing };
  // A contract larger than the cap is REFUSED, never parsed: an over-cap file
  // is not a declaration this audit can trust.
  const oversized = oversizedContracts(designRoot, CONTRACT_FILES);
  if (oversized.length > 0) return { kind: 'contract-too-large', appRoot, files: oversized };
  return null;
}

/** Discover the page units and audit each one, accumulating the two file sets. */
function readPages(input: {
  appRoot: string;
  read: ContractRead;
  state: AuditRuntimeState;
  cache: SourceCache;
  frames: readonly RenderFrame[];
}): { pages: AuditPage[]; context: Set<string>; valueFiles: Set<string> } {
  const { appRoot, read, state, cache, frames } = input;
  const paths = pagePaths(
    {
      appRoot,
      roots: read.roots,
      declaredRoots: read.paved.pageRoots.length > 0,
      exclude: read.paved.exclude,
      cssFiles: read.cssFiles
    },
    { gaps: state.readGaps }
  );
  const context = new Set<string>();
  const valueFiles = new Set<string>();
  const pages = auditPages({
    appRoot,
    paths,
    cssFiles: read.cssFiles,
    paved: read.paved,
    contract: read.contract,
    variables: read.cssProject.variables,
    styles: read.cssProject.sources,
    aliases: read.aliases,
    render: frames,
    cache,
    state,
    context,
    valueFiles
  });
  return { pages, context, valueFiles };
}

/**
 * Read one app root and audit every page unit. The three outcomes are the
 * caller's exit contract: `not-a-ui-project` is a verdict, `contract-missing`
 * is a refusal, and only `audited` carries scores.
 *
 * `render` is optional S8 evidence: each capture is decoded once and bound to a
 * page by route (or probe slug). A tree with no captures still audits its
 * source dimensions exactly as S7 did; the render dimensions then report
 * `unmeasured`/`not judged`, never 0 and never a silent 100.
 */
export function runAuditProject(input: {
  appRoot: string;
  render?: readonly RenderCapture[];
  /** The `--render` reader's truncation/skip note, printed as a read gap. */
  renderGap?: string;
}): AuditProjectResult {
  const appRoot = resolve(input.appRoot);
  const designRoot = join(appRoot, 'design');
  const refused = refusedBeforeReading(appRoot, designRoot);
  if (refused !== null) return refused;

  // ONE cache for the whole run: stylesheets, pages and closures read each real
  // file once and share its AuditSource object (Task 6e).
  const cache = createSourceCache(appRoot);
  const read = readContractProject(appRoot, designRoot, cache);
  const frames = readRenderFrames(input.render ?? []);
  const state = runtimeState(read.cssProject);
  const { pages, context, valueFiles } = readPages({ appRoot, read, state, cache, frames });
  const unmatched = unmatchedCaptureGap(pages, frames);
  if (unmatched !== null) state.readGaps.push(unmatched);
  state.readGaps = summarizeAliasGaps([...new Set(state.readGaps)]).sort((left, right) =>
    left.localeCompare(right)
  );

  return auditedOutcome({
    appRoot,
    designRoot,
    read,
    frames,
    state,
    pages,
    context,
    valueFiles,
    ...(input.render?.[0]?.capture === undefined ? {} : { probeFile: input.render[0].capture }),
    ...(input.renderGap === undefined ? {} : { renderGap: input.renderGap })
  });
}
