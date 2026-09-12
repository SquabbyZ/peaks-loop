// src/services/codegraph/codegraph-exclude-reconciler.ts
//
// Slice S1 of `2026-09-12-codegraph-exclude-integrity` — the pure
// reconciliation core. It answers one question:
//
//   "Which git-tracked source files does the codegraph `exclude` list
//    silently block, and which rules must be removed to unblock them?"
//
// Why this exists (the real defect): upstream `@colbymchenry/codegraph`
// ships a 99-entry default `exclude` template matched by *directory
// name* via `picomatch.isMatch(path, pattern, { dot: true })`. Upstream
// `mergeConfig` has no separate override channel — `config.json`'s
// `exclude` array replaces the defaults wholesale — so any default rule
// whose directory name collides with real source silently drops tracked
// files from the index while `peaks codegraph status` still reports
// `[OK] Index is up to date`. This repo has five such rules:
// `**` + `/artifacts/**`, `**` + `/release/**`, `**` + `/vendor/**`,
// `**` + `/bin/**`, `**` + `/publish/**`.
//
// Scope of this module:
//   - PURE: `reconcileCodegraphExclude` takes already-resolved data and
//     computes violations + the rules to remove. No fs, no spawn.
//   - ADAPTER: `readTrackedFiles` / `readCodegraphExcludeConfig` /
//     `reconcileCodegraphExcludeFromProject` are the thin
//     boundary-reading helpers. They READ ONLY — this module never
//     writes `.codegraph/config.json` (that is S2's repair path).
//
// It is deliberately generic: no hardcoded rule list. Any rule that
// blocks a tracked source file is caught by the same logic, in this
// repo or any other.
//
// NOTE FOR FUTURE EDITORS: glob literals contain the two-character
// sequence that ends a block comment, so every comment in this file
// uses `//` lines. Do not convert them to `/* ... */`.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import picomatch from 'picomatch';
import type { Matcher } from 'picomatch';

import { normalizePath } from '../../shared/path-utils.js';
import { CODEGRAPH_DIR_NAME } from './codegraph-service.js';

// ─────────────────────────────────────────────────────────────────────
// Glob matching — delegated to `picomatch`, the same engine upstream uses
//
// Upstream `@colbymchenry/codegraph` matches its `exclude` / `include`
// globs with `picomatch.isMatch(path, pattern, { dot: true })`.
//
// This module used to re-implement that matcher by hand, covering only
// `**`, `*` and `?`. That was a silent-failure generator: the hand-rolled
// version returned `false` for every *extended* glob (`{a,b}`, `[abc]`,
// `!(...)`), so a config carrying `**/{release,artifacts}/**` was
// reconciled as clean while the gap was still there — `init` and
// `repair-exclude` reported success over an incomplete index, which is
// the exact failure this mechanism exists to prevent. The generated
// regexes were also superlinear in the number of `**/` segments.
//
// So the matcher IS picomatch now: promoted from a transitive dependency
// of `@colbymchenry/codegraph` to a direct one, pinned to the version
// already in the tree (4.0.4). No new install weight, no fork of the
// semantics, and no way to drift from upstream again.
//
// `dot: true` keeps upstream's semantics: `*` and `?` also match a
// leading `.`.
//
// NOTE: this delegation was differential-tested against the previous
// implementation over every git-tracked file in this repo x every rule
// of both the upstream 99-rule default template and this repo's config,
// with zero disagreements on the vocabulary the old matcher supported —
// the only differences being the extended globs it used to get wrong.
//
// One side effect of the delegation had to be repaired right after it
// shipped: `picomatch('')` throws, so a config carrying `"exclude": [""]`
// made the whole reconciliation throw, and `peaks codegraph status`
// turned that into `[WARN] … not evaluated` with exit 0 — a silent false
// pass over a real index gap, which is precisely what this module exists
// to prevent. Empty / whitespace-only rules are now skipped before
// compilation (`isUnmatchableRule`), so no single junk entry can mask the
// verdict of the other rules.
// ─────────────────────────────────────────────────────────────────────

