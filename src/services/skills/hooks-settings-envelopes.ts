/**
 * The result envelopes the uninstall and status verbs return.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import { existsSync } from 'node:fs';
import { atomicWriteJson } from '../ide/shared/atomic-json.js';
import type { HookScope } from '../ide/shared/safe-path.js';
import { withoutExternalGateExemptions } from './hooks-codegate-superpowers.js';
import {
  withoutSuperpowersSkillDenylist,
  withoutTriggeredDenyList
} from './hooks-settings-deny-list.js';
import {
  isInstalledForEntries,
  readSettingsFile,
  stripPeaksEntries
} from './hooks-settings-file-shape.js';
import type { HookRemoveResult, HookStatus, HookTarget } from './hooks-settings-types.js';

/** The uninstall envelope; a `localPath` is reported only when it is a distinct file. */
export function removedResult(
  scope: HookScope,
  settingsPath: string,
  localPath: string | undefined,
  removed: boolean
): HookRemoveResult {
  return {
    scope,
    settingsPath,
    removed,
    ...(localPath !== undefined && localPath !== settingsPath
      ? { localSettingsPath: localPath }
      : {})
  };
}

/**
 * Strip every peaks-managed row from one target's file and write it back.
 *
 * The deny-list helpers run only on the SHARED settings file (the one that
 * carries the committed `permissions.deny` block); the machine-local file
 * carries hook entries plus, for Claude Code, the gate exemptions.
 */
export function applyRemovalToTarget(
  target: HookTarget,
  sentinels: ReadonlyArray<string>,
  isSharedFile: boolean
): boolean {
  const { settings, removed } = stripPeaksEntries(target, sentinels);
  let finalSettings = settings;
  if (target.envExemptions === true) {
    finalSettings = withoutExternalGateExemptions(finalSettings);
  }
  if (isSharedFile) {
    finalSettings = withoutTriggeredDenyList(withoutSuperpowersSkillDenylist(finalSettings));
  }
  atomicWriteJson(target.settingsPath, finalSettings);
  return removed;
}

/**
 * The status envelope for an IDE that can never carry a peaks hook: the query
 * ran, the disk was read, and the honest reply is "nothing, and nothing ever
 * will be".
 */
export function unsupportedHookStatus(
  scope: HookScope,
  settingsPath: string,
  localPath: string | undefined
): HookStatus {
  return {
    scope,
    settingsPath,
    exists: existsSync(settingsPath),
    ...(localPath !== undefined && localPath !== settingsPath
      ? { localSettingsPath: localPath, localExists: existsSync(localPath) }
      : {}),
    installed: false,
    supportsHooks: false
  };
}

/** The status envelope for a set of resolved targets. */
export function hookStatusFromTargets(
  scope: HookScope,
  settingsPath: string,
  targets: ReadonlyArray<HookTarget>
): HookStatus {
  const localTarget = targets.find((t) => t.settingsPath !== settingsPath);
  return {
    scope,
    settingsPath,
    exists: existsSync(settingsPath),
    ...(localTarget !== undefined
      ? {
          localSettingsPath: localTarget.settingsPath,
          localExists: existsSync(localTarget.settingsPath)
        }
      : {}),
    installed: targets.some((t) => {
      const settings = readSettingsFile(t.settingsPath);
      return Object.keys(settings).length > 0 && isInstalledForEntries(settings, t.entries);
    }),
    supportsHooks: true
  };
}
