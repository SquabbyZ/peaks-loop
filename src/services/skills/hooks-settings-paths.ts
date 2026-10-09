/**
 * The safety checks on an IDE settings path, and the machine-local sibling.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { assertSafeSettingsFile, type HookScope } from '../ide/shared/safe-path.js';
import { getAdapter } from '../ide/ide-registry.js';
import type { IdeId } from '../ide/ide-types.js';

/** Resolve settings root dir for a scope. */
export function resolveSettingsRoot(scope: HookScope, projectRoot: string | undefined): string {
  if (scope === 'global') return resolve(homedir());
  if (!projectRoot) {
    throw new Error('Project scope requires a project root');
  }
  return resolve(projectRoot);
}
export function assertSafeSettingsPathCompat(
  scope: HookScope,
  ide: IdeId,
  root: string,
  settingsPath: string
): void {
  const adapter = getAdapter(ide);
  assertSafeSettingsFile(scope, root, adapter.settings.dirName, adapter.settings.settingsFileName);
  // The compat path receives the already-computed settingsPath; double-check
  // that the computed path matches what assertSafeSettingsFile would have
  // produced. This guards against drift between the two resolvers.
  const expected = adapter.settings.resolveSettingsFile(
    scope,
    scope === 'global' ? homedir() : root
  );
  if (expected !== settingsPath) {
    throw new Error(`settings path drift: ${expected} vs ${settingsPath}`);
  }
}

/**
 * Resolve the machine-local settings file an IDE may carry (e.g. Claude
 * Code's `.claude/settings.local.json`), or `undefined` when there is none.
 *
 * B3(b) 2026-09-13: the machine-local layer is an adapter-DECLARED capability,
 * not a name list. It used to be two hardcoded facts here — a `Set(['claude-code'])`
 * membership test and the filename literal `'settings.local.json'` — i.e. a
 * module that routes per-IDE was itself naming one IDE and one IDE's file.
 * Both now read off the adapter that owns them
 * (`IdeSettingsLocation.localSettingsFileName`), exactly as
 * `auto-compact-dispatcher.ts` already did for the same field.
 *
 * Behaviour is UNCHANGED, and that was verified rather than assumed: over all
 * nine registered `IdeId`s, `IDES_WITH_LOCAL_SETTINGS.has(id)` was `true` for
 * exactly the ids whose adapter declares `localSettingsFileName` (claude-code
 * alone, `'settings.local.json'`). So the set was an exact duplicate of a
 * declaration the adapters already carried, not an independent policy — and
 * a new adapter that declares the field now gets this path for free instead
 * of being silently denied it.
 *
 * This ALSO removes a live instance of the vendor guard's limit 1 (indirect
 * identity: `SET.has(ide)`), which no AST check over comparisons or literals
 * can see. The guard's header named this exact line as the example.
 *
 * Global scope resolves to `undefined`: the global settings file
 * (`~/.claude/settings.json`) is already machine-local, so nothing needs
 * relocating there.
 */
export function resolveLocalSettingsPath(
  scope: HookScope,
  ide: IdeId,
  projectRoot: string | undefined
): string | undefined {
  if (scope === 'global') return undefined;
  const adapter = getAdapter(ide);
  const localFileName = adapter.settings.localSettingsFileName;
  // `undefined` = this IDE has no machine-local layer. Note the order: a
  // caller reaching here with an id the registry does not know still throws
  // from `getAdapter` above, exactly as it did before — every path into this
  // function already called `getAdapter(ide)` via `resolveSettingsPath`, so
  // no new throw path is introduced.
  if (localFileName === undefined) return undefined;
  const root = resolveSettingsRoot(scope, projectRoot);
  assertSafeSettingsFile(scope, root, adapter.settings.dirName, localFileName);
  return join(root, adapter.settings.dirName, localFileName);
}
