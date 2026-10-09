import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { atomicWriteJson } from '../ide/shared/atomic-json.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';
import type { HookScope } from '../ide/shared/safe-path.js';
import {
  resolveHookSpec,
  resolveHookEntries,
  hasHookSpec,
  resolveLegacySentinels,
  hasExternalGateExemptions,
  withExternalGateExemptions,
  type PeaksHookEntry
} from './hooks-codegate-superpowers.js';

export {
  HOOK_ENFORCE_SENTINEL,
  HOOK_CODE_GATE_SENTINEL,
  HOOK_CODE_GATE_MATCHER,
  HOOK_CODE_GATE_EVENT,
  HOOK_CODE_GATE_COMMAND,
  SUPERPOWERS_DENIED_SKILLS,
  type PeaksHookEntry
} from './hooks-codegate-superpowers.js';

/**
 * Install (and remove) the Peaks-managed hooks in an IDE's settings.json.
 *
 * The hook runs `peaks gate enforce` before every relevant tool call; when a SOP
 * guard's gates fail it returns the adapter-specific deny shape, which blocks the
 * tool call BEFORE the IDE's permission checks — making the gate un-bypassable.
 *
 * This file owns the policy and the four operations; the mechanisms live in the
 * `hooks-settings-*` siblings. Installation is an EXPLICIT user command (never
 * postinstall): skills describe, the CLI performs side effects. Writes preserve every
 * other key and hook, reject symlinked targets, and use an atomic rename.
 */
export type { HookScope } from '../ide/shared/safe-path.js';
export type {
  HookEntryTarget,
  HookInstallOptions,
  HookInstallPlan,
  HookInstallResult,
  HookRemoveResult,
  HookStatus
} from './hooks-settings-types.js';
export { readInstalledEntriesFromSettings } from './hooks-settings-read-installed.js';
export {
  TRIGGER_PHRASES,
  listSuperpowersDenyEntries,
  withSuperpowersSkillDenylist,
  withTriggeredDenyList,
  withoutSuperpowersSkillDenylist,
  withoutTriggeredDenyList
} from './hooks-settings-deny-list.js';

import {
  assertSafeSettingsPathCompat,
  resolveLocalSettingsPath,
  resolveSettingsRoot
} from './hooks-settings-paths.js';
import {
  describeEntryTargets,
  isInstalledForEntries,
  readSettingsFile,
  targetIsSatisfied,
  withHooksInstalled
} from './hooks-settings-file-shape.js';
import {
  applyRemovalToTarget,
  hookStatusFromTargets,
  removedResult,
  unsupportedHookStatus
} from './hooks-settings-envelopes.js';
import { withSuperpowersSkillDenylist, withTriggeredDenyList } from './hooks-settings-deny-list.js';
import type {
  HookInstallOptions,
  HookInstallPlan,
  HookInstallResult,
  HookRemoveResult,
  HookStatus,
  HookTarget
} from './hooks-settings-types.js';

/** Default (claude-code) hook command. */
export const HOOK_ENFORCE_COMMAND = `peaks gate enforce --project "\${CLAUDE_PROJECT_DIR}" --json`;

function resolveSettingsPath(
  scope: HookScope,
  ide: IdeId,
  projectRoot: string | undefined
): string {
  const adapter = getAdapter(ide);
  return adapter.settings.resolveSettingsFile(scope, scope === 'global' ? homedir() : projectRoot);
}

function resolveIde(options: HookInstallOptions | undefined): IdeId {
  return options?.ide ?? 'claude-code';
}

/**
 * The peaks-managed entries grouped by the settings file that carries each one.
 *
 * Peaks hooks normally land in the adapter's settings file. The gate-enforce Bash
 * entry is the exception: on Windows its `shell` is pinned to `powershell`, because
 * the default Git-Bash shell force-allocates a console window on every Bash tool call.
 * A machine-specific value must never be committed into the SHARED file a macOS/Linux
 * teammate reads, so that entry lands in the machine-local file instead; routing keys
 * off its own `machineLocal` flag, never off `process.platform`.
 */
function resolveHookTargets(
  scope: HookScope,
  ide: IdeId,
  projectRoot: string | undefined
): HookTarget[] {
  const sharedPath = resolveSettingsPath(scope, ide, projectRoot);
  const localPath = resolveLocalSettingsPath(scope, ide, projectRoot);
  const wantsEnvExemptions = ide === 'claude-code';
  if (localPath === undefined || localPath === sharedPath) {
    return [
      {
        settingsPath: sharedPath,
        entries: [...resolveHookEntries(ide)],
        envExemptions: wantsEnvExemptions
      }
    ];
  }
  const shared: HookTarget = { settingsPath: sharedPath, entries: [] };
  const local: HookTarget = {
    settingsPath: localPath,
    entries: [],
    envExemptions: wantsEnvExemptions
  };
  for (const entry of resolveHookEntries(ide)) {
    (entry.machineLocal === true ? local : shared).entries.push(entry);
  }
  return [shared, local];
}

