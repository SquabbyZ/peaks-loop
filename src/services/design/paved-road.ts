/**
 * The paved road — `design/paved-road.json`.
 *
 * The paved road names where pages may live, which component entrypoints they
 * must import from, and which stylistic shortcuts are banned. The `rules`
 * object is the machine-readable half of the same contract: the scanner reads
 * it to decide whether a symptom fails the slice or only warns.
 */

import {
  DEFAULT_DESIGN_RULES,
  type DesignRuleCode,
  type DesignRuleSeverity
} from './design-rules.js';

/** The token scale a project is expected to stay on. */
export type DesignTokenScale = {
  space: string[];
  font: string[];
  radius: string[];
  color: string[];
  /**
   * Optional weight ladder. Absent in the built-in default and in every
   * contract written before S7, so the type audit reports the weight part as
   * `unmeasured` instead of inventing a vocabulary the project never declared.
   */
  weight?: string[];
};

/**
 * A contract field that could not be read and was replaced by its default.
 * `code` is stable so a caller can surface the substitution rather than let a
 * malformed file silently audit the project against a ladder it never declared.
 */
export type PavedRoadWarning = {
  /**
   * `token-scale-malformed` is a declared field replaced by its default;
   * `contract-too-large` is a whole contract refused for its size.
   */
  code: 'token-scale-malformed' | 'contract-too-large';
  message: string;
};

/** The three stylistic shapes the paved road bans outright. */
export type PavedRoadBanned = {
  inlineStyle: boolean;
  rawHex: boolean;
  arbitraryTailwind: boolean;
};

export type PavedRoadFile = {
  schemaVersion: 1;
  pageRoots: string[];
  /** Paths the source scan stays out of; absent in files written before S5. */
  exclude: string[];
  /**
   * Optional route -> marker copy the probe can expect on that route (S6).
   * Absent in older files and in projects that declare none; the probe then
   * judges only the measured generic signals.
   */
  routeMarkers: Record<string, string>;
  componentEntrypoints: string[];
  allowDirectLibraryImports: string[];
  bannedImportSpecifiers: string[];
  banned: PavedRoadBanned;
  rules: Record<DesignRuleCode, DesignRuleSeverity>;
  tokenScale: DesignTokenScale;
  /**
   * Set only by a reader that replaced a malformed declared field with its
   * default. A builder never writes it, so a healthy contract carries none.
   */
  warnings?: PavedRoadWarning[];
};

export type PavedRoadInput = {
  pageRoots: readonly string[];
  componentEntrypoints: readonly string[];
  exclude?: readonly string[];
  allowDirectLibraryImports?: readonly string[];
  bannedImportSpecifiers?: readonly string[];
  routeMarkers?: Readonly<Record<string, string>>;
};

/**
 * The ladder a contract is audited against when it declares none. Exported so
 * a reader's fallback and a test's expectation are the same object of record.
 */
export const DEFAULT_TOKEN_SCALE: DesignTokenScale = {
  space: ['4', '8', '12', '16', '24', '32', '48'],
  font: ['12', '14', '16', '20', '24', '32'],
  radius: ['2', '4', '8', '12'],
  color: ['--color-*']
};

/**
 * A list field read from disk. An older `paved-road.json` has no `exclude`, so
 * absent (or malformed) becomes an empty list instead of a crash — this is the
 * tolerance seam every reader of the file shares.
 */
export function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

/** First-seen order, repeats dropped, so a re-run cannot duplicate an entry. */
export function uniqueList(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * A route -> marker map read from disk. Only non-empty string values under a
 * non-empty key survive; a malformed or absent map reads as "none declared".
 */
export function markerMap(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] =>
      entry[0].trim() !== '' && typeof entry[1] === 'string' && entry[1].trim() !== ''
  );
  return Object.fromEntries(entries);
}

export function buildPavedRoad(input: PavedRoadInput): PavedRoadFile {
  return {
    schemaVersion: 1,
    pageRoots: [...input.pageRoots],
    exclude: [...(input.exclude ?? [])],
    routeMarkers: { ...(input.routeMarkers ?? {}) },
    componentEntrypoints: [...input.componentEntrypoints],
    allowDirectLibraryImports: [...(input.allowDirectLibraryImports ?? [])],
    bannedImportSpecifiers: [...(input.bannedImportSpecifiers ?? [])],
    banned: { inlineStyle: true, rawHex: true, arbitraryTailwind: true },
    rules: { ...DEFAULT_DESIGN_RULES },
    tokenScale: {
      space: [...DEFAULT_TOKEN_SCALE.space],
      font: [...DEFAULT_TOKEN_SCALE.font],
      radius: [...DEFAULT_TOKEN_SCALE.radius],
      color: [...DEFAULT_TOKEN_SCALE.color]
    }
  };
}
