/**
 * Reading and comparing the hook rows a settings file actually holds.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import { existsSync } from 'node:fs';
import { readJsonObjectFile } from '../ide/shared/atomic-json.js';
import { hasExternalGateExemptions, type PeaksHookEntry } from './hooks-codegate-superpowers.js';
import type { HookEntryTarget, HookMatcherEntry, HookTarget } from './hooks-settings-types.js';

/** True when `target` already holds everything the install would write to it. */
export function targetIsSatisfied(
  target: HookTarget,
  allSentinels: ReadonlyArray<string>
): boolean {
  const settings = readSettingsFile(target.settingsPath);
  if (!shapeMatchesDesired(settings, target.entries, allSentinels)) return false;
  return target.envExemptions !== true || hasExternalGateExemptions(settings);
}

/** Flatten the resolved targets into one `{ matcher, sentinel, settingsPath }` row per entry. */
export function describeEntryTargets(targets: ReadonlyArray<HookTarget>): HookEntryTarget[] {
  return targets.flatMap((target) =>
    target.entries.map((entry) => ({
      matcher: entry.matcher,
      sentinel: entry.sentinel,
      settingsPath: target.settingsPath
    }))
  );
}

/** Read a settings file as an object, or `{}` when it does not exist yet. */
export function readSettingsFile(settingsPath: string): Record<string, unknown> {
  return existsSync(settingsPath) ? readJsonObjectFile(settingsPath) : {};
}

/** Read the existing hook array entries for the adapter's hookEvent (tolerant of any prior shape). */
export function readHookEventEntries(
  settings: Record<string, unknown>,
  eventKey: string
): HookMatcherEntry[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) return [];
  const arr = (hooks as Record<string, unknown>)[eventKey];
  return Array.isArray(arr) ? (arr as HookMatcherEntry[]) : [];
}

/** Read the existing hook array entries from a `settings.hooks` object (already extracted). */
export function readHookEntriesFromHooks(
  hooks: Record<string, unknown>,
  eventKey: string
): HookMatcherEntry[] {
  const arr = hooks[eventKey];
  return Array.isArray(arr) ? (arr as HookMatcherEntry[]) : [];
}

/** True when every command handler in the entry matches a known peaks sentinel for the given IDE. */
export function entryIsPeaksManaged(
  entry: HookMatcherEntry,
  sentinels: ReadonlyArray<string>
): boolean {
  const handlers = Array.isArray(entry?.hooks) ? entry.hooks : [];
  if (handlers.length === 0) return false;
  return handlers.every((h) => {
    if (typeof h?.command !== 'string') return false;
    const cmd = h.command;
    return sentinels.some((sentinel) => cmd.includes(sentinel));
  });
}
export function isInstalledForEntries(
  settings: Record<string, unknown>,
  entries: ReadonlyArray<PeaksHookEntry>
): boolean {
  const sentinels = entries.map((e) => e.sentinel);
  // Check every distinct event key our entries could be on.
  const eventKeys = new Set(entries.map((e) => e.event));
  for (const eventKey of eventKeys) {
    if (readHookEventEntries(settings, eventKey).some((e) => entryIsPeaksManaged(e, sentinels))) {
      return true;
    }
  }
  return false;
}
/**
 * Slice #014: detect the "stale progress entry after pre-#014 install"
 * case. The desired shape is gate-enforce-only. If the file currently
 * has a peaks-managed progress-start entry (left behind by a pre-#014
 * install), the install is NOT a no-op — it must strip the stale
 * entry. This helper returns true exactly when the desired shape is
 * fully reflected on disk: gate-enforce present AND no legacy
 * progress-start present.
 */
export function shapeMatchesDesired(
  settings: Record<string, unknown>,
  entries: ReadonlyArray<PeaksHookEntry>,
  allPeaksSentinels: ReadonlyArray<string>
): boolean {
  const eventKeys = new Set(entries.map((e) => e.event));
  for (const eventKey of eventKeys) {
    // Only the entries that belong to THIS event key can be expected on it —
    // the desired set must be per-event, or a target whose entries span two
    // event keys (claude-code: SessionStart + PreToolUse) would never look
    // installed and every `peaks hooks install` would rewrite the files.
    const desiredSentinels = new Set(
      entries.filter((e) => e.event === eventKey).map((e) => e.sentinel)
    );
    const present = readHookEventEntries(settings, eventKey);
    const peaksPresent = present.filter((e) => entryIsPeaksManaged(e, allPeaksSentinels));
    // (a) every peaks-managed entry currently on disk must match the
    //     desired sentinel set (no stale entries the caller wants removed).
    for (const entry of peaksPresent) {
      const entrySentinels = (entry.hooks ?? [])
        .map((h) => allPeaksSentinels.find((s) => String(h.command ?? '').includes(s)))
        .filter((s): s is string => Boolean(s));
      if (entrySentinels.some((s) => !desiredSentinels.has(s))) {
        return false;
      }
    }
    // (b) every desired entry must be on disk AND carry the matcher it declares.
    //     Presence alone cannot see a WRONG matcher, and a wrong matcher is not
    //     cosmetic: `''` and `Bash|Task` route the same command to different
    //     tool sets, so the entry is present while the hook never fires on the
    //     residual R2): a `PostCompact` entry hand-corrupted to matcher
    //     `auto|manual` survived `peaks hooks install` unchanged, and the
    //     installer was structurally unable to repair it.
    //     An absent matcher reads as `''` — the form Claude Code takes as "every
    //     source" — so a file written before matchers were explicit converges
    //     once instead of churning on every install.
    for (const desired of entries.filter((e) => e.event === eventKey)) {
      // The identity of a desired entry is the PAIR (sentinel, matcher), not the
      // sentinel alone: one command may legitimately be installed under several
      // matchers (the read-only MCP surface rides `peaks gate enforce` under its
      // own matcher set). Matching on the sentinel first found that first entry
      // every time, so the second one never looked installed and every install
      // rewrote the file. A wrong matcher is still un-repaired — it fails to
      // match and the caller rewrites.
      const onDisk = peaksPresent.find(
        (entry) =>
          (entry.matcher ?? '') === desired.matcher &&
          (entry.hooks ?? []).some((h) => String(h.command ?? '').includes(desired.sentinel))
      );
      if (onDisk === undefined) return false;
    }
  }
  return true;
}
/**
 * Merge a target's peaks-managed hook entries into `settings`, preserving
 * all other keys and hooks. Entries routed to a DIFFERENT settings file are
 * not part of `entries`, so the legacy-sentinel filter below strips them
 * from this file (that is what migrates a gate-enforce entry that an older
 * peaks release wrote into the shared file).
 */
export function withHooksInstalled(
  settings: Record<string, unknown>,
  entries: ReadonlyArray<PeaksHookEntry>,
  allSentinels: ReadonlyArray<string>
): Record<string, unknown> {
  const existingHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
      ? (settings.hooks as Record<string, unknown>)
      : {};

  // Our entries may sit on more than one event key. Group by event so each
  // event array is independently merged.
  const ourByEvent = new Map<string, PeaksHookEntry[]>();
  for (const spec of entries) {
    const list = ourByEvent.get(spec.event) ?? [];
    list.push(spec);
    ourByEvent.set(spec.event, list);
  }

  // Slice #014: the legacy sentinel set includes the progress-start
  // sentinel so a pre-#014 install's stale progress-start entry is
  // stripped by the filter (the file converges on the new
  // gate-enforce-only shape, idempotently). The desired set (passed
  // in below) only contains the gate-enforce sentinel.
  const nextHooks: Record<string, unknown> = { ...existingHooks };

  // An event key this file used to carry but whose entries all moved to the
  // other file still needs its stale peaks entries stripped.
  const eventKeys = new Set([...ourByEvent.keys(), ...Object.keys(existingHooks)]);

  for (const eventKey of eventKeys) {
    const existing = readHookEntriesFromHooks(nextHooks, eventKey);
    const nonPeaks = existing.filter((entry) => !entryIsPeaksManaged(entry, allSentinels));
    const ourFormatted: HookMatcherEntry[] = (ourByEvent.get(eventKey) ?? []).map((spec) => ({
      matcher: spec.matcher,
      hooks: [
        {
          type: 'command',
          command: spec.command,
          ...(spec.shell !== undefined ? { shell: spec.shell } : {})
        }
      ]
    }));
    const merged = [...nonPeaks, ...ourFormatted];
    if (merged.length > 0) {
      nextHooks[eventKey] = merged;
    } else {
      delete nextHooks[eventKey];
    }
  }
  return {
    ...settings,
    hooks: nextHooks
  };
}

/**
 * Strip every peaks-managed hook row from one target's settings file, on every
 * event key the file carries — a pre-#014 install could have left the legacy
 * progress-start entry on a different event than the gate-enforce one. Returns
 * the rewritten settings plus whether anything was actually removed.
 */
export function stripPeaksEntries(
  target: HookTarget,
  sentinels: ReadonlyArray<string>
): { settings: Record<string, unknown>; removed: boolean } {
  const settings = readJsonObjectFile(target.settingsPath);
  const existingHooks = (settings.hooks as Record<string, unknown>) ?? {};
  const eventKeys = new Set([...target.entries.map((e) => e.event), ...Object.keys(existingHooks)]);
  const nextHooks: Record<string, unknown> = { ...existingHooks };
  let removed = false;
  for (const eventKey of eventKeys) {
    const entries = readHookEntriesFromHooks(nextHooks, eventKey);
    const kept = entries.filter((entry) => !entryIsPeaksManaged(entry, sentinels));
    if (kept.length !== entries.length) removed = true;
    if (kept.length > 0) {
      nextHooks[eventKey] = kept;
    } else {
      delete nextHooks[eventKey];
    }
  }
  const nextSettings: Record<string, unknown> = { ...settings };
  if (Object.keys(nextHooks).length > 0) {
    nextSettings.hooks = nextHooks;
  } else {
    delete nextSettings.hooks;
  }
  return { settings: nextSettings, removed };
}
