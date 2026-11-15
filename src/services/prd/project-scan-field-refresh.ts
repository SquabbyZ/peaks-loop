/**
 * Machine-field refresh for `.peaks/project-scan/project-scan.md`.
 *
 * WHY THIS MODULE EXISTS. The bootstrap wrote the file once and skipped it
 * forever after (`schemaVersion: 1` on disk => `skipped: true`), so
 * `libraryVersions` froze at the versions present on install day. The file is a
 * CONSUMER CONTRACT — peaks-rd reads `## Library versions` and cross-checks it
 * against `schemas/library-breaking-changes.data.json`, and the file is
 * declared as Gate C evidence — so a frozen map makes that breaking-change gate
 * pass on stale input.
 *
 * WHAT A REFRESH MAY TOUCH. Exactly three frontmatter fields: `capturedAt`,
 * `techStack`, `libraryVersions`. Everything else — `architecture`,
 * `karpathySelfCheck`, key order, comments, and the whole markdown body — is
 * hand-authored sediment and is preserved. That is why this is a TEXT SURGERY
 * over the existing frontmatter and not a re-serialisation: the file's owner
 * wrote prose (a vitest pin note, a c8 removal note, a workspace-package table)
 * that a regeneration would destroy.
 *
 * The surgery replaces each managed `key: value` SOURCE SPAN, read from the yaml
 * AST. The span ENDS AT THE VALUE (`pair.value.range[1]`), not at the line break
 * — a trailing `# note` and the line ending are copied through untouched. A
 * trailing line break the old span consumed is re-emitted, so the file's own line
 * structure survives. Nothing outside those spans is rewritten.
 *
 * One thing a refresh does NOT do: it never writes markdown prose. The
 * `## Tech stack` and `## Library versions` TABLES in the body are the create
 * path's projection and go stale relative to the frontmatter above them. The
 * frontmatter is the machine-read copy; the tables are human-facing and are left
 * exactly as their author left them.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isMap, isNode, isPair, isScalar, parseDocument, stringify, type YAMLMap } from 'yaml';

import { scanLibraries } from '../scan/libraries-service.js';
import { refreshLibraryVersionsTable, refreshTechStackTable } from './project-scan-body-tables.js';
import { isUnpopulatedProjectScan, readTechStack } from './project-scan-existing-state.js';
import { splitFrontmatter } from './project-scan-frontmatter.js';
import { libraryVersionsFor } from './project-scan-library-versions.js';
import { deriveTechStack, mergeTechStack } from './project-scan-techstack.js';

/** The three frontmatter fields a refresh is allowed to rewrite, in file order. */
const MANAGED_KEYS = ['capturedAt', 'techStack', 'libraryVersions'] as const;

type ManagedKey = (typeof MANAGED_KEYS)[number];

/** One YAML nesting level, as the block-form renderer indents it. */
const INDENT = '  ';

export type MachineFields = {
  readonly capturedAt: string;
  readonly techStack: Readonly<Record<string, string>>;
  readonly libraryVersions: Readonly<Record<string, string>>;
};

export type RefreshResult =
  | { readonly ok: true; readonly content: string }
  | { readonly ok: false; readonly reason: 'frontmatter-unparseable' };

/** What the on-disk refresh decided, in the words the envelope uses. */
export type RefreshOutcome = {
  readonly skipped: boolean;
  readonly refreshed: boolean;
  readonly warning?: string;
};

/** A scalar as it must appear after `key: `. */
function renderFrontmatterScalar(value: string): string {
  return stringify(value).trimEnd();
}

/**
 * A complete `key: value` field, in the form the frontmatter uses: a scalar or
 * an empty map stays inline (`key: value`, `key: {}`), a populated map goes to
 * BLOCK form (`key:\n  nested: value`). A populated map cannot be written
 * inline here without the `{` the old create path hard-coded, and
 * `key: a: b` is not YAML at all — which is why this is one function rather
 * than a string template at each call site.
 */
