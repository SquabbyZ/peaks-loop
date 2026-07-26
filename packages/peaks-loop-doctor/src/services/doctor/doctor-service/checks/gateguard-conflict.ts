/**
 * Check: gateguard-fact-force hook does not intercept `.peaks/`
 * writes (`integration:gateguard-peaks-conflict`).
 *
 * 2026-06-10 — the `gateguard-fact-force` hook is a third-party
 * PreToolUse hook (NOT peaks-loop) that fires on Edit/Write and
 * demands a 4-fact questionnaire before allowing the edit. When
 * the LLM is in a peaks-qa flow and edits
 * `.peaks/_runtime/<sid>/qa/requests/*.md`, the questionnaire
 * demands facts that do not apply. We warn when the hook is
 * installed and no `.peaks/**` skip is configured.
 *
 * Probing is split out of the check so the check itself stays a
 * pure mapping over `GateguardProbeResult`. Tests inject the probe
 * to keep `~/.claude/settings.json` from leaking into fixtures.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getErrorMessage } from 'peaks-loop-shared/result';

import type {
  DoctorCheck,
  DoctorCheckPlugin,
  DoctorContext,
  GateguardHookLocation,
  GateguardProbe,
  GateguardProbeResult
} from '../types.js';

/** Hook command fragments that identify the gateguard-fact-force hook. */
const GATEGUARD_HOOK_NEEDLES: ReadonlyArray<string> = ['gateguard', 'fact-force', 'fact_force'];

/** Token the gateguard hook exposes for "skip these paths" — the
 *  check treats any match against `.peaks` (path or globs) as a
 *  routed configuration. We accept a few common spellings because
 *  the third-party hook's CLI surface is not part of peaks-loop's
 *  contract. */
const GATEGUARD_PEAKS_SKIP_NEEDLES: ReadonlyArray<string> = [
  '.peaks',
  'peaks-skip',
  'skip-glob',
  '--skip',
  'skip_paths'
];

function commandMentionsGateguard(command: string | undefined): boolean {
  if (typeof command !== 'string' || command.length === 0) return false;
  const lower = command.toLowerCase();
  return GATEGUARD_HOOK_NEEDLES.some((needle) => lower.includes(needle));
}

function entrySkipsPeaks(entry: GateguardHookLocation['entry']): boolean {
  const matcher = typeof entry.matcher === 'string' ? entry.matcher : '';
  const matcherMentionsPeaks = matcher.toLowerCase().includes('.peaks');
  if (matcherMentionsPeaks) return true;
  for (const hook of entry.hooks) {
    const command = typeof hook.command === 'string' ? hook.command : '';
    const lower = command.toLowerCase();
    if (GATEGUARD_PEAKS_SKIP_NEEDLES.some((needle) => lower.includes(needle))) {
      return true;
    }
  }
  return false;
}

function extractGateguardEntries(
  source: 'global' | 'project',
  sourcePath: string,
  settings: unknown
): GateguardHookLocation[] {
  if (settings === null || typeof settings !== 'object') return [];
  const hooks = (settings as { hooks?: unknown }).hooks;
  if (hooks === null || typeof hooks !== 'object') return [];
  const preToolUse = (hooks as { PreToolUse?: unknown }).PreToolUse;
  if (!Array.isArray(preToolUse)) return [];

  const out: GateguardHookLocation[] = [];
  for (const rawEntry of preToolUse) {
    if (rawEntry === null || typeof rawEntry !== 'object') continue;
    const entry = rawEntry as {
      matcher?: unknown;
      hooks?: unknown;
    };
    if (!Array.isArray(entry.hooks)) continue;
    const hooks: Array<{ type?: string; command?: string }> = [];
    for (const rawHook of entry.hooks) {
      if (rawHook === null || typeof rawHook !== 'object') continue;
      const h = rawHook as { type?: unknown; command?: unknown };
      const hookEntry: { type?: string; command?: string } = {};
      if (typeof h.type === 'string') hookEntry.type = h.type;
      if (typeof h.command === 'string') hookEntry.command = h.command;
      hooks.push(hookEntry);
    }
    if (!hooks.some((h) => commandMentionsGateguard(h.command))) continue;
    const outEntry: {
      matcher?: string;
      hooks: ReadonlyArray<{ type?: string; command?: string }>;
    } = { hooks };
    if (typeof entry.matcher === 'string') outEntry.matcher = entry.matcher;
    out.push({ source, sourcePath, entry: outEntry });
  }
  return out;
}

function readSettingsJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    return null;
  }
}

function defaultGateguardProbe(projectRootResolver: () => string | null): GateguardProbeResult {
  const projectRoot = projectRootResolver();
  const globalPath = join(homedir(), '.claude', 'settings.json');
  const projectPath = projectRoot === null ? null : join(projectRoot, '.claude', 'settings.json');

  return {
    globalSettingsPath: globalPath,
    globalSettings: readSettingsJson(globalPath),
    projectSettingsPath: projectPath,
    projectSettings: projectPath === null ? null : readSettingsJson(projectPath)
  };
}

/**
 * Pure mapping over a `GateguardProbeResult`. Exported so tests
 * can drive the entry extraction without monkey-patching
 * `~/.claude/settings.json`.
 */
export function collectGateguardEntries(probe: GateguardProbeResult): GateguardHookLocation[] {
  const fromGlobal = extractGateguardEntries('global', probe.globalSettingsPath ?? '~/.claude/settings.json', probe.globalSettings);
  const fromProject = probe.projectSettingsPath === null
    ? []
    : extractGateguardEntries('project', probe.projectSettingsPath, probe.projectSettings);
  return [...fromGlobal, ...fromProject];
}

function run({ options, projectRootResolver }: DoctorContext): readonly DoctorCheck[] {
  const gateguardProbe: GateguardProbe = options.gateguardProbe ?? (() => defaultGateguardProbe(projectRootResolver));
  try {
    const probe = gateguardProbe();
    const offending = collectGateguardEntries(probe);
    if (offending.length === 0) {
      return [{
        id: 'integration:gateguard-peaks-conflict',
        ok: true,
        message:
          'No gateguard-fact-force PreToolUse hook detected in ~/.claude/settings.json or project .claude/settings.json; the Edit/Write fact-forcing flow will not interfere with peaks-qa .peaks/ artifact writes'
      }];
    }
    const unrouted = offending.filter((location) => !entrySkipsPeaks(location.entry));
    if (unrouted.length === 0) {
      return [{
        id: 'integration:gateguard-peaks-conflict',
        ok: true,
        message:
          `gateguard-fact-force hook is installed in ${offending.map((l) => l.source).join(' + ')} but a .peaks/** skip pattern is configured; peaks-qa .peaks/ artifact writes are not blocked`
      }];
    }
    const sources = Array.from(new Set(unrouted.map((u) => u.sourcePath))).join(' + ');
    const matchers = unrouted.map((u) => u.entry.matcher ?? '*').join(', ');
    return [{
      id: 'integration:gateguard-peaks-conflict',
      ok: false,
      message:
        `gateguard-fact-force PreToolUse hook is installed (${sources}, matcher: ${matchers}) with no .peaks/** skip pattern; every Edit/Write of a peaks-qa envelope (.peaks/_runtime/<sid>/qa/requests/*.md) will be intercepted and demand a 4-fact questionnaire that does not apply to QA templates. Workaround: set \`ECC_DISABLED_HOOKS=pre:edit-write:gateguard-fact-force\` for the session, OR add a paired PreToolUse entry whose matcher restricts the hook to non-.peaks paths. peaks-loop is NOT the source of this hook.`
    }];
  } catch (error) {
    return [{
      id: 'integration:gateguard-peaks-conflict',
      ok: true,
      message: `gateguard probe failed (${getErrorMessage(error)}); skipping check`
    }];
  }
}

export const check: DoctorCheckPlugin = {
  name: 'gateguard-conflict',
  run
};