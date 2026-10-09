/**
 * What `peaks hooks status` reports: the peaks-managed rows actually on disk.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import type { IdeId } from '../ide/ide-types.js';
import { resolveLegacySentinels } from './hooks-codegate-superpowers.js';
import { entryIsPeaksManaged, readHookEntriesFromHooks } from './hooks-settings-file-shape.js';

/**
 * Slice #014: read the *actually-installed* peaks-managed hook entries
 * from a settings object. Replaces the pre-#014 `listInstalledEntriesForIde`
 * helper in `hooks-commands.ts`, which returned the IDE-EXPECTED list
 * (a hardcoded 2-entry array per adapter) rather than what was on disk.
 * That bug surfaced when slice #013's local cleanup installed
 * `peaks hooks install --no-progress` (gate-enforce only), but the
 * status command still reported `entries: [Bash, Task]` because the
 * helper didn't read the file.
 *
 * The new helper:
 *   1. reads each `hooks.<event>` array,
 *   2. filters to entries that are peaks-managed for the given IDE
 *      (matches the legacy sentinel set: gate-enforce + the no-longer-
 *      installed progress-start),
 *   3. returns one `{ matcher, sentinel }` row per entry, taking the
 *      FIRST matching sentinel per entry (entries have a single command
 *      handler in practice, but the loop tolerates multi-handler
 *      entries by taking the first match).
 *
 * Pre-#014 settings.json files that have a stale progress-start entry
 * will see it surface in the result. This is intentional: the status
 * command is the user's tool for "what is on disk right now", and
 * surfacing a stale entry is the only way the user can know to run
 * `peaks hooks install` (which now strips it) or `peaks hooks
 * uninstall` (which removes it).
 */
export function readInstalledEntriesFromSettings(
  settings: Record<string, unknown>,
  ide: IdeId
): ReadonlyArray<{ matcher: string; sentinel: string }> {
  const sentinels = resolveLegacySentinels(ide);
  // Walk every event key the settings file has, not just the
  // adapter-declared one. A pre-#014 install could have left a
  // progress-start entry on a different event than the gate-enforce
  // entry (Trae: both on beforeToolCall, but a stale install on a
  // future IDE could split them).
  const hooksRoot = settings.hooks;
  if (!hooksRoot || typeof hooksRoot !== 'object' || Array.isArray(hooksRoot)) return [];
  const result: { matcher: string; sentinel: string }[] = [];
  for (const eventKey of Object.keys(hooksRoot)) {
    const entries = readHookEntriesFromHooks(hooksRoot as Record<string, unknown>, eventKey);
    for (const entry of entries) {
      if (!entryIsPeaksManaged(entry, sentinels)) continue;
      const matcher = typeof entry.matcher === 'string' ? entry.matcher : '';
      // Find the first matching sentinel inside the entry's command
      // handlers. For each handler, find the first sentinel substring
      // it contains. We pick the first handler's first matching
      // sentinel (entries have a single command in practice).
      const firstHandler = Array.isArray(entry.hooks) ? entry.hooks[0] : undefined;
      const cmd = typeof firstHandler?.command === 'string' ? firstHandler.command : '';
      const sentinel = sentinels.find((s) => cmd.includes(s));
      if (matcher === '' || sentinel === undefined) continue;
      result.push({ matcher, sentinel });
    }
  }
  return result;
}