export function renderFrontmatterField(
  key: string,
  value: string | Readonly<Record<string, string>>
): string {
  if (typeof value === 'string') return `${key}: ${renderFrontmatterScalar(value)}`;
  const entries = Object.entries(value);
  if (entries.length === 0) return `${key}: {}`;
  const block = stringify(value, { lineWidth: 0 })
    .trimEnd()
    .split('\n')
    .map((line) => `${INDENT}${line}`)
    .join('\n');
  return `${key}:\n${block}`;
}

function renderManagedField(key: ManagedKey, fields: MachineFields): string {
  switch (key) {
    case 'capturedAt':
      return renderFrontmatterField(key, fields.capturedAt);
    case 'techStack':
      return renderFrontmatterField(key, fields.techStack);
    case 'libraryVersions':
      return renderFrontmatterField(key, fields.libraryVersions);
  }
}

/** One in-place replacement in the frontmatter text. */
type Edit = { readonly start: number; readonly end: number; readonly text: string };

/**
 * The one edit that rewrites `key`, or `null` when the key is absent from the
 * frontmatter (the caller then appends it). A key that is present but has no
 * usable source range is reported as `broken`, never guessed at.
 */
function editFor(
  doc: YAMLMap<unknown, unknown>,
  key: ManagedKey,
  fields: MachineFields,
  frontmatter: string
): { readonly edit: Edit } | { readonly absent: true } | { readonly broken: true } {
  const pair = doc.items.find(
    (item) => isPair(item) && isScalar(item.key) && item.key.value === key
  );
  if (!isPair(pair) || !isScalar(pair.key)) return { absent: true };
  const start = pair.key.range?.[0];
  // `range[1]` is the VALUE end; `range[2]` also swallows a trailing comment
  // (`key: value  # note`) and the line break. Ending at the value leaves both
  // in place, so a note a human attached to a managed field survives.
  const end = isNode(pair.value) ? pair.value.range?.[1] : undefined;
  if (start === undefined || end === undefined) return { broken: true };
  const keepsBreak = frontmatter[end - 1] === '\n';
  const text = renderManagedField(key, fields);
  return { edit: { start, end, text: keepsBreak ? `${text}\n` : text } };
}

/**
 * Rewrite the three managed frontmatter fields of `content`, preserving every
 * other byte. Returns `ok: false` when the frontmatter cannot be parsed — the
 * caller then leaves the file untouched, because a file this function cannot
 * read is one whose prose must not be risked.
 */
export function refreshProjectScanFields(content: string, fields: MachineFields): RefreshResult {
  const split = splitFrontmatter(content);
  if (split === null) return { ok: false, reason: 'frontmatter-unparseable' };
  const { frontmatter } = split;
  const doc = parseDocument(frontmatter);
  if (doc.errors.length > 0 || !isMap(doc.contents)) {
    return { ok: false, reason: 'frontmatter-unparseable' };
  }

  const edits: Edit[] = [];
  const appended: string[] = [];
  for (const key of MANAGED_KEYS) {
    const result = editFor(doc.contents, key, fields, frontmatter);
    if ('broken' in result) return { ok: false, reason: 'frontmatter-unparseable' };
    if ('absent' in result) appended.push(renderManagedField(key, fields));
    else edits.push(result.edit);
  }

  // Descending start order, so an earlier replacement cannot shift a later one.
  const updated = [...edits]
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, edit) => text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      frontmatter
    );
  const withAppended = appended.length === 0 ? updated : `${updated}\n${appended.join('\n')}`;
  const emitted = split.crlf ? withAppended.replace(/\n/g, '\r\n') : withAppended;
  const fenceBreak = split.crlf ? '\r\n' : '\n';

  return {
    ok: true,
    content: `---${fenceBreak}${emitted}${fenceBreak}---${content.slice(split.bodyStart)}`
  };
}

