/**
 * The peaks-managed `permissions.deny` entries, and their inverses.
 *
 * Split out of `hooks-settings-service.ts` (file-size cap campaign). The
 * service re-exports every name declared here, so existing importers keep
 * using `./hooks-settings-service.js` unchanged.
 */
import {
  SUPERPOWERS_DENIED_SKILLS,
  SUPERPOWERS_DENY_SENTINELS,
  formatSuperpowersDenyEntry
} from './hooks-codegate-superpowers.js';

/**
 * Merge the peaks-managed Skill denylist into the existing settings object.
 * Preserves every other `permissions.deny` entry the user (or another tool)
 * has written so the install is additive, not destructive. The output is
 * always deterministic: the same input always yields the same output,
 * regardless of insertion order in the source array.
 *
 * Defensive behavior:
 * - `settings.permissions` is missing or non-object → install creates a
 *   fresh `permissions: { deny: [...our entries] }` object.
 * - `settings.permissions.deny` is missing or non-array → install replaces
 *   the field with a fresh array containing only our entries.
 * - Duplicate entries (any source) are collapsed to one via `new Set`.
 *
 * The function is pure: it does not mutate the input. Atomic write happens
 * at the call site (`applyHookInstall`).
 */
export function withSuperpowersSkillDenylist(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const ourEntries = SUPERPOWERS_DENIED_SKILLS.map(formatSuperpowersDenyEntry);
  const permissions =
    settings.permissions &&
    typeof settings.permissions === 'object' &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const existingDeny: string[] = Array.isArray(permissions.deny)
    ? (permissions.deny as string[]).filter((d): d is string => typeof d === 'string')
    : [];
  const otherDeny = existingDeny.filter((d) => !SUPERPOWERS_DENY_SENTINELS.has(d));
  const finalDeny = [...new Set([...otherDeny, ...ourEntries])];
  return {
    ...settings,
    permissions: { ...permissions, deny: finalDeny }
  };
}

/**
 * Inverse of `withSuperpowersSkillDenylist`. Removes every peaks-managed
 * `UseSkill(...)` entry from the deny list. If the resulting deny list is
 * empty, the `deny` field itself is deleted; if the `permissions` object
 * becomes empty, the `permissions` field itself is deleted. This is the
 * uninstall path: every field we wrote must be removed exactly, and no
 * other field may be touched.
 *
 * Pure (no mutation).
 */
export function withoutSuperpowersSkillDenylist(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const permissions =
    settings.permissions &&
    typeof settings.permissions === 'object' &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {};
  if (!Array.isArray(permissions.deny)) {
    return settings;
  }
  const remainingDeny = (permissions.deny as string[])
    .filter((d): d is string => typeof d === 'string')
    .filter((d) => !SUPERPOWERS_DENY_SENTINELS.has(d));
  const nextPermissions: Record<string, unknown> = { ...permissions };
  if (remainingDeny.length > 0) {
    nextPermissions.deny = remainingDeny;
  } else {
    delete nextPermissions.deny;
  }
  if (Object.keys(nextPermissions).length === 0) {
    // The whole `permissions` object is empty (no deny, no allow, no other
    // sub-fields). Drop it to avoid leaving an empty object on disk.
    const rest: Record<string, unknown> = { ...settings };
    delete rest['permissions'];
    return rest;
  }
  return { ...settings, permissions: nextPermissions };
}

/**
 * Read-only introspection. Returns the deny entries that `peaks hooks
 * install` would write today. Useful for `peaks hooks status` and the
 * dry-run envelope.
 */
export function listSuperpowersDenyEntries(): ReadonlyArray<string> {
  return SUPERPOWERS_DENIED_SKILLS.map(formatSuperpowersDenyEntry);
}
/**
 *
 * In addition to the static SUPERPOWERS_DENIED_SKILLS list, peaks
 * scans the existing settings file for "trigger phrases" that
 * indicate the user has configured the superpowers chain (or
 * any other auto-run worktree-creating tool) and appends a
 * defensive deny to prevent the chain from running raw
 * `git worktree add` (or `podman run`) directly.
 *
 * Triggers detected (substring match on the existing
 * permissions.deny / permissions.allow list):
 *
 *  - `superpowers:using-git-worktrees` — the chain's ground zero
 *  - `superpowers:brainstorming` etc. — the upstream skill
 *  - `Bash(git worktree add` — the user has explicitly
 *    allowed raw git worktree, which our L2 lease-aware gate
 *    would also intercept (defense in depth)
 *
 * Append-only — never replaces, never re-orders, never removes
 * existing entries. Idempotent: re-running the install with
 * the same input yields the same output.
 */
export const TRIGGER_PHRASES: ReadonlyArray<string> = Object.freeze([
  'superpowers:using-git-worktrees',
  'superpowers:brainstorming',
  'superpowers:writing-plans',
  'superpowers:subagent-driven-development',
  'Bash(git worktree add',
  'Bash(podman run'
]);

/**
 * Format a trigger-phrase into a stable `Edit` deny entry. We deny
 * `Edit` (not `Bash`) on the *settings file* itself, so the
 * user cannot edit the trigger away without an explicit
 * `peaks hooks uninstall` first. The skill name (when
 * applicable) is the value after the colon.
 */
function formatTriggerDenyEntry(phrase: string): string {
  return `Edit(deny-trigger:${phrase})`;
}

export function withTriggeredDenyList(settings: Record<string, unknown>): Record<string, unknown> {
  const existingDeny: string[] = Array.isArray(
    (settings.permissions as Record<string, unknown> | undefined)?.deny
  )
    ? ((settings.permissions as Record<string, unknown>).deny as unknown[]).filter(
        (d): d is string => typeof d === 'string'
      )
    : [];
  // Detect triggers in the existing allow + deny lists.
  const existingAllow: string[] = Array.isArray(
    (settings.permissions as Record<string, unknown> | undefined)?.allow
  )
    ? ((settings.permissions as Record<string, unknown>).allow as unknown[]).filter(
        (d): d is string => typeof d === 'string'
      )
    : [];
  const haystack = [...existingDeny, ...existingAllow].join('|');
  const triggered = TRIGGER_PHRASES.filter((p) => haystack.includes(p));
  if (triggered.length === 0) return settings;
  const triggeredEntries = triggered.map(formatTriggerDenyEntry);
  const permissions =
    settings.permissions &&
    typeof settings.permissions === 'object' &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const otherDeny = existingDeny.filter((d) => !triggeredEntries.includes(d));
  return {
    ...settings,
    permissions: { ...permissions, deny: [...new Set([...otherDeny, ...triggeredEntries])] }
  };
}

/** Inverse of withTriggeredDenyList: strip every deny-trigger entry. */
export function withoutTriggeredDenyList(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const permissions =
    settings.permissions &&
    typeof settings.permissions === 'object' &&
    !Array.isArray(settings.permissions)
      ? (settings.permissions as Record<string, unknown>)
      : {};
  const existingDeny: string[] = Array.isArray(permissions.deny)
    ? (permissions.deny as string[]).filter((d): d is string => typeof d === 'string')
    : [];
  const kept = existingDeny.filter((d) => !d.startsWith('Edit(deny-trigger:'));
  const next: Record<string, unknown> = { ...permissions, deny: kept };
  if (kept.length === 0) delete next.deny;
  if (Object.keys(next).length === 0) {
    const out = { ...settings };
    delete out.permissions;
    return out;
  }
  return { ...settings, permissions: next };
}
