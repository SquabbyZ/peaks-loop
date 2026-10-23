/**
 * The public type surface of the hooks settings service.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import type { IdeId } from '../ide/ide-types.js';
import type { HookScope } from '../ide/shared/safe-path.js';
import type { PeaksHookEntry } from './hooks-codegate-superpowers.js';

export type HookInstallOptions = {
  /**
   * Which IDE's adapter to install for. Defaults to `'claude-code'` for
   * backward compatibility. The CLI command should resolve this from
   * `detectIdeFromContext({ env, cwd, parsedStdin })` and pass the result.
   * Throws if the IDE is not registered in the adapter registry.
   */
  readonly ide?: IdeId;
  /**
   * Slice #013 (bugfix — peaks hooks install --no-progress): the published
   * flag that skipped the progress-start PreToolUse hook entry. That hook
   * auto-spawns a new terminal running a progress watcher; with dispatch +
   * heartbeat (slice #009 + #010) the auto-spawn is dead weight.
   *
   * The field is retained for API stability and NO LONGER CHANGES WHAT IS
   * INSTALLED: it defaults to unset and the entry resolver ignores it, so an
   * install always writes the adapter's whole peaks-managed entry set — for
   * Claude Code: `peaks gate enforce` (Bash and MCP tool calls),
   * `peaks code-gate` (Edit|Write|MultiEdit), `peaks outer-cache write`,
   * `peaks session primer`, `peaks session reinject`, `peaks compact settle`
   * — plus the Layer-3 `permissions.deny` entries (worktree governance);
   * the other adapters install their own single hook entry. No code path
   * writes the legacy progress-start entry any more.
   *
   * `uninstall` ignores this field as well: it strips entries by a sentinel
   * scan over the peaks-managed sentinel set, which covers every entry an
   * install writes plus the legacy progress-start one.
   */
  readonly skipProgress?: boolean;
};
/**
 * One peaks-managed entry paired with the settings file it is (or will be)
 * written to.
 *
 * `entries` is a flat list of the same matcher/sentinel pairs, which reads as
 * "written to `settingsPath`" even when the entry is routed to the other file
 * (see `resolveHookTargets`). This carries the routing explicitly so the
 * dry-run can name the real target without a real run.
 */
export type HookEntryTarget = { matcher: string; sentinel: string; settingsPath: string };

export type HookInstallPlan = {
  scope: HookScope;
  settingsPath: string;
  exists: boolean;
  alreadyInstalled: boolean;
  desiredCommand: string;
  sentinel: string;
  matcher: string;
  /**
   * Machine-local, gitignored settings file that the gate-enforce entry is
   * written to instead of `settingsPath`. Undefined when the IDE has no such
   * file (or the scope is global, where the settings file is already
   * machine-local). See `resolveHookTargets`.
   */
  localSettingsPath?: string;
  /** Every entry the install writes, paired with its target file. */
  entryTargets: ReadonlyArray<HookEntryTarget>;
};

export type HookInstallResult = HookInstallPlan & { applied: boolean };
export type HookRemoveResult = {
  scope: HookScope;
  settingsPath: string;
  localSettingsPath?: string;
  removed: boolean;
};
export type HookStatus = {
  scope: HookScope;
  settingsPath: string;
  exists: boolean;
  localSettingsPath?: string;
  localExists?: boolean;
  installed: boolean;
  /**
   * Whether this IDE can host a peaks hook AT ALL (`hasHookSpec`).
   *
   * `status` answers "what is on disk", and for an IDE with no
   * `HOOK_COMMAND_BY_IDE` entry the answer is "nothing, and nothing ever will
   * be" — which is a successful query returning a negative fact, not a failed
   * one. The exit code says the query succeeded; this field says what it found.
   * Without it `installed: false` would be indistinguishable from a supported
   * IDE that simply has no hook installed yet, which is a state the user can
   * act on.
   */
  supportsHooks: boolean;
};

export type HookHandler = { type?: string; command?: string };
export type HookMatcherEntry = { matcher?: string; hooks?: HookHandler[] };
/**
 * A peaks-managed hook entry set grouped by the settings file that must
 * carry it.
 *
 * Peaks hooks normally land in the adapter's settings file. The gate-enforce
 * Bash entry is the exception: on Windows its `shell` must be pinned to
 * `powershell`, because the default Git-Bash shell force-allocates a console
 * window on every Bash tool call (MSYS2 behaviour — see the 2026-09-10
 * hook-console finding). A machine-specific value must never be committed
 * into the SHARED `.claude/settings.json` that a macOS/Linux teammate reads
 * too, so that entry is materialized into the machine-local file instead.
 * The routing decision is platform-independent (it keys off the entry's
 * `machineLocal` flag, not off `process.platform`) so the shared file's
 * content does not depend on which OS ran the install.
 */
export type HookTarget = {
  settingsPath: string;
  entries: PeaksHookEntry[];
  /**
   * When true this file also receives the third-party PreToolUse gate
   * exemptions (`EXTERNAL_GATE_EXEMPT_ENV`). Claude Code only — `env` is a
   * Claude Code settings key — and only ever on a machine-local file, never
   * on the committed shared one.
   */
  envExemptions?: boolean;
};