/**
 * Read the file. An IO failure is reported, never thrown and never swallowed.
 *
 * WHY NOT THROW. This runs on the DEFAULT path of `peaks project context`, which
 * is an everyday command: a locked or permission-denied file would turn a
 * refresh nobody asked for into a failed command with exit 1. It must not vanish
 * either — a read that failed is not "nothing to refresh" — so the failure comes
 * back as a `warning` the caller puts in its envelope.
 */
function readExisting(
  absPath: string
): { ok: true; existing: string } | { ok: false; warning: string } {
  try {
    return { ok: true, existing: readFileSync(absPath, 'utf8') };
  } catch (error) {
    return {
      ok: false,
      warning:
        `project-scan.md could not be read (${(error as Error).message}), so its machine ` +
        'fields were left unrefreshed — the rest of the file was not touched.'
    };
  }
}

/**
 * Refresh an existing `project-scan.md` in place — or report why it was not
 * touched. `requested` is the caller's explicit ask.
 *
 * `zeroToOne` no longer short-circuits the whole call. A project that was 0-1 on
 * install day holds the placeholder, and when it later gains a manifest + source
 * files the placeholder is STALE, not truthful — skipping here left it holding
 * `architecture: ""` forever, because no later run would ever enter this branch
 * again. What `zeroToOne` still suppresses is the meaningless work: there is no
 * stack to derive while the project has no manifest or no source files, so the
 * refresh declines without scanning. An UNPOPULATED shell is never suppressed by
 * it — that is the file the transition needs filled.
 *
 * The file is written only when its content actually changed, so a repeated run
 * on an unchanged project leaves the mtime alone.
 */
export async function refreshProjectScanOnDisk(args: {
  readonly absolutePath: string;
  readonly projectRoot: string;
  readonly zeroToOne: boolean;
  readonly requested: boolean;
}): Promise<RefreshOutcome> {
  const read = readExisting(args.absolutePath);
  if (!read.ok) {
    return { skipped: true, refreshed: false, warning: read.warning };
  }
  const { existing } = read;
  // A still-0-1 project's placeholder is truthful, not stale, so it is left alone.
  // `zeroToOne` is recomputed from the CURRENT tree on every call, so a project
  // that later gains a manifest and source files arrives here with `false` and is
  // refreshed normally — the placeholder does not survive the transition.
  //
  // What a refresh does NOT do is fill `architecture`: that field is prose, and
  // the shell's `""` stays empty until someone writes it. The three machine
  // fields this module owns are filled on the first post-transition run.
  if (args.zeroToOne) return { skipped: true, refreshed: false };
  // No explicit ask (`peaks workspace init`'s path): a populated scan is
  // sediment and is left alone. An UNPOPULATED shell is the exception — it holds
  // no prose worth protecting, so the installed base of such files is repaired
  // without anyone having to ask.
  if (!args.requested && !isUnpopulatedProjectScan(existing)) {
    return { skipped: true, refreshed: false };
  }

  const scanned = (await scanLibraries({ projectRoot: args.projectRoot })).libraries;
  const techStack = mergeTechStack(readTechStack(existing), deriveTechStack(args.projectRoot));
  const libraryVersions = libraryVersionsFor(args.projectRoot, scanned);
  const result = refreshProjectScanFields(existing, {
    capturedAt: new Date().toISOString(),
    techStack,
    libraryVersions
  });
  if (!result.ok) {
    return {
      skipped: true,
      refreshed: false,
      warning:
        'project-scan.md frontmatter could not be parsed, so its machine fields were left ' +
        'unrefreshed — the rest of the file was not touched.'
    };
  }
  const withTables = refreshTechStackTable(
    refreshLibraryVersionsTable(result.content, libraryVersions),
    techStack
  );
  if (withTables !== existing) writeFileSync(args.absolutePath, withTables, 'utf8');
  return { skipped: false, refreshed: true };
}