function readInstallEnvelope(
  scope: HookScope,
  projectRoot: string | undefined,
  options: HookInstallOptions | undefined,
  alreadyInstalled: (targets: HookTarget[], ide: IdeId) => boolean
): { ide: IdeId; targets: HookTarget[]; settingsPath: string; plan: HookInstallPlan } {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  const targets = resolveHookTargets(scope, ide, projectRoot);
  const spec = resolveHookSpec(ide);
  const localTarget = targets.find((t) => t.settingsPath !== settingsPath);
  return {
    ide,
    targets,
    settingsPath,
    plan: {
      scope,
      settingsPath,
      exists: existsSync(settingsPath),
      // Written here, in the published field order a `--json` caller reads.
      alreadyInstalled: alreadyInstalled(targets, ide),
      desiredCommand: spec.hookEnforceCommand,
      sentinel: spec.hookEnforceSentinel,
      matcher: spec.hookEnforceMatcher,
      ...(localTarget !== undefined ? { localSettingsPath: localTarget.settingsPath } : {}),
      entryTargets: describeEntryTargets(targets)
    }
  };
}

/** Default (claude-code) peaks-managed hook entries — kept as a stable export for tests. Slice #014: only the gate-enforce entry. */
export const PEAKS_HOOK_ENTRIES: ReadonlyArray<PeaksHookEntry> = (() => {
  const spec = resolveHookSpec('claude-code');
  return [
    {
      sentinel: spec.hookEnforceSentinel,
      matcher: spec.hookEnforceMatcher,
      command: spec.hookEnforceCommand,
      event: spec.hookEnforceEvent
    }
  ];
})();

export function planHookInstall(
  scope: HookScope,
  projectRoot?: string,
  options?: HookInstallOptions
): HookInstallPlan {
  // The env clause mirrors `applyHookInstall`'s: without it the dry run claims "nothing
  // to do" about a file the install is about to write.
  return readInstallEnvelope(scope, projectRoot, options, (targets) =>
    targets.every((t) => {
      const settings = readSettingsFile(t.settingsPath);
      return (
        isInstalledForEntries(settings, t.entries) &&
        (t.envExemptions !== true || hasExternalGateExemptions(settings))
      );
    })
  ).plan;
}

export function applyHookInstall(
  scope: HookScope,
  projectRoot?: string,
  options?: HookInstallOptions
): HookInstallResult {
  // `alreadyInstalled` reflects the FULL desired shape — gate-enforce-only, no stale
  // progress-start entry, the external-gate exemption present. Presence alone is not
  // enough: a file left by an older release would look installed forever.
  const {
    ide,
    targets,
    settingsPath,
    plan: baseResult
  } = readInstallEnvelope(scope, projectRoot, options, (t, i) =>
    t.every((target) => targetIsSatisfied(target, resolveLegacySentinels(i)))
  );
  const allSentinels = resolveLegacySentinels(ide);
  if (baseResult.alreadyInstalled) return { ...baseResult, applied: false };
  // The `permissions.deny` block rides the same atomic write as the hook entries, so
  // the two halves of the install are always co-located. It lives in the adapter's
  // settings file only — it is committed, so the deny list is shared.
  for (const target of targets) {
    let next = withHooksInstalled(
      readSettingsFile(target.settingsPath),
      target.entries,
      allSentinels
    );
    if (target.envExemptions === true) next = withExternalGateExemptions(next);
    const merged =
      target.settingsPath === settingsPath
        ? withTriggeredDenyList(withSuperpowersSkillDenylist(next))
        : next;
    atomicWriteJson(target.settingsPath, merged);
  }
  return { ...baseResult, alreadyInstalled: false, applied: true };
}

export function removeHookInstall(
  scope: HookScope,
  projectRoot?: string,
  options?: HookInstallOptions
): HookRemoveResult {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  // An IDE with no HOOK_COMMAND_BY_IDE entry can never carry a peaks hook, so
  // "remove it" is already true: a no-op success, not a failure. This stays
  // asymmetric with `applyHookInstall`, which fails closed for the same IDEs;
  // `resolveHookTargets` below is what throws for them, so the check comes first.
  if (!hasHookSpec(ide)) {
    return removedResult(
      scope,
      settingsPath,
      resolveLocalSettingsPath(scope, ide, projectRoot),
      false
    );
  }
  const targets = resolveHookTargets(scope, ide, projectRoot);
  const localTarget = targets.find((t) => t.settingsPath !== settingsPath);
  const present = targets.filter((t) => existsSync(t.settingsPath));
  if (present.length === 0) {
    return removedResult(scope, settingsPath, localTarget?.settingsPath, false);
  }
  // The legacy sentinel set covers BOTH the gate-enforce and the pre-#014 progress-start
  // entries, so uninstall converges the file however it was shaped.
  const sentinels = resolveLegacySentinels(ide);
  let removedAny = false;
  for (const target of present) {
    if (applyRemovalToTarget(target, sentinels, target.settingsPath === settingsPath)) {
      removedAny = true;
    }
  }
  return removedResult(scope, settingsPath, localTarget?.settingsPath, removedAny);
}

export function readHookStatus(
  scope: HookScope,
  projectRoot?: string,
  options?: HookInstallOptions
): HookStatus {
  const ide = resolveIde(options);
  const root = resolveSettingsRoot(scope, projectRoot);
  const settingsPath = resolveSettingsPath(scope, ide, projectRoot);
  assertSafeSettingsPathCompat(scope, ide, root, settingsPath);
  // As in `removeHookInstall`: an IDE with no HOOK_COMMAND_BY_IDE entry has no hook on
  // disk and can never have one, so "what is installed?" has a definite answer — nothing.
  if (!hasHookSpec(ide)) {
    return unsupportedHookStatus(
      scope,
      settingsPath,
      resolveLocalSettingsPath(scope, ide, projectRoot)
    );
  }
  return hookStatusFromTargets(scope, settingsPath, resolveHookTargets(scope, ide, projectRoot));
}
