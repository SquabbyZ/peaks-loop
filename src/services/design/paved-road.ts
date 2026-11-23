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
  componentEntrypoints: string[];
  allowDirectLibraryImports: string[];
  bannedImportSpecifiers: string[];
  banned: PavedRoadBanned;
  rules: Record<DesignRuleCode, DesignRuleSeverity>;
  tokenScale: DesignTokenScale;
};

export type PavedRoadInput = {
  pageRoots: readonly string[];
  componentEntrypoints: readonly string[];
  allowDirectLibraryImports?: readonly string[];
  bannedImportSpecifiers?: readonly string[];
};

const DEFAULT_TOKEN_SCALE: DesignTokenScale = {
  space: ['4', '8', '12', '16', '24', '32', '48'],
  font: ['12', '14', '16', '20', '24', '32'],
  radius: ['2', '4', '8', '12'],
  color: ['--color-*']
};

export function buildPavedRoad(input: PavedRoadInput): PavedRoadFile {
  return {
    schemaVersion: 1,
    pageRoots: [...input.pageRoots],
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
