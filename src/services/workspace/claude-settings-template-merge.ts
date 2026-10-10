/**
 * `claude-settings-template-merge.ts` — the comparison and the merge that decide
 * whether an on-disk settings file still declares what the template declares, and
 * that carry every entry the template does not declare across untouched.
 *
 * Split out of `claude-settings-template.ts` (475 raw lines against the 300 cap)
 * when the two layer-B feedback hook entries had to be added to the template: that
 * file now holds the template's own shape, and this one holds the merge machinery.
 * The bodies moved verbatim; the three non-null assertions became the explicit
 * `undefined` checks they already were in effect, so this module is clean at birth.
 * `claude-settings-template.ts` re-exports every symbol below, so it stays the
 * single public entry point for this concern.
 */

import { hasExternalGateExemptions } from '../skills/hooks-codegate-superpowers.js';

/**
 * Compare two serialized template strings: does the on-disk file already
 * declare every entry the generated tree declares?
 *
 * This comparator answers "is each entry the GENERATED tree declares present
 * on disk?", NOT "are the two `hooks` trees identical". Extra on-disk entries
 * are IGNORED, so an entry another writer put in this file never makes it look
 * drifted.
 *
 * That is the deliberate other half of the entry-level merge in
 * `mergeTemplateOwnedHooks` / `workspace-claude-settings-materializer.ts`.
 * `.claude/settings.local.json` has a SECOND writer of `hooks.PreToolUse`:
 * `installAutoCompactHook` appends a `Bash|Task` entry. Under the previous
 * exact-tree rule the merged file carried 4 entries against a 3-entry
 * generated tree, so every `peaks workspace init` answered "drifted",
 * rewrote, and reported `refreshed` forever — precisely the state whole-key
 * ownership existed to prevent, and the reason the merge could not ship alone.
 *
 * Matching is order-insensitive AND multiset-aware: the template declares TWO
 * `Bash` entries, and each must have its own counterpart on disk, so a file
 * carrying only one of them is still reported as drifted (the previous
 * index-by-index loop had the same property; it is load-bearing, not a
 * detail).
 *
 * Returns `true` iff both strings parse to objects whose `hooks.PreToolUse`
 * arrays satisfy that containment, the on-disk file carries NO entry this
 * template has retired (`isRetiredTemplateEntry`), AND the on-disk `env`
 * already carries every exemption the template declares (extra on-disk keys
 * and extra globs are allowed — a user may exempt other trees, and a
 * requirement the file already exceeds must not re-trigger a write).
 *
 * Returns `false` on any `JSON.parse` error, shape mismatch, or
 * missing `hooks.PreToolUse`. Whitespace and key order do NOT affect
 * the result — the comparison is on the parsed AST, not on bytes.
 *
 * This is the comparator `initWorkspace` uses to decide whether to
 * refresh a stale `.peaks/.claude-settings-template.json` on disk.
 */
