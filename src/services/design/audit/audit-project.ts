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
 */

import { existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { normalizePath } from '../../../shared/path-utils.js';
import { oversizedContracts, readCappedText, type OversizedFile } from '../file-cap.js';
import type { PavedRoadFile } from '../paved-road.js';
import { readPavedRoad } from '../source-scan/inputs.js';
import type { AuditFinding, AuditSource } from './audit-finding.js';
import { sanitizeFindings } from './audit-echo.js';
import type { ColorTokenGroup } from './audit-color.js';
import { auditContrast, type DeclaredColorPair } from './audit-contrast.js';
import { readCssProject, type CssProject } from './audit-css.js';
import { buildAuditScope, pageRootsOf, type AuditScope } from './audit-scope.js';
import { auditPages, pagePaths, type AuditPage, type AuditRuntimeState } from './audit-pages.js';
import type { AuditContract } from './audit-unit.js';
import { walkFiles } from './audit-walk.js';
import { readPathAliases, type PathAlias } from './path-aliases.js';
import { createSourceCache, type SourceCache } from './source-cache.js';
import { isNonUiRoot } from './source-filters.js';
import { stateNames, type CssVariableTable } from './css-variables.js';

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
    };

function readJson(filePath: string): Record<string, unknown> {
  const read = readCappedText(filePath);
  if (read.kind !== 'read') return {};
  try {
    const parsed: unknown = JSON.parse(read.text);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function colorGroup(value: unknown): ColorTokenGroup | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const group: ColorTokenGroup = {};
  for (const [key, token] of Object.entries(value as Record<string, unknown>)) {
    if (token === null || typeof token !== 'object') continue;
    const parsed = token as { $value?: unknown };
    if (typeof parsed.$value === 'string') group[key] = { $value: parsed.$value };
  }
  return group;
}

/** The declared pairs are validated again by `auditContrast`; this only shapes. */
function declaredPairs(value: unknown): DeclaredColorPair[] {
  return Array.isArray(value) ? (value as DeclaredColorPair[]) : [];
}

/**
 * True when the app root holds at least one UI-bearing source file. A tree
 * whose only UI files are a shipped `examples/` demo, the `docs/` site or a
 * `fixtures/` set is not a UI project — those trees are not the product's UI
 * (Task 6c), and treating them as one turned a missing contract into a refusal
 * for a repository that has no UI at all.
 */
export function hasUiSources(appRoot: string): boolean {
  return walkFiles(appRoot, '.', UI_EXTENSIONS).some((file) => !isNonUiRoot(file));
}

/** States in which a variable resolved to exactly one value — the ones used. */
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

function runtimeState(cssProject: CssProject): AuditRuntimeState {
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

function contractRef(appRoot: string, designRoot: string): AuditContractRef {
  const rel = (file: string): string => normalizePath(relative(appRoot, join(designRoot, file)));
  return { tokens: rel('tokens.json'), pavedRoad: rel('paved-road.json') };
}

/** The contrast audit needs the colour group only when the contract declares one. */
function globalContrast(contract: AuditContract, tokensFile: string): AuditFinding[] {
  const color = contract.color === undefined ? {} : { color: contract.color };
  return auditContrast({ ...color, pairs: contract.pairs }, tokensFile);
}

/**
 * Squash the per-import alias gaps into ONE counted read-gap line. The pilot
 * had 3,465 alias imports; after alias resolution the remaining gaps are the
 * genuinely broken ones, and a person needs their count and a witness, not
 * a thousand near-identical lines.
 */
function summarizeAliasGaps(gaps: readonly string[]): string[] {
  const aliases = gaps.filter((gap) => gap.startsWith('alias '));
  const rest = gaps.filter((gap) => !gap.startsWith('alias '));
  if (aliases.length > 0) {
    const witness = (aliases[0] ?? '').replace(/^alias /, '');
    rest.push(`${aliases.length} path-alias imports could not be resolved (${witness})`);
  }
  return rest;
}

/** Deduplicate and order the final read gaps, squashing the alias set first. */
function finalizeReadGaps(state: AuditRuntimeState): void {
  state.readGaps = summarizeAliasGaps([...new Set(state.readGaps)]).sort((left, right) =>
    left.localeCompare(right)
  );
}

/** Everything one contract read produces, so the entry point stays short. */
type ContractRead = {
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
  const raw = readJson(join(designRoot, 'tokens.json'));
  const roots = pageRootsOf(paved.pageRoots);
  const cssProject = readCssProject({ appRoot, pageRoots: roots, exclude: paved.exclude, cache });
  return {
    appRoot,
    paved,
    contract: { color: colorGroup(raw.color), pairs: declaredPairs(raw.pairs) },
    roots,
    aliases: readPathAliases(appRoot, cssProject.skipped),
    cssProject,
    cssFiles: new Map(cssProject.sources.map((source) => [source.file, source]))
  };
}

/** The page units plus the two file sets the scope reports (Task 6a / 6d). */
function readPages(
  read: ContractRead,
  paths: readonly string[],
  state: AuditRuntimeState,
  cache: SourceCache
): { pages: AuditPage[]; context: Set<string>; valueFiles: Set<string> } {
  const context = new Set<string>();
  const valueFiles = new Set<string>();
  const pages = auditPages({
    appRoot: read.appRoot,
    paths,
    cssFiles: read.cssFiles,
    paved: read.paved,
    contract: read.contract,
    variables: read.cssProject.variables,
    styles: read.cssProject.sources,
    aliases: read.aliases,
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
 */
export function runAuditProject(input: { appRoot: string }): AuditProjectResult {
  const appRoot = resolve(input.appRoot);
  if (!hasUiSources(appRoot)) return { kind: 'not-a-ui-project', appRoot };
  const designRoot = join(appRoot, 'design');
  const missing = CONTRACT_FILES.filter((file) => !existsSync(join(designRoot, file)));
  if (missing.length > 0) return { kind: 'contract-missing', appRoot, missing };
  // A contract larger than the cap is REFUSED, never parsed: an over-cap file
  // is not a declaration this audit can trust.
  const oversized = oversizedContracts(designRoot, CONTRACT_FILES);
  if (oversized.length > 0) return { kind: 'contract-too-large', appRoot, files: oversized };

  // ONE cache for the whole run: stylesheets, pages and closures read each real
  // file once and share its AuditSource object (Task 6e).
  const cache = createSourceCache(appRoot);
  const read = readContractProject(appRoot, designRoot, cache);
  const state = runtimeState(read.cssProject);
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
  const { pages, context, valueFiles } = readPages(read, paths, state, cache);
  finalizeReadGaps(state);

  const scope = buildAuditScope({
    declaredRoots: read.paved.pageRoots,
    scoredPages: pages.length,
    contextFiles: context,
    scoredPaths: new Set(pages.map((page) => page.path)),
    valueFiles
  });
  const globalFindings = sanitizeFindings(
    globalContrast(read.contract, contractRef(appRoot, designRoot).tokens)
  );
  const truncated = state.truncated || pages.some((page) => page.truncated);
  return {
    kind: 'audited',
    appRoot,
    designRoot,
    contract: contractRef(appRoot, designRoot),
    contractSource: read.contract,
    state: { ...state, truncated },
    scope,
    warnings: (read.paved.warnings ?? []).map((warning) => warning.message),
    pages,
    globalFindings
  };
}
