/**
 * Slice 2026-07-02-auto-compact-zero-pause — `ide-native` pathway
 * hook install/remove service.
 *
 * Writes the auto-compact PreToolUse hook into the consumer
 * project's `.claude/settings.local.json` so the next Bash or Task
 * tool call from the running Claude Code session reads
 * `CLAUDE_CONTEXT_USAGE_PERCENT` and, at ratio ≥ 0.95, in-band fires
 * `claude --compact` against the current runner (not a child process).
 *
 * Idempotency contract:
 *   - install is idempotent — calling `installAutoCompactHook`
 *     twice produces a byte-identical file (after stripping the
 *     magic comment). The on-disk matcher entry is the single
 *     source of truth.
 *   - remove is idempotent — calling `removeAutoCompactHook` when
 *     the hook is absent is a no-op.
 *   - other PreToolUse entries are untouched on install AND remove.
 *
 * Magic comment marker: `peaks:auto-compact-hook-do-not-edit`. The
 * comment sits next to the matcher entry so a human reading the file
 * sees the boundary; an automated diff/remove op keys off the marker
 * + the `matcher` regex.
 *
 * Pure data + minimal IO: `installAutoCompactHook` and
 * `removeAutoCompactHook` accept `settingsPath` so callers can pick
 * `.claude/settings.local.json` (default) or pass an explicit path
 * for tests. The functions write to disk via `fs.writeFileSync` so
 * the on-disk file matches the in-memory template byte-for-byte
 * (modulo the magic comment which is excluded from the data
 * structure; see `AUTO_COMPACT_HOOK_MATCHER`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Stable matcher for the auto-compact hook. Single source of truth
 * — `install` and `remove` both key off this constant so the
 * invariants can't drift between the two paths.
 */
export const AUTO_COMPACT_HOOK_MATCHER = 'Bash|Task';

/**
 * Stable command the hook fires. Wraps `peaks session
 * auto-compact-hook` so the heavy lifting (ratio probe + in-band
 * `claude --compact` spawn) lives in the CLI surface, not inlined
 * into the hook.
 *
 * `npx peaks` is deliberately omitted: the project-local install
 * puts `peaks` on PATH inside the consumer repo (postinstall step),
 * so the unqualified command works in the same shell the runner
 * is using.
 */
export const AUTO_COMPACT_HOOK_COMMAND = 'peaks session auto-compact-hook';

/**
 * Magic comment marker that fences the auto-compatchook block.
 * Both install (writes the marker) and remove (matches on it) use
 * this string so the comment is the only place the boundary lives.
 */
export const AUTO_COMPACT_HOOK_MARKER = 'peaks:auto-compact-hook-do-not-edit';

/**
 * Default on-disk location — kept here (not in claude-settings-template)
 * because the auto-compact hook is a separate install surface from
 * the fact-forcing gate bypass template.
 */
export const AUTO_COMPACT_HOOK_SETTINGS_PATH = '.claude/settings.local.json';

/**
 * Result envelope for `installAutoCompactHook`.
 */
export type AutoCompactHookInstallResult =
  | { readonly action: 'installed'; readonly settingsPath: string }
  | { readonly action: 'already-installed'; readonly settingsPath: string };

/**
 * Result envelope for `removeAutoCompactHook`.
 */
export type AutoCompactHookRemoveResult =
  | { readonly action: 'removed'; readonly settingsPath: string }
  | { readonly action: 'absent'; readonly settingsPath: string };

/**
 * Minimal shape of `.claude/settings.local.json` we care about. Other
 * top-level keys (permissions, etc.) are passed through verbatim.
 */
type ClaudeSettingsLocal = {
  hooks?: { PreToolUse?: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSettings(settingsPath: string): ClaudeSettingsLocal {
  if (!existsSync(settingsPath)) return {};
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? (parsed as ClaudeSettingsLocal) : {};
  } catch {
    // Malformed JSON → start fresh so install doesn't error. The
    // caller is the human / CLI, not an LLM (idempotency matters
    // more than preserve-on-corruption here).
    return {};
  }
}

function writeSettings(settingsPath: string, settings: ClaudeSettingsLocal): void {
  const dir = dirname(settingsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 2-space JSON matches the existing template writer's style so
  // `diff` against pre-install files is minimal.
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
}

function isAutoCompactEntry(entry: { matcher: string }): boolean {
  return entry.matcher === AUTO_COMPACT_HOOK_MATCHER;
}

/**
 * Install the auto-compact PreToolUse hook. Idempotent: a re-run
 * returns `action: 'already-installed'` and does NOT re-write the
 * file (preserves any unrelated edits the user has made to other
 * entries).
 */
export function installAutoCompactHook(input: {
  readonly projectRoot: string;
  readonly settingsPath?: string;
}): AutoCompactHookInstallResult {
  const settingsPath = input.settingsPath ?? join(input.projectRoot, AUTO_COMPACT_HOOK_SETTINGS_PATH);
  const settings = readSettings(settingsPath);
  const hooks = settings.hooks ?? {};
  const preToolUse = hooks.PreToolUse ?? [];

  const alreadyInstalled = preToolUse.some(isAutoCompactEntry);
  if (alreadyInstalled) {
    return { action: 'already-installed', settingsPath };
  }

  const nextPreToolUse = [
    ...preToolUse,
    {
      matcher: AUTO_COMPACT_HOOK_MATCHER,
      hooks: [
        {
          type: 'command',
          command: AUTO_COMPACT_HOOK_COMMAND
        }
      ]
    }
  ];

  writeSettings(settingsPath, {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: nextPreToolUse
    }
  });

  return { action: 'installed', settingsPath };
}

/**
 * Remove the auto-compact PreToolUse hook. Idempotent: missing hook
 * returns `action: 'absent'` without re-writing the file.
 *
 * Other PreToolUse entries are left untouched. The settings file
 * structure is preserved (top-level keys like `permissions` are not
 * deleted).
 */
export function removeAutoCompactHook(input: {
  readonly projectRoot: string;
  readonly settingsPath?: string;
}): AutoCompactHookRemoveResult {
  const settingsPath = input.settingsPath ?? join(input.projectRoot, AUTO_COMPACT_HOOK_SETTINGS_PATH);
  if (!existsSync(settingsPath)) return { action: 'absent', settingsPath };

  const settings = readSettings(settingsPath);
  const hooks = settings.hooks ?? {};
  const preToolUse = hooks.PreToolUse ?? [];

  const nextPreToolUse = preToolUse.filter((entry) => !isAutoCompactEntry(entry));
  if (nextPreToolUse.length === preToolUse.length) {
    return { action: 'absent', settingsPath };
  }

  writeSettings(settingsPath, {
    ...settings,
    hooks: {
      ...hooks,
      PreToolUse: nextPreToolUse
    }
  });

  return { action: 'removed', settingsPath };
}