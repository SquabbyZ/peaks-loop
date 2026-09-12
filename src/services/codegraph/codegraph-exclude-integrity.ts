// src/services/codegraph/codegraph-exclude-integrity.ts
//
// Slice S2 of `2026-09-12-codegraph-exclude-integrity` — the READ-ONLY
// integrity report shared by `peaks codegraph status` and the
// `capability:codegraph-exclude-integrity` doctor check.
//
// S1's reconciler computes the raw truth (`violations` /
// `rulesToRemove`). This module folds it into a verdict-shaped report
// that both consumers can render and gate on, so neither of them has
// to re-derive "is there a gap, how big, and which rules cause it".
//
// It NEVER writes `.codegraph/config.json`. The only write path is
// `codegraph-exclude-repair.ts`, reachable from `peaks codegraph init`
// (fresh-initialization self-heal) and the explicit
// `peaks codegraph repair-exclude` command. Read stays read.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  CODEGRAPH_CONFIG_FILENAME,
  reconcileCodegraphExcludeFromProject,
  type CodegraphExcludeViolation
} from './codegraph-exclude-reconciler.js';
import { CODEGRAPH_DIR_NAME } from './codegraph-service.js';

/**
 * Exit code `peaks codegraph status` uses when the index is
 * demonstrably incomplete. Distinct from the upstream pass-through
 * exit code and from `CODEGRAPH_INIT_CONFLICT_EXIT_CODE` (73) so a CI
 * job can tell "codegraph said no" apart from "peaks-loop found a
 * tracked source file the index silently dropped".
 */
export const CODEGRAPH_INTEGRITY_EXIT_CODE = 74;

/** How many offending rules and blocked files we name on the human path. */
const MAX_REPORTED_RULES = 10;
const MAX_REPORTED_FILES = 10;

export type CodegraphExcludeRuleImpact = {
  /** The `exclude` rule that must be dropped. */
  readonly rule: string;
  /** Distinct tracked source files this single rule blocks. */
  readonly blockedCount: number;
};

export type CodegraphExcludeIntegrityReport = {
  /** Absolute path of the reconciled `.codegraph/config.json`. */
  readonly configPath: string;
  /** True when at least one tracked source file is blocked. */
  readonly gap: boolean;
  /** Tracked files that pass the config's `include` filter at all. */
  readonly trackedSourceCount: number;
  /** Distinct tracked source files blocked by at least one rule. */
  readonly excludedTrackedCount: number;
  /** One entry per (file, rule) pair — see S1's reconciler. */
  readonly violations: readonly CodegraphExcludeViolation[];
  /** Rules that must be dropped; empty exactly when `gap` is false. */
  readonly rulesToRemove: readonly string[];
  /** Per-rule blocked-file counts, in `rulesToRemove` order. */
  readonly ruleImpacts: readonly CodegraphExcludeRuleImpact[];
};

/**
 * True when `<projectRoot>/.codegraph/config.json` exists, i.e. when an
 * exclude list is actually in play here. Both consumers use this to
 * stay SILENT on a project that never ran `peaks codegraph init`: there
 * is no exclusion to report, and a missing config is not a finding.
 *
 * Note the difference from `isCodegraphInitialized` in
 * `codegraph-service.ts`, which probes `codegraph.db` (upstream's own
 * definition of "initialized"). The exclude list is written by upstream
 * init, so its presence is the narrower question this module asks.
 */
export function isCodegraphExcludeConfigPresent(projectRoot: string): boolean {
  return existsSync(join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME));
}

/**
 * Read the project's git-tracked files + `.codegraph/config.json` and
 * fold the reconciliation into a report.
 *
 * Throws (never silently degrades) when the project is not a git work
 * tree, when the config is missing, or when it is malformed — callers
 * that must stay alive (doctor, `status`) catch and surface the reason.
 */
export function inspectCodegraphExcludeIntegrity(projectRoot: string): CodegraphExcludeIntegrityReport {
  const result = reconcileCodegraphExcludeFromProject(projectRoot);

  const blockedCounts = new Map<string, number>();
  for (const violation of result.violations) {
    blockedCounts.set(violation.matchedRule, (blockedCounts.get(violation.matchedRule) ?? 0) + 1);
  }

  return {
    configPath: join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME),
    gap: result.excludedTrackedCount > 0,
    trackedSourceCount: result.trackedSourceCount,
    excludedTrackedCount: result.excludedTrackedCount,
    violations: result.violations,
    rulesToRemove: result.rulesToRemove,
    ruleImpacts: result.rulesToRemove.map((rule) => ({ rule, blockedCount: blockedCounts.get(rule) ?? 0 }))
  };
}

/**
 * Human-readable detail lines for a gapped report: the headline count,
 * then the offending rules, then a sample of the blocked files so an
 * operator can point at a concrete path without re-running anything.
 *
 * Returns an empty array for a clean report — the caller decides
 * whether "clean" is worth printing at all.
 */
export function renderCodegraphExcludeIntegrityLines(
  report: CodegraphExcludeIntegrityReport
): readonly string[] {
  if (!report.gap) {
    return [];
  }

  const lines: string[] = [
    `[FAIL] codegraph index is incomplete: ${report.excludedTrackedCount} of ${report.trackedSourceCount} tracked source files are excluded by ${report.rulesToRemove.length} rule(s).`
  ];

  for (const impact of report.ruleImpacts.slice(0, MAX_REPORTED_RULES)) {
    lines.push(`  rule ${impact.rule} blocks ${impact.blockedCount} tracked file(s)`);
  }
  if (report.ruleImpacts.length > MAX_REPORTED_RULES) {
    lines.push(`  … and ${report.ruleImpacts.length - MAX_REPORTED_RULES} more rule(s)`);
  }

  for (const violation of report.violations.slice(0, MAX_REPORTED_FILES)) {
    lines.push(`  excluded: ${violation.path} <- ${violation.matchedRule}`);
  }
  if (report.violations.length > MAX_REPORTED_FILES) {
    lines.push(`  … and ${report.violations.length - MAX_REPORTED_FILES} more file/rule pair(s)`);
  }

  lines.push(
    'Run `peaks codegraph repair-exclude --project <root>` to drop these rules, back up the config, and rebuild the index.'
  );

  return lines;
}