const PICOMATCH_OPTIONS = { dot: true } as const;

type CompiledGlob = {
  readonly pattern: string;
  readonly match: Matcher;
};

// `picomatch(glob, options)` parses the glob once and returns a reusable
// matcher. Compiling per rule (not per file x rule) is what keeps a
// reconciliation over N files x M rules linear in N.
function compileGlob(pattern: string): CompiledGlob {
  return { pattern, match: picomatch(pattern, PICOMATCH_OPTIONS) };
}

// A rule that carries no glob at all — empty or whitespace-only — cannot
// name a project-relative source path, so it is skipped instead of
// compiled.
//
// Why this guard exists (regression introduced by the very commit that
// delegated matching to picomatch): `picomatch('')` THROWS
// ("Expected pattern to be a non-empty string"). A config carrying
// `"exclude": [""]` therefore aborted the whole reconciliation, and the
// consumers degraded that throw into a silent false pass — `status`
// printed `[WARN] codegraph exclude integrity not evaluated` and left
// the exit code at 0 while tracked source files were still excluded.
// Skipping the rule is semantically exact (it matches nothing) and keeps
// every OTHER rule's verdict, so one junk entry can never mask a real
// gap. `picomatch('   ')` does not throw; it simply matches no real path,
// so dropping it is a no-op with the same outcome.
function isUnmatchableRule(pattern: string): boolean {
  return pattern.trim().length === 0;
}

// Compile a rule list, dropping the rules that cannot match anything.
function compileRules(patterns: readonly string[]): readonly CompiledGlob[] {
  return patterns.filter((pattern) => !isUnmatchableRule(pattern)).map(compileGlob);
}

// Does `filePath` match `pattern` under the same rules upstream uses?
// Exported so the test suite can pin the glob semantics directly,
// including the negative case: the artifacts rule must NOT match
// `src/artifactsman/foo.ts`.
//
// Total by construction: an unmatchable rule answers `false` rather than
// throwing, so no caller can be turned into a false pass by one junk
// entry in the config. For every non-empty pattern the answer is the
// picomatch answer, unchanged.
export function matchesCodegraphGlob(filePath: string, pattern: string): boolean {
  if (isUnmatchableRule(pattern)) {
    return false;
  }

  return compileGlob(pattern).match(normalizePath(filePath));
}

// ─────────────────────────────────────────────────────────────────────
// Pure reconciliation
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeReconcileInput = {
  // Project-relative paths of git-tracked files (`git ls-files`), in
  // any order. Windows separators are tolerated and normalized.
  readonly trackedFiles: readonly string[];
  // The codegraph config's `include` globs.
  readonly include: readonly string[];
  // The codegraph config's `exclude` globs.
  readonly exclude: readonly string[];
};

export type CodegraphExcludeViolation = {
  // Normalized project-relative path of the blocked tracked file.
  readonly path: string;
  // The single `exclude` rule that matched `path`.
  readonly matchedRule: string;
};

export type CodegraphExcludeReconcileResult = {
  // One entry per (file, rule) pair, in `trackedFiles` order with rules
  // in `exclude` order. A file blocked by two rules produces two
  // entries — `excludedTrackedCount` is the count of DISTINCT files.
  readonly violations: readonly CodegraphExcludeViolation[];
  // Rules to drop from `exclude`, in their original config order. A
  // rule is listed ONLY when it actually blocks at least one tracked
  // source file, so blanket-but-harmless rules (`node_modules`, `dist`)
  // are never touched. Applying the removal makes a re-run return an
  // empty list — the operation is idempotent.
  readonly rulesToRemove: readonly string[];
  // Tracked files that pass the `include` filter at all.
  readonly trackedSourceCount: number;
  // Distinct tracked source files blocked by at least one rule.
  readonly excludedTrackedCount: number;
};