export function templateContentMatches(generated: string, onDisk: string): boolean {
  let parsedGenerated: unknown;
  let parsedOnDisk: unknown;
  try {
    parsedGenerated = JSON.parse(generated);
  } catch {
    return false;
  }
  try {
    parsedOnDisk = JSON.parse(onDisk);
  } catch {
    return false;
  }

  if (!isTemplateShape(parsedGenerated) || !isTemplateShape(parsedOnDisk)) {
    return false;
  }

  // Multiset containment: consume one on-disk entry per generated entry so a
  // file holding a single copy of a doubly-declared entry still fails.
  const unmatched = [...parsedOnDisk.hooks.PreToolUse];
  for (const required of parsedGenerated.hooks.PreToolUse) {
    const at = unmatched.findIndex((candidate) => sameEntry(required, candidate));
    if (at === -1) {
      return false;
    }
    unmatched.splice(at, 1);
  }

  // A RETIRED entry on disk is drift, and this clause is what makes the
  // retirement in `mergeTemplateOwnedHooks` reach an installed file at all.
  //
  // Containment alone cannot express it: a file still carrying
  // `Write|Edit|MultiEdit` declares every entry the template declares, so
  // `templateContentMatches` answered "current", no rewrite ran, and the merge
  // never got the chance to drop it. Measured on a throwaway project root
  // before this clause existed — init against the rebuilt CLI reported
  // `already-current` and the retired entry survived verbatim. Declaring less
  // is not a retirement; the comparator has to say so.
  //
  // One extra rewrite per affected install, then the fixed point holds: the
  // merge emits no retired entry, so the next comparison finds none and
  // answers `current`.
  if (parsedOnDisk.hooks.PreToolUse.some((entry) => isRetiredTemplateEntry(entry))) {
    return false;
  }

  // A project installed by a release that predates a template-declared
  // exemption still needs the refresh this comparator gates — otherwise the
  // entry would only ever appear on a machine that re-ran `peaks hooks
  // install`. `hasExternalGateExemptions` is the same predicate the installer
  // uses, so the two writers cannot drift apart.
  return hasExternalGateExemptions({ env: (parsedOnDisk as { env?: unknown }).env });
}

/**
 * Merge the on-disk `hooks.PreToolUse` list with the template's.
 *
 * the entries IT DECLARES — and nothing else. Every other on-disk entry is
 * carried across verbatim, whatever its matcher, because the template has no
 * opinion about it:
 *
 *   - a `matcher` the template does not declare (`Bash|Task`, the auto-compact
 *     hook `installAutoCompactHook` appends) is never touched;
 *   - surplus entries BEYOND the template's count for a declared matcher (a
 *     user's own `Bash` hook) are surplus too, and survive;
 *   - an on-disk entry that fills a declared slot is REPLACED by the template's
 *     entry for it. That is what makes a hand-edited (or older-release) entry
 *     self-heal instead of lingering next to a correct copy of itself.
 *
 * Slot counting is per `matcher` and positional within it: the template
 * declares TWO `Bash` entries, so the first two on-disk `Bash` entries are
 * theirs and a third is the user's. The template's entries are emitted first,
 * in template order, then the preserved ones in their on-disk order — which is
 * a fixed point: re-merging the result yields the result (the template's own
 * entries are encountered first and refill their own slots).
 *
 * Non-conforming entries (no string `matcher`, no `hooks` array) are preserved
 * rather than dropped: guessing at their shape is how a user's entry gets
 * deleted.
 *
 * ONE exception to "preserve what I do not declare": an entry this template
 * used to declare and RETIRED (TEMPLATE_VERSION 1.8.0's `Write|Edit|MultiEdit`
 * gate — see `isRetiredTemplateEntry`) is dropped rather than preserved.
 * Declaring less cannot retire an entry on its own, because preserving
 * undeclared entries is exactly what this function does; without the drop, a
 * pre-1.8.0 install would keep the no-op handler and its version-pinned script
 * path forever. The predicate is narrow enough that only the exact command
 * this template emitted matches.
 */
export function mergeTemplateOwnedHooks(
  onDisk: ReadonlyArray<unknown>,
  template: ReadonlyArray<unknown>
): unknown[] {
  const slots = new Map<string, number>();
  for (const entry of template) {
    if (!isPreToolUseEntry(entry)) continue;
    slots.set(entry.matcher, (slots.get(entry.matcher) ?? 0) + 1);
  }

  const taken = new Map<string, number>();
  const preserved: unknown[] = [];
  for (const entry of onDisk) {
    // Retired by this template — dropped, not carried across.
    if (isRetiredTemplateEntry(entry)) {
      continue;
    }
    // Unowned by construction: not a shape the template could have declared.
    if (!isPreToolUseEntry(entry)) {
      preserved.push(entry);
      continue;
    }
    const declared = slots.get(entry.matcher) ?? 0;
    const used = taken.get(entry.matcher) ?? 0;
    if (used >= declared) {
      preserved.push(entry);
      continue;
    }
    taken.set(entry.matcher, used + 1);
  }

  return [...template, ...preserved];
}

