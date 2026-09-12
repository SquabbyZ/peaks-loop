/**
 * Check: the third-party ECC plugin ships `hooks/hooks.json` keys that
 * Claude Code's plugin hook schema ignores
 * (`integration:ecc-hooks-schema-drift`).
 *
 * 2026-09-12 — Claude Code prints this at startup when the ECC plugin
 * (github.com/affaan-m/ECC) is installed:
 *
 *   ecc: hooks.json: unknown keys "$schema", "description" in
 *   hooks.PreToolUse[0], "id" in hooks.PreToolUse[0], ... and 42 more ignored
 *
 * Claude Code's plugin hook schema accepts exactly `{ matcher, hooks }`
 * on a matcher group, and at the document root `hooks` plus an OPTIONAL
 * top-level `description`. ECC ships a
 * root `$schema` plus `description` AND `id` on each of its 23 matcher
 * groups across 7 events — 47 ignored keys, matching the warning
 * verbatim. The warning is cosmetic (the 23 hooks still load).
 *
 * peaks-loop does NOT write this file, and every ECC release checked
 * (v2.2.0 / v2.2.1 / main) carries the same keys, so upgrading the
 * plugin does not clear the warning. This check exists so a user who
 * hits the startup line does not have to re-investigate it from
 * scratch.
 *
 * Probing is split out of the check so the check itself stays a pure
 * mapping over `EccHooksDriftProbeResult`. Tests inject the probe to
 * keep the real `~/.claude/plugins/` tree out of fixtures.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type {
  DoctorCheck,
  DoctorCheckPlugin,
  DoctorContext,
  EccHooksDriftProbe,
  EccHooksDriftProbeResult
} from '../types.js';

const CHECK_ID = 'integration:ecc-hooks-schema-drift';

/** Claude Code's plugin hook schema accepts exactly these keys on a matcher group. */
const ALLOWED_MATCHER_GROUP_KEYS: ReadonlyArray<string> = ['matcher', 'hooks'];

/**
 * …and at the document root: `hooks`, plus an OPTIONAL top-level
 * `description` (Claude Code's plugin hooks docs, "Reference scripts by
 * path", document a top-level `description` for `hooks/hooks.json` and
 * place it as a sibling of `hooks`). A top-level `description` is
 * therefore legal — and is exactly the shape an upstream ECC fix would
 * land on when it consolidates its 23 per-matcher descriptions into one.
 */
const ALLOWED_ROOT_KEYS: ReadonlyArray<string> = ['hooks', 'description'];

/**
 * Unknown keys found in a plugin `hooks.json`. Mirrors the shape of
 * Claude Code's own startup warning so the doctor message can name the
 * same things.
 */
export type EccHooksDriftFinding = {
  /** Total ignored keys (`rootKeys` + every unknown key on every matcher group). */
  readonly unknownKeyCount: number;
  /** Unknown keys directly under the document root (e.g. `$schema`). */
  readonly rootKeys: ReadonlyArray<string>;
  /** Distinct unknown keys seen on matcher groups (e.g. `description`, `id`). */
  readonly entryKeys: ReadonlyArray<string>;
  /** Matcher groups carrying at least one unknown key. */
  readonly entryCount: number;
};

const NO_DRIFT: EccHooksDriftFinding = {
  unknownKeyCount: 0,
  rootKeys: [],
  entryKeys: [],
  entryCount: 0
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Pure mapping over a parsed plugin `hooks.json` payload. Exported so
 * tests drive the key scan without touching the real plugin tree.
 */
export function findEccHooksSchemaDrift(payload: unknown): EccHooksDriftFinding {
  if (!isPlainObject(payload)) return NO_DRIFT;

  const rootKeys = Object.keys(payload).filter((key) => !ALLOWED_ROOT_KEYS.includes(key));
  const hooks = payload.hooks;
  if (!isPlainObject(hooks)) {
    return { ...NO_DRIFT, unknownKeyCount: rootKeys.length, rootKeys };
  }

  const entryKeys = new Set<string>();
  let entryKeyTotal = 0;
  let entryCount = 0;
  for (const groups of Object.values(hooks)) {
    if (!Array.isArray(groups)) continue;
    for (const group of groups) {
      if (!isPlainObject(group)) continue;
      const unknown = Object.keys(group).filter((key) => !ALLOWED_MATCHER_GROUP_KEYS.includes(key));
      if (unknown.length === 0) continue;
      entryCount += 1;
      entryKeyTotal += unknown.length;
      for (const key of unknown) entryKeys.add(key);
    }
  }

  return {
    unknownKeyCount: rootKeys.length + entryKeyTotal,
    rootKeys,
    entryKeys: [...entryKeys].sort(),
    entryCount
  };
}

function readJsonIfPresent(path: string): unknown {
  if (!existsSync(path)) return null;
  // Parse errors intentionally propagate to the check's own catch, which
  // reports them as a `skipping check` message instead of swallowing them.
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

/**
 * Resolve the ECC plugin's install path from Claude Code's plugin
 * manifest (`~/.claude/plugins/installed_plugins.json`), which is the
 * only version-agnostic way to find the versioned cache directory
 * (`…/plugins/cache/ecc/ecc/<version>/`). Exported so tests drive the
 * lookup with an explicit manifest path.
 */
export function readEccInstallPath(manifestPath: string): string | null {
  const manifest = readJsonIfPresent(manifestPath);
  if (!isPlainObject(manifest)) return null;
  const plugins = manifest.plugins;
  if (!isPlainObject(plugins)) return null;
  for (const [name, records] of Object.entries(plugins)) {
    if (!name.startsWith('ecc@')) continue;
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!isPlainObject(record)) continue;
      const installPath = record.installPath;
      if (typeof installPath === 'string' && installPath.length > 0) return installPath;
    }
  }
  return null;
}

/**
 * Default probe: reads the ECC plugin manifest + its `hooks/hooks.json`.
 * `homeDir` is injectable so tests can drive the real probe against a
 * temp dir; the zero-arg call keeps using the real homedir, so the
 * function stays assignable to `EccHooksDriftProbe`.
 */
export function defaultEccHooksDriftProbe(homeDir: string = homedir()): EccHooksDriftProbeResult {
  const manifestPath = join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
  const installPath = readEccInstallPath(manifestPath);
  if (installPath === null) return { hooksPath: null, hooks: null };
  const hooksPath = join(installPath, 'hooks', 'hooks.json');
  return { hooksPath, hooks: readJsonIfPresent(hooksPath) };
}

function run({ options }: DoctorContext): readonly DoctorCheck[] {
  const probe: EccHooksDriftProbe = options.eccHooksDriftProbe ?? defaultEccHooksDriftProbe;
  try {
    const { hooksPath, hooks } = probe();
    if (hooksPath === null) {
      return [{
        id: CHECK_ID,
        ok: true,
        message:
          'ECC plugin not installed (no `ecc@*` entry in ~/.claude/plugins/installed_plugins.json); no plugin hook schema drift to report'
      }];
    }
    if (hooks === null) {
      return [{
        id: CHECK_ID,
        ok: true,
        message: `No readable ECC plugin hooks.json at ${hooksPath}; no plugin hook schema drift to report`
      }];
    }
    const finding = findEccHooksSchemaDrift(hooks);
    if (finding.unknownKeyCount === 0) {
      return [{
        id: CHECK_ID,
        ok: true,
        message: `ECC plugin hooks.json at ${hooksPath} carries only the keys Claude Code accepts (matcher/hooks per matcher group); the startup "unknown keys ... ignored" warning will not appear`
      }];
    }
    const rootPart = finding.rootKeys.length === 0 ? '' : `at the root: ${finding.rootKeys.join(', ')}; `;
    return [{
      id: CHECK_ID,
      ok: false,
      severity: 'warning',
      message:
        `ECC plugin hooks.json at ${hooksPath} carries ${finding.unknownKeyCount} key(s) that Claude Code's plugin hook schema ignores (${rootPart}on ${finding.entryCount} matcher group(s): ${finding.entryKeys.join(', ')}). Claude Code prints \`ecc: hooks.json: unknown keys ... ignored\` at startup; every hook still loads, so this warning is cosmetic. Source: the third-party ECC plugin (github.com/affaan-m/ECC) ships these keys in every release (v2.2.0 / v2.2.1 / main) — peaks-loop does NOT write this file. Fix: none inside peaks-loop; upstream ECC must drop them from its hooks/hooks.json (its scripts/ci/validate-hooks.js validates shape only, never a key allow-list, so ECC's own CI stays green). Upgrading ECC will not help.`
    }];
  } catch (error) {
    return [{
      id: CHECK_ID,
      ok: true,
      message: `ECC hooks schema-drift probe failed (${getErrorMessage(error)}); skipping check`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'ecc-hooks-schema-drift',
  run
};