// Reconcile the codegraph `exclude` list against the set of git-tracked
// source files. Pure: no fs, no spawn, no clock.
//
// The `include` filter runs first: a rule that only blocks files the
// index would not ingest anyway (e.g. a markdown-only rule) is not a
// violation and is not removed.
export function reconcileCodegraphExclude(
  input: CodegraphExcludeReconcileInput
): CodegraphExcludeReconcileResult {
  // Unmatchable rules are dropped from BOTH lists before compiling — see
  // `isUnmatchableRule`. An empty `include` entry admits nothing, which
  // is the same verdict as an explicitly empty `include` list, so it
  // needs no special case here.
  const includeRules = compileRules(input.include);
  const excludeRules = compileRules(input.exclude);

  const trackedSourceFiles: string[] = [];

  for (const candidate of input.trackedFiles) {
    const normalizedPath = normalizePath(candidate);

    if (includeRules.some((rule) => rule.match(normalizedPath))) {
      trackedSourceFiles.push(normalizedPath);
    }
  }

  const violations: CodegraphExcludeViolation[] = [];
  const offendingRules = new Set<string>();
  const blockedFiles = new Set<string>();

  for (const path of trackedSourceFiles) {
    for (const rule of excludeRules) {
      if (!rule.match(path)) {
        continue;
      }

      violations.push({ path, matchedRule: rule.pattern });
      offendingRules.add(rule.pattern);
      blockedFiles.add(path);
    }
  }

  return {
    violations,
    rulesToRemove: input.exclude.filter((pattern) => offendingRules.has(pattern)),
    trackedSourceCount: trackedSourceFiles.length,
    excludedTrackedCount: blockedFiles.size
  };
}

// ─────────────────────────────────────────────────────────────────────
// Thin boundary adapters — READ ONLY
// ─────────────────────────────────────────────────────────────────────

// Upstream `CONFIG_FILENAME` inside `<projectRoot>/.codegraph/`.
export const CODEGRAPH_CONFIG_FILENAME = 'config.json';

export type CodegraphExcludeConfig = {
  readonly include: readonly string[];
  readonly exclude: readonly string[];
};

// Project-relative paths of every git-tracked file, exactly as
// `git ls-files` reports them. Why git and not an fs walk: the index
// must cover what git tracks (see the anti-fake-green contract in
// `src/services/dispatch/dispatch-sub-agent.ts`), so git is the only
// admissible source of truth.
//
// Throws when `projectRoot` is not inside a git work tree — callers
// decide whether that is fatal; this function never swallows it.
export function readTrackedFiles(projectRoot: string): readonly string[] {
  const stdout = execFileSync('git', ['-C', projectRoot, 'ls-files'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });

  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => normalizePath(line));
}

// Exported for S2's repair writer, which re-validates `exclude` on the
// way out so the read and write paths agree on what a valid config is.
export function assertStringArray(value: unknown, field: string, configPath: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`codegraph config ${configPath}: "${field}" must be an array of strings`);
  }

  return value as readonly string[];
}

// Read `<projectRoot>/.codegraph/config.json` and return just the two
// glob lists the reconciler needs. Read-only: this module never writes
// that file.
export function readCodegraphExcludeConfig(projectRoot: string): CodegraphExcludeConfig {
  const configPath = join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME);
  const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`codegraph config ${configPath}: expected a JSON object`);
  }

  const record = parsed as Record<string, unknown>;

  return {
    include: assertStringArray(record.include, 'include', configPath),
    exclude: assertStringArray(record.exclude, 'exclude', configPath)
  };
}

// Read-only entry point: resolve the project's tracked files + codegraph
// config from disk and reconcile them. S2's repair path consumes this
// result and writes the reduced `exclude` list back; S1 only computes.
export function reconcileCodegraphExcludeFromProject(
  projectRoot: string
): CodegraphExcludeReconcileResult {
  const trackedFiles = readTrackedFiles(projectRoot);
  const { include, exclude } = readCodegraphExcludeConfig(projectRoot);

  return reconcileCodegraphExclude({ trackedFiles, include, exclude });
}
