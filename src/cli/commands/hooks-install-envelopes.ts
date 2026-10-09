// src/cli/commands/hooks-install-envelopes.ts
//
// The two envelopes `peaks hooks install` renders: the `--dry-run` preview and
// the applied result. Split out of `hooks-commands.ts`; the per-IDE entry
// summary, the Layer 3 deny lines and every envelope key are unchanged. The
// hook-script copies are computed by the caller (`hooks-commands.ts`, which owns
// the two user-global paths) and handed in.

import {
  listSuperpowersDenyEntries,
  planHookInstall,
  applyHookInstall,
  type HookScope
} from '../../services/skills/hooks-settings-service.js';
import {
  resolveHookEntries,
  resolveHookSpec
} from '../../services/skills/hooks-codegate-superpowers.js';
import type { IdeId } from '../../services/ide/ide-types.js';
import { ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import type {
  HookCliOptions,
  HookScriptCopy,
  HookScriptCopies,
  InstallContext
} from './hooks-command-shared.js';

/**
 * Slice #014: compute the per-IDE peaks hook entries for the install /
 * dry-run RESPONSE SUMMARY. This is the *desired* shape (what the install
 * WOULD write), not what is on disk. The status command uses a different
 * helper (`readInstalledEntriesFromSettings`) that reads the actual
 * settings.json.
 *
 * After slice #014 only the gate-enforce entry is ever installed
 * (the legacy progress-start surface is gone). The summary mirrors
 * the install shape so the JSON envelope doesn't claim a hook the
 * service did not write.
 */
function listExpectedEntriesForIde(
  ide: IdeId,
  _skipProgress = false
): ReadonlyArray<{ matcher: string; sentinel: string }> {
  // Derived from `resolveHookEntries(ide)` — the same function `planHookInstall`
  // / `applyHookInstall` write from — so the summary can only ever report a
  // shape the install actually produces. The previous version was a
  // hand-written literal under a comment claiming it "mirrors the install
  // shape, NOT a hardcoded expected list" (diagnosis 2026-09-15, C4); the
  // literal had drifted from that claim in both directions: it re-typed the
  // code-gate matcher instead of reading `HOOK_CODE_GATE_MATCHER`, and it
  // reported 2 of the 6 entries a claude-code install writes.
  //
  // The filter is the tool-call event. `resolveHookEntries` also returns the
  // once-per-session SessionStart / PostCompact entries; those are not what a
  // per-call hook-entry summary is read for, and leaving them out is the only
  // place this summary is narrower than the install.
  const event = resolveHookSpec(ide).hookEnforceEvent;
  return resolveHookEntries(ide, _skipProgress)
    .filter((entry) => entry.event === event)
    .map((entry) => ({ matcher: entry.matcher, sentinel: entry.sentinel }));
}

/**
 * One `nextActions` line for a hook-script copy, or `null` when there is
 * nothing to say.
 *
 * Diagnosis 2026-09-15 (C7): the copy failure used to be reported as a single
 * sentence — `'<x> hook not copied (source missing or non-global scope)'` —
 * which merged a real build failure into the expected project-scope no-op.
 * Only `scope === 'global'` copies these scripts at all (see the call sites),
 * so in project scope the sentence described normal behaviour in the wording
 * of a fault, and a healthy `peaks hooks install` read as broken.
 *
 * Scope is therefore what decides the sentence, and it is knowable here — the
 * copy helper cannot tell the two cases apart because both return
 * `copied: false`, but the caller can. Project scope emits no line: there is
 * no action to take, and the envelope's `bridgeHookCopy` / `codeGateHookCopy`
 * field still reports `copied: false` for anyone reading the JSON.
 */
function describeHookCopy(
  label: string,
  copy: HookScriptCopy,
  scope: HookScope,
  dryRun: boolean
): string | null {
  if (scope !== 'global') return null;
  if (copy.copied) {
    return dryRun
      ? `would copy ${label} from ${copy.source} to ${copy.target}`
      : `Copied ${label}: ${copy.target}`;
  }
  return `${label} NOT copied — source missing at ${copy.source}. Run the build (\`pnpm build\`) so the script ships with the package.`;
}

/** The `--dry-run` envelope: what the install WOULD write, and nothing written. */
export function printInstallDryRun(
  io: ProgramIO,
  options: HookCliOptions,
  ctx: InstallContext,
  copies: HookScriptCopies
): void {
  const plan = planHookInstall(ctx.scope, ctx.projectRoot, {
    ide: ctx.ide,
    skipProgress: ctx.skipProgress
  });
  const dryRunEntries = listExpectedEntriesForIde(ctx.ide, ctx.skipProgress);
  const { bridgeCopy, codeGateCopy } = copies;
  printResult(
    io,
    ok(
      'hooks.install',
      {
        ...plan,
        ide: ctx.ide,
        applied: false,
        dryRun: true,
        skipProgress: ctx.skipProgress,
        entries: dryRunEntries,
        bridgeHookCopy: bridgeCopy,
        codeGateHookCopy: codeGateCopy,
        // Layer 3 deny entries the install WOULD write. The
        // dry-run branch never actually invokes
        // `applyHookInstall`, so the on-disk snapshot is not
        // consulted here — the list is the desired-state
        // constant for clarity in the JSON envelope.
        permissionsDenyEntries: listSuperpowersDenyEntries()
      },
      [],
      [
        `would install ${dryRunEntries.length} peaks-managed hook entries`,
        // Name the target file of every entry: the gate-enforce entry is
        // routed to the machine-local settings file (see
        // `resolveHookTargets`), so a summary that only listed
        // `settingsPath` + the entry names read as if it landed in the
        // committed, shared file.
        ...plan.entryTargets.map(
          (entry) =>
            `would write ${entry.matcher || '(no matcher)'} → ${entry.sentinel} to ${entry.settingsPath}`
        ),
        `would write ${listSuperpowersDenyEntries().length} permissions.deny entries (Layer 3 worktree governance)`,
        describeHookCopy('bridge hook', bridgeCopy, ctx.scope, true),
        describeHookCopy('code-gate hook', codeGateCopy, ctx.scope, true)
      ].filter((line): line is string => line !== null)
    ),
    options.json
  );
}

/** The applying envelope: the install's own result plus the copies and the deny state. */
export function printInstallApplied(
  io: ProgramIO,
  options: HookCliOptions,
  ctx: InstallContext,
  copies: HookScriptCopies
): void {
  const result = applyHookInstall(ctx.scope, ctx.projectRoot, {
    ide: ctx.ide,
    skipProgress: ctx.skipProgress
  });
  // Slice #3: build the per-IDE entries summary for the IDE the user
  // targeted, not the slice #1 PEAKS_HOOK_ENTRIES constant (which is the
  // claude-code default). The summary is derived from the install's own
  // entry table — see `listExpectedEntriesForIde`.
  const installedEntries = listExpectedEntriesForIde(ctx.ide, ctx.skipProgress);
  const { bridgeCopy, codeGateCopy } = copies;
  const nextActions = result.applied
    ? [
        'Restart the IDE (or reload the workspace) so the hook entries take effect',
        `Installed: ${installedEntries.map((e) => `${e.matcher}→${e.sentinel}`).join(', ')}`,
        // write alongside the hook install — single atomic write.
        `Layer 3 deny: wrote ${listSuperpowersDenyEntries().length} permissions.deny entries (worktree governance)`,
        describeHookCopy('bridge hook', bridgeCopy, ctx.scope, false),
        describeHookCopy('code-gate hook', codeGateCopy, ctx.scope, false)
      ].filter((line): line is string => line !== null)
    : [describeHookCopy('bridge hook', bridgeCopy, ctx.scope, false)].filter(
        (line): line is string => line !== null
      );
  // in the JSON envelope so downstream automation (audit / sc) can
  // confirm Layer 3 was applied without re-reading the file. When
  // the install is a no-op (`applied: false`) the deny block was
  // already on disk from a prior install; we still emit the
  // current desired list for symmetry with the dry-run envelope.
  printResult(
    io,
    ok(
      'hooks.install',
      {
        ...result,
        ide: ctx.ide,
        dryRun: false,
        skipProgress: ctx.skipProgress,
        entries: installedEntries.map((e) => ({ matcher: e.matcher, sentinel: e.sentinel })),
        bridgeHookCopy: bridgeCopy,
        codeGateHookCopy: codeGateCopy,
        permissionsDenyApplied: result.applied,
        permissionsDenyEntries: listSuperpowersDenyEntries()
      },
      [],
      nextActions
    ),
    options.json
  );
}
