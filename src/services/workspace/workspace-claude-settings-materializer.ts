/**
 * Workspace Service -- consumer `.claude/settings.local.json` materialization.
 *
 * v2.18.3 file-split: this module is the extracted sub-tree of the
 * pre-split `workspace-service.ts`. It hosts the 3 helpers
 * (`materializeClaudeSettingsLocal`, `writeOfflineTemplateCopy`,
 * `upsertPeaksGitignoreSnippet`) plus the `PEAKS_GITIGNORE_*`
 * constants. The high-level `initWorkspace` orchestrator lives in
 * the parent module and calls into this sibling. Function signatures
 * and behaviour are unchanged (verbatim move).
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { withExternalGateExemptions } from '../skills/hooks-codegate-superpowers.js';
import {
  buildClaudeSettingsLocalJson,
  CLAUDE_SETTINGS_LOCAL_FILENAME,
  mergeTemplateOwnedHooks,
  templateContentMatches
} from './claude-settings-template.js';

/** Read a file as text, or `undefined` when it cannot be read. */
function readTextIfPresent(filePath: string): string | undefined {
  try {
    return readFileSync(filePath, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * The parsed top-level object of a serialized settings file, or `undefined`
 * when the file is malformed or is not a JSON object. Tolerant on purpose: a
 * bad on-disk file must not stop the materialization.
 */
function readSettingsObject(serialized: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(serialized);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** The `env` object of a serialized settings file, or `undefined`. */
function readEnvObject(serialized: string): Record<string, unknown> | undefined {
  const env = readSettingsObject(serialized)?.env;
  return typeof env === 'object' && env !== null && !Array.isArray(env) ? (env as Record<string, unknown>) : undefined;
}

/**
 * The top-level keys this function's template is allowed to DECIDE. Every other
 * key on disk belongs to whoever put it there and is carried across verbatim.
 *
 *  - `hooks` — the tree this function exists to keep in sync, ENTRY BY ENTRY.
 *    `peaks workspace init` converges a consumer's file on the current
 *    release's handler set, and `templateContentMatches` (the drift detector
 *    that decides whether to rewrite at all) asks whether every entry the
 *    generated tree declares is present — not whether the trees are equal.
 *    Letting the disk win outright would make the rewrite a no-op that reports
 *    `refreshed` forever AND would never deliver a changed handler; letting the
 *    template win outright is what deleted the auto-compact hook. See
 *    `mergeHooksTree` / `mergeTemplateOwnedHooks` for the rule that does
 *    neither.
 *  - `env` — jointly owned with `peaks hooks install`, which unions the user's
 *    exemption globs into it. Handled as a union below, not by either side
 *    winning outright.
 *
 * This is deliberately an owned-key LIST and not a preserved-key whitelist: the
 * direction matters. A whitelist drops every key it was not told about — which
 * is how `permissions` was lost — whereas anything absent from this list is
 * preserved by default, including keys no release of peaks-loop knows about.
 *
 * ⚠️ `hooks` USED TO BE OWNED WHOLE — every entry in it was deleted by the next
 * `peaks workspace init` unless the template declared it, silently:
 * `templateContentMatches` saw the extra entry, answered "drifted", and the
 * rewrite emitted `{...template}`. That was not hypothetical.
 * `.claude/settings.local.json` has a second writer of peaks' OWN hooks:
 * `installAutoCompactHook` (`src/services/hooks/auto-compact-hook-install.ts`),
 * reached from `peaks code auto-compact` on an adapter declaring
 * `compactPathway: 'ide-native'` — which `claude-code` does. Measured on a
 * throwaway project root (rid 2026-09-13-two-decisions item ②):
 *
 *   init (written, 3 PreToolUse entries: Write|Edit|MultiEdit, Bash, Bash)
 *   → installAutoCompactHook (installed, 4: … | Bash|Task)
 *   → init again (REFRESHED, 3: … )   ← the Bash|Task entry is gone
 *
 * and nothing re-installs it: the hook's whole job was to fire on the next
 * Bash/Task call, so once it is deleted the auto-compact contract stops
 * silently.
 *
 * FIXED 2026-09-13 (user-decided): this template now owns only the entries IT
 * DECLARES. `mergeHooksTree` below unions the rest of the on-disk `hooks` tree
 * across verbatim, and `templateContentMatches` — the drift detector — was
 * changed in the same slice from "the trees are identical" to "every entry the
 * generated tree declares is present". The two halves are one change: the merge
 * alone would leave the comparator comparing a 3-entry generated tree against a
 * 4-entry file on EVERY init and reporting `refreshed` forever, which is the
 * state whole-key ownership existed to prevent. See
 * `mergeTemplateOwnedHooks` in `claude-settings-template.ts` for the ownership
 * rule and `templateContentMatches` for the containment rule it implies.
 */
const TEMPLATE_OWNED_KEYS: ReadonlySet<string> = new Set(['hooks', 'env']);

/** `template`'s own keys, then every on-disk key the template does not own. */
function carryUserOwnedKeys(
  onDisk: Record<string, unknown>,
  template: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...template };
  for (const [key, value] of Object.entries(onDisk)) {
    if (TEMPLATE_OWNED_KEYS.has(key)) continue;
    merged[key] = value;
  }
  merged.hooks = mergeHooksTree(onDisk.hooks, template.hooks);
  return merged;
}

/**
 * Merge the on-disk `hooks` tree with the template's, one event at a time.
 *
 * Only the events the template DECLARES are merged (and only their declared
 * entries — see `mergeTemplateOwnedHooks`); every other event, and every other
 * key under `hooks`, is carried across from the disk untouched. The template
 * currently declares `PreToolUse` alone, so this is what keeps a hand-added or
 * future-installer `SessionStart` entry in this file instead of deleting it —
 * the latent half of the hazard the header describes.
 */
function mergeHooksTree(onDiskHooks: unknown, templateHooks: unknown): Record<string, unknown> {
  const onDisk = isPlainRecord(onDiskHooks) ? { ...onDiskHooks } : {};
  const template = isPlainRecord(templateHooks) ? templateHooks : {};
  for (const [event, declared] of Object.entries(template)) {
    const current = onDisk[event];
    onDisk[event] = Array.isArray(declared)
      ? mergeTemplateOwnedHooks(Array.isArray(current) ? current : [], declared)
      : declared;
  }
  return onDisk;
}

/** A JSON object, as opposed to a null / array / primitive. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The peaks-managed snippet appended to the consumer project's
 * `.peaks/.gitignore` so the local-only settings file never lands
 * in a commit. Marked with a managed-by header so we can detect (and
 * not double-append) on subsequent inits.
 */
// Exported (S6, 2026-09-15) so the convergence tests can build a block with
// the REAL delimiters. A test that retypes them gets a prefix and silently
// exercises the append path instead of the converge path — which is exactly
// what happened on the first run of
// `tests/unit/services/workspace/gitignore-snippet-convergence.test.ts`.
export const PEAKS_GITIGNORE_HEADER = '# >>> peaks-loop managed snippet (slice 2.0.1-bug3) — do not edit by hand';
export const PEAKS_GITIGNORE_FOOTER = '# <<< peaks-loop managed snippet';

const PEAKS_GITIGNORE_SNIPPET = [
  PEAKS_GITIGNORE_HEADER,
  '# Consumer-project .claude/settings.local.json: written by `peaks workspace init`',
  '# to bypass Claude Code [Fact-Forcing Gate] for .peaks/** writes. Local-only.',
  '.claude/settings.local.json',
  '# Offline template copy (.peaks/.claude-settings-template.json): written by',
  '# `peaks workspace init` as a manual-recovery anchor. The source-of-truth is',
  '# peaks-loop\'s own `buildClaudeSettingsLocalJson()` — NOT this committed copy.',
  '# Gitignored so the init flow\'s drift-driven refresh does not show up as',
  '# "modified" in `git status` on every release bump. Recovery path: re-run',
  '# `peaks workspace init` to regenerate; or copy from peaks-loop source.',
  '# Both patterns below are PROJECT-ROOT-relative, so this snippet must land',
  '# in the root .gitignore — see `upsertPeaksGitignoreSnippet`.',
  '.peaks/.claude-settings-template.json',
  PEAKS_GITIGNORE_FOOTER,
  ''
].join('\n');

/**
 * Materialize the consumer-project `.claude/settings.local.json` and
 * ensure the consumer's `.peaks/.gitignore` covers it. Returns a
 * `claudeSettings` descriptor that the caller surfaces in the JSON
 * envelope.
 *
 * The function is idempotent: re-running on an already-materialized
 * project is a no-op (the file is rewritten only when its content
 * diverges from the current peaks-loop release's template, which
 * keeps the consumer up to date as the template evolves).
 *
 * Even when the caller passes `noClaudeHooks: true`, the function
 * still writes a copy of the template at
 * `.peaks/.claude-settings-template.json` so the user has an offline
 * recovery path: copy the file contents into
 * `.claude/settings.local.json` manually. The recovery path is
 * documented in
 * `skills/peaks-code/references/anchoring-and-session-info.md`.
 *
 * Slice 2026-06-13-selfheal-claude-settings-template: the offline copy
 * is now ALSO drift-checked (via `templateContentMatches`) so stale
 * on-disk copies from earlier peaks-loop releases (which lacked the
 * `node -e "..."` wrapper) get refreshed automatically on the next
 * init. The action taken on the offline copy is surfaced in
 * `claudeSettings.offlineTemplate.action`.
 */
export async function materializeClaudeSettingsLocal(
  projectRoot: string,
  noClaudeHooks: boolean
): Promise<{
  action: 'written' | 'refreshed' | 'already-current' | 'skipped';
  path: string;
  offlineTemplate: { action: 'written' | 'refreshed' | 'already-current'; path: string };
}> {
  const settingsRel = CLAUDE_SETTINGS_LOCAL_FILENAME;
  const settingsPath = join(projectRoot, settingsRel);
  const template = buildClaudeSettingsLocalJson();
  const fileExists = existsSync(settingsPath);
  const existing = fileExists ? readTextIfPresent(settingsPath) : undefined;

  // `.claude/settings.local.json` has a second writer: `peaks hooks install`
  // unions the user's own exemption globs into `env`. Carry that value across
  // the rewrite this function is about to do, or a refresh would silently
  // drop someone else's exemptions. The template's own row is added on top, so
  // the result is a union either way.
  //
  // The same argument applies to every OTHER top-level key on disk, which the
  // rewrite used to drop wholesale: `{ ...template }` emitted only the keys the
  // template declares, so a user's `permissions.allow`, `statusLine`, `model`,
  // … were deleted by an init that had no opinion about them. The user's
  // permission rules are not this function's to remove, and the removal was
  // silent — the envelope reported only `refreshed`. See `carryUserOwnedKeys`
  // for which keys the template still decides.
  const onDisk = existing === undefined ? undefined : readSettingsObject(existing);
  const onDiskEnv = existing === undefined ? undefined : readEnvObject(existing);
  const merged = onDisk === undefined ? template : carryUserOwnedKeys(onDisk, template);
  const serialized =
    JSON.stringify(
      withExternalGateExemptions(onDiskEnv === undefined ? merged : { ...merged, env: onDiskEnv }),
      null,
      2
    ) + '\n';

  // Always drop (or self-heal) a copy of the template under .peaks/
  // so the --no-claude-hooks recovery flow has a known source-of-truth
  // on disk. The file is gitignored by the snippet below.
  const offlineAction = await writeOfflineTemplateCopy(projectRoot, serialized);
  const offlineTemplate = {
    action: offlineAction,
    path: '.peaks/.claude-settings-template.json'
  };

  if (noClaudeHooks) {
    return { action: 'skipped', path: settingsRel, offlineTemplate };
  }

  // Best-effort: ensure .claude/ exists, then write the file. We do
  // not assertSafeSettingsPath here (the .claude/ dir is local to
  // the consumer and we trust it on first init; the existing
  // hooks-settings-service applies the safety check for the Bash
  // gate-enforce path).
  await mkdir(join(projectRoot, '.claude'), { recursive: true });

  // An existing-but-unreadable file is treated as drifted, so the consumer
  // always ends up with a valid template on disk.
  let action: 'written' | 'refreshed' | 'already-current' = fileExists ? 'refreshed' : 'written';
  // Structural comparison (not a byte comparison): `peaks hooks install` also
  // writes this file, through a different serializer, so an equal hooks tree
  // must be recognized as current or every init would rewrite the file and
  // drop the installer's entries.
  if (existing !== undefined && templateContentMatches(serialized, existing)) {
    action = 'already-current';
  }
  if (action !== 'already-current') {
    await writeFile(settingsPath, serialized, 'utf8');
  }

  // Ensure the consumer's .peaks/.gitignore covers the local-only
  // settings file. The snippet is appended only when the header is
  // missing, so subsequent inits do not double-append.
  await upsertPeaksGitignoreSnippet(projectRoot);

  return { action, path: settingsRel, offlineTemplate };
}

/**
 * Always write (or refresh) a copy of the template at
 * `.peaks/.claude-settings-template.json` so the user has a known
 * source-of-truth on disk for the manual recovery flow. The file is
 * GITIGNORED (added to `.peaks/.gitignore` by
 * `upsertPeaksGitignoreSnippet`) — the source-of-truth lives in
 * peaks-loop's own `buildClaudeSettingsLocalJson()`, NOT in any
 * committed copy. Gitignoring it ensures the init flow's drift-driven
 * refresh does not show up as "modified" in `git status` on every
 * peaks-loop release bump.
 *
 * Recovery path for users who need to re-create their
 * `.claude/settings.local.json`: re-run `peaks workspace init`
 * (the file is regenerated); or copy the template straight from
 * peaks-loop source (`src/services/workspace/claude-settings-template.ts`).
 *
 * Slice 2026-06-13-selfheal-claude-settings-template: drift-check via
 * `templateContentMatches` BEFORE writing. If the on-disk copy's
 * parsed hooks tree matches the current `buildClaudeSettingsLocalJson()`
 * output, the write is skipped (`already-current`). If the file is
 * missing, it is written (`written`). If it exists but has drifted
 * (e.g. an earlier release's template without the `node -e "..."`
 * wrapper, or a user-customised copy), it is rewritten (`refreshed`).
 * The CLI caller surfaces a warning when `refreshed` because manual
 * edits the user may have made would be overwritten.
 *
 * Returns the action taken so the caller can surface it in the
 * envelope. Read failures are treated as drift so a malformed
 * on-disk file always self-heals on the next init.
 *
 * WHAT IS COMPARED (rid 2026-09-13-two-decisions item ②): the copy is checked
 * against the TEMPLATE'S OWN entries — `buildClaudeSettingsLocalJson()` — not
 * against `serialized`, the merged LOCAL file content it is written from. This
 * file is a copy of the template (its name and this doc both say so), so
 * "is it current?" is a question about the template's entries only; asking it
 * against the merged local file made the copy report `refreshed` once for every
 * entry another writer had added to `.claude/settings.local.json` — drift noise
 * about a file the copy does not own, on the very init that is supposed to be a
 * no-op. With entry-containment semantics the copy is current as soon as it
 * declares every template entry, whatever else it carries.
 */
async function writeOfflineTemplateCopy(
  projectRoot: string,
  serialized: string
): Promise<'written' | 'refreshed' | 'already-current'> {
  const copyPath = join(projectRoot, '.peaks', '.claude-settings-template.json');
  await mkdir(join(projectRoot, '.peaks'), { recursive: true });

  let action: 'written' | 'refreshed' | 'already-current' = 'written';
  if (existsSync(copyPath)) {
    try {
      const { readFile } = await import('node:fs/promises');
      const existing = await readFile(copyPath, 'utf8');
      const declared = JSON.stringify(buildClaudeSettingsLocalJson());
      if (templateContentMatches(declared, existing)) {
        action = 'already-current';
      } else {
        action = 'refreshed';
      }
    } catch {
      // Treat any read failure as drift so the file self-heals.
      action = 'refreshed';
    }
  }
  if (action !== 'already-current') {
    await writeFile(copyPath, serialized, 'utf8');
  }
  return action;
}

/**
 * Append the peaks-managed snippet to the consumer project's ROOT
 * `.gitignore`. Preserves any user-managed entries above the snippet.
 * Idempotent: re-running on a project that already has the snippet is a
 * no-op.
 *
 * Root, not `.peaks/.gitignore`. A gitignore pattern containing a slash is
 * anchored to the directory of the .gitignore that holds it, and both
 * patterns here are project-root-relative. Written into `.peaks/.gitignore`
 * they resolved to `.peaks/.claude/settings.local.json` and
 * `.peaks/.peaks/.claude-settings-template.json` — matching nothing, in
 * every project. The root-level `settings.local.json` entry could not be
 * expressed from inside `.peaks/` at all, since gitignore has no `..`.
 */
/**
 * The snippet's former home. Projects initialized before the move carry a
 * managed block there that now matches nothing and is maintained by nobody —
 * yet still announces itself as "do not edit by hand", which is worse than
 * absent: a reader takes it for live configuration.
 */
const LEGACY_PEAKS_GITIGNORE_PATH = ['.peaks', '.gitignore'] as const;

/**
 * Strip the managed block from its legacy home, preserving every line the
 * user wrote. Idempotent; a no-op on projects that never had one.
 *
 * The file is deleted only when nothing remains. An empty `.peaks/.gitignore`
 * left behind reads as "peaks put something here and stopped", which invites
 * the next reader to guess.
 *
 * A malformed block (header without footer) is left untouched rather than
 * guessed at — deleting a user's file to tidy our own mess is not a trade
 * worth making.
 */
async function stripLegacyPeaksGitignoreSnippet(projectRoot: string): Promise<void> {
  const legacyPath = join(projectRoot, ...LEGACY_PEAKS_GITIGNORE_PATH);
  if (!existsSync(legacyPath)) return;

  let existing: string;
  try {
    existing = await readFile(legacyPath, 'utf8');
  } catch {
    return;
  }

  const start = existing.indexOf(PEAKS_GITIGNORE_HEADER);
  if (start === -1) return;
  const footerAt = existing.indexOf(PEAKS_GITIGNORE_FOOTER, start);
  if (footerAt === -1) return;

  const remainder = (existing.slice(0, start) + existing.slice(footerAt + PEAKS_GITIGNORE_FOOTER.length))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (remainder.length === 0) {
    await rm(legacyPath, { force: true });
    return;
  }
  await writeFile(legacyPath, `${remainder}\n`, 'utf8');
}

async function upsertPeaksGitignoreSnippet(projectRoot: string): Promise<void> {
  // Migration first: the snippet used to live in `.peaks/.gitignore`, where
  // its patterns silently matched nothing. Strip that copy before writing the
  // one that works.
  await stripLegacyPeaksGitignoreSnippet(projectRoot);

  const gitignorePath = join(projectRoot, '.gitignore');
  await mkdir(join(projectRoot, '.peaks'), { recursive: true });

  let existing = '';
  if (existsSync(gitignorePath)) {
    try {
      const { readFile } = await import('node:fs/promises');
      existing = await readFile(gitignorePath, 'utf8');
    } catch {
      existing = '';
    }
  }

  // D2 fix (2026-09-15): the block is now converged, not merely appended.
  //
  // Before this, a project that already had the header returned here forever:
  // the snippet was written once by whichever release first initialized the
  // project and NEVER updated, so a pattern added to the snippet by a later
  // release (`slice 2.0.1-bug3` moved the block from `.peaks/.gitignore` to
  // the root for exactly this class of reason) reached only projects that had
  // not been initialized yet — i.e. new users got the fix and existing users
  // did not, which is backwards.
  //
  // Scope of the rewrite is the managed block, and only the block. Every line
  // outside `HEADER..FOOTER` is spliced through byte-for-byte, which is the
  // "never overwrite the user's edits" semantic this function always had. The
  // header itself says "do not edit by hand"; a user who did is the case
  // `stripLegacyPeaksGitignoreSnippet` already refuses to guess at, and this
  // does the same — a header with no footer is left alone rather than opened
  // up and repaired at the risk of eating the rest of the file.
  const start = existing.indexOf(PEAKS_GITIGNORE_HEADER);
  if (start !== -1) {
    const footerAt = existing.indexOf(PEAKS_GITIGNORE_FOOTER, start + PEAKS_GITIGNORE_HEADER.length);
    if (footerAt === -1) return;
    const end = footerAt + PEAKS_GITIGNORE_FOOTER.length;
    const currentBlock = existing.slice(start, end);
    const nextBlock = PEAKS_GITIGNORE_SNIPPET.trimEnd();
    if (currentBlock === nextBlock) return;
    await writeFile(gitignorePath, existing.slice(0, start) + nextBlock + existing.slice(end), 'utf8');
    return;
  }

  const separator = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  const next = existing + separator + (existing.length > 0 ? '\n' : '') + PEAKS_GITIGNORE_SNIPPET;
  await writeFile(gitignorePath, next, 'utf8');
}