/** Structural equality of two `PreToolUse` entries. */
function sameEntry(a: TemplatePreToolUseEntry, b: TemplatePreToolUseEntry): boolean {
  return a.matcher === b.matcher && sameHooksArray(a.hooks, b.hooks);
}

type TemplateHookCommand = { type: string; command: string; shell?: string };

/**
 * One `hooks.PreToolUse` entry in the shape this template declares. The
 * `matcher` + `hooks` pair is the entry's identity everywhere below: `matcher`
 * alone is not unique (two `Bash` entries), and whole-object identity would
 * make a hand-edited entry unrecognizable and therefore unrepairable.
 */
type TemplatePreToolUseEntry = { matcher: string; hooks: TemplateHookCommand[] };

type TemplateShape = {
  hooks: { PreToolUse: TemplatePreToolUseEntry[] };
};

function isPreToolUseEntry(value: unknown): value is TemplatePreToolUseEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as { matcher?: unknown; hooks?: unknown };
  return typeof candidate.matcher === 'string' && Array.isArray(candidate.hooks);
}

function isTemplateShape(value: unknown): value is TemplateShape {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { hooks?: unknown };
  if (typeof candidate.hooks !== 'object' || candidate.hooks === null) {
    return false;
  }
  const hooksObj = candidate.hooks as { PreToolUse?: unknown };
  return Array.isArray(hooksObj.PreToolUse);
}

function sameHooksArray(
  a: ReadonlyArray<TemplateHookCommand>,
  b: ReadonlyArray<TemplateHookCommand>
): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    const ha = a[i];
    const hb = b[i];
    if (ha === undefined || hb === undefined) {
      return false;
    }
    // `shell` participates in the comparison: it is machine-specific (see
    // `resolveHookShell`), so a file written on one platform must be
    // recognized as drifted on the other instead of silently kept.
    if (ha.type !== hb.type || ha.command !== hb.command || ha.shell !== hb.shell) {
      return false;
    }
  }
  return true;
}

/**
 * The retired `Write|Edit|MultiEdit` gate entry, as an on-disk file written by
 * a pre-1.8.0 release holds it.
 *
 * TEMPLATE_VERSION 1.8.0 stopped emitting this entry. Declaring less is not
 * enough on its own: `mergeTemplateOwnedHooks` preserves every on-disk entry
 * the template does not declare — that is the whole point of the entry-level
 * ownership rule (it is what keeps `installAutoCompactHook`'s `Bash|Task`
 * entry alive) — so a project installed by an earlier release would keep the
 * no-op handler, and its `node "C:/…/nvm/v24.14.0/…"` path, forever. This
 * predicate is the retirement: `mergeTemplateOwnedHooks` drops a match.
 *
 * Deliberately narrow. It matches the exact command shape this template used
 * to emit — one handler, `node "<…>/services/hooks/write-gate.js"` — under the
 * exact legacy matcher spelling, so a user's OWN `Write|Edit|MultiEdit` entry
 * (a different command, or more than one handler) is preserved like any other
 * entry the template does not declare. A looser "drop anything on this
 * matcher" rule would delete a user's hook, which is the failure the ownership
 * rule exists to prevent.
 */
const RETIRED_WRITE_GATE_MATCHER = 'Write|Edit|MultiEdit';
const RETIRED_WRITE_GATE_COMMAND = /^node "[^"]*\/services\/hooks\/write-gate\.js"$/;

export function isRetiredTemplateEntry(entry: unknown): boolean {
  if (!isPreToolUseEntry(entry)) return false;
  if (entry.matcher !== RETIRED_WRITE_GATE_MATCHER) return false;
  if (entry.hooks.length !== 1) return false;
  const [handler] = entry.hooks;
  if (handler === undefined) return false;
  return handler.type === 'command' && RETIRED_WRITE_GATE_COMMAND.test(handler.command);
}
