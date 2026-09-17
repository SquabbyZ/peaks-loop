// src/services/codegraph/codegraph-config-repair-writer.ts
//
// The pure repair plans (`repairCodegraphExclude` for the exclude axis,
// `repairCodegraphInclude` for the include axis) and the writer that applies
// them to `<projectRoot>/.codegraph/config.json` in ONE atomic rewrite, plus
// the byte-exact `config.json.bak` copy it keeps for rollback and
// `rollbackCodegraphConfig`, that copy's reader (slice A1 of
// `2026-09-17-session-607ead`: the reverse write, so the rollback the `.bak`
// has always promised is reachable).
//
// Extracted verbatim from `codegraph-exclude-repair.ts` (rid
// 2026-09-17-oversize-followup, G1 — the 800-line file-size cap). Every moved
// line is byte-identical and no behaviour changed; `codegraph-exclude-repair.ts`
// re-exports this module's public surface, so every existing import site
// (`applyCodegraphConfigRepair`, `repairCodegraphExclude`,
// `repairCodegraphInclude`, `CODEGRAPH_CONFIG_BACKUP_SUFFIX`, and the three
// plan/outcome types) keeps working unchanged.
//
// The dependency edge is ONE-WAY and must stay that way: this module must not
// import `codegraph-exclude-repair.ts`, which imports this one.

import { randomBytes } from 'node:crypto';
import { chmodSync, lstatSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertStringArray, CODEGRAPH_CONFIG_FILENAME } from './codegraph-exclude-reconciler.js';
import { assertCodegraphDirContained, CODEGRAPH_DIR_NAME } from './codegraph-service.js';

/** Suffix of the byte-exact pre-repair copy kept next to the config. */
export const CODEGRAPH_CONFIG_BACKUP_SUFFIX = '.bak';

// ─────────────────────────────────────────────────────────────────────
// Pure plans
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeRepairPlan = {
  /** True when at least one rule would actually be dropped. */
  readonly changed: boolean;
  /** The `exclude` array after the removal. */
  readonly exclude: readonly string[];
  /** Rules actually present in `exclude` and dropped, in config order. */
  readonly removedRules: readonly string[];
};

/**
 * Pure: given the current `exclude` list and the rules to drop, return
 * the new list. No fs, no clock, no serialization.
 *
 * A rule named in `rulesToRemove` but absent from `exclude` is NOT
 * invented — the result is a subset of the input, so a caller can
 * never add a rule by accident. Removing an already-absent rule is a
 * no-op, which is what makes the whole repair idempotent: feeding the
 * repaired list back in yields `changed: false`.
 */
export function repairCodegraphExclude(input: {
  readonly exclude: readonly string[];
  readonly rulesToRemove: readonly string[];
}): CodegraphExcludeRepairPlan {
  const removable = new Set(input.rulesToRemove);
  // De-duplicated, order-preserving. A config that lists the same rule
  // twice would otherwise be counted twice here, and this array is what
  // the caller reports to the user as "rules removed".
  const removedRules = [...new Set(input.exclude.filter((rule) => removable.has(rule)))];

  if (removedRules.length === 0) {
    return { changed: false, exclude: input.exclude, removedRules: [] };
  }

  return {
    changed: true,
    exclude: input.exclude.filter((rule) => !removable.has(rule)),
    removedRules
  };
}

/**
 * Pure: given the current `include` list and the patterns to append, return
 * the new list. The mirror of `repairCodegraphExclude`, in the other
 * direction — a SUPERSET operation instead of a subset one.
 *
 * A pattern already present is not appended twice: the include reconciler
 * already guarantees that, but this function is the writer's own last line
 * of defence, and a duplicated glob in a third-party config would be a
 * visible defect even though it changes no matching behaviour.
 */
export function repairCodegraphInclude(input: {
  readonly include: readonly string[];
  readonly patternsToAdd: readonly string[];
}): {
  readonly changed: boolean;
  readonly include: readonly string[];
  readonly addedPatterns: readonly string[];
} {
  const existing = new Set(input.include);
  const additions = input.patternsToAdd.filter((pattern) => !existing.has(pattern));

  if (additions.length === 0) {
    return { changed: false, include: input.include, addedPatterns: [] };
  }

  return { changed: true, include: [...input.include, ...additions], addedPatterns: additions };
}

// ─────────────────────────────────────────────────────────────────────
// Writer
// ─────────────────────────────────────────────────────────────────────

export type CodegraphConfigRepairPlan = {
  /** Rules from the exclude reconciler to drop. */
  readonly rulesToRemove: readonly string[];
  /** Patterns from the include reconciler to append. */
  readonly includePatternsToAdd: readonly string[];
};

export type CodegraphConfigRepairOutcome =
  | {
      readonly applied: false;
      readonly reason: 'nothing-to-repair';
      readonly removedRules: readonly string[];
      readonly addedIncludePatterns: readonly string[];
    }
  | {
      readonly applied: true;
      readonly configPath: string;
      readonly backupPath: string;
      readonly removedRules: readonly string[];
      readonly addedIncludePatterns: readonly string[];
      readonly excludeCountBefore: number;
      readonly excludeCountAfter: number;
      readonly includeCountBefore: number;
      readonly includeCountAfter: number;
    };

/**
 * Detect the indentation the config already uses so the rewrite keeps
 * the file's shape instead of reformatting a third-party tool's file.
 *
 * A single-line (minified) config has no indentation to copy: `0` tells
 * `JSON.stringify` to emit compact JSON, so the file comes back as the
 * one-liner it went in as. `0` is NOT the same as "not set" here — an
 * omitted indent would also be compact, but returning a number keeps the
 * intent explicit at the call site.
 *
 * Falls back to two spaces when the file spans lines but has no indented
 * member.
 */
function detectIndent(text: string): string | number {
  if (!text.trimEnd().includes('\n')) {
    return 0;
  }
  const match = /\n([ \t]+)"/.exec(text);
  return match?.[1] ?? 2;
}

function serializeConfig(config: Record<string, unknown>, originalText: string): string {
  const body = JSON.stringify(config, null, detectIndent(originalText));
  return originalText.endsWith('\n') ? `${body}\n` : body;
}

/**
 * Write `content` to `filePath` atomically: same-directory temp file,
 * then `renameSync` over the target.
 *
 * The file being written belongs to a THIRD-PARTY tool, so a crash or a
 * full disk mid-`writeFileSync` must never leave a half-written config
 * behind. `rename` within one directory is atomic, so a reader sees
 * either the old bytes or the new ones, never a prefix of the new ones.
 * The temp file lives next to the target (same directory ⇒ same
 * filesystem ⇒ the rename cannot degrade to a cross-device copy) and is
 * removed if the write or the rename fails.
 *
 * N5: the temp name carries the pid plus 6 random bytes. A FIXED
 * `${filePath}.tmp` is single-writer only, and this writer has three
 * reachable concurrent callers — a fresh `peaks codegraph init` (which
 * repairs then indexes), the pre-dispatch preflight, and the post-slice
 * autorefresh. Two overlapping writers sharing one temp name let one
 * `renameSync` publish a file the other was still writing, which is
 * exactly the half-written config the temp file exists to prevent. The
 * suffix keeps the temp in the SAME directory, so the rename stays
 * within one filesystem and therefore stays atomic.
 */
function writeConfigAtomic(filePath: string, content: string, mode?: number): void {
  const tempPath = `${filePath}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tempPath, content, 'utf8');
    if (mode !== undefined) {
      // The mode is applied to the TEMP, before the rename, so the
      // published file has it in the same atomic step — a `chmod` after
      // the rename would leave a window in which the file exists at the
      // process umask instead of the original's mode.
      chmodSync(tempPath, mode);
      // Windows cannot REPLACE a read-only destination: `renameSync` over
      // one throws EPERM (measured, `2026-09-17-codegraph-msg-and-refresh`).
      // The only destination this branch ever sees read-only is this
      // writer's own previous `.bak`, which under A4 carries the original
      // config's mode — so a read-only config would make the SECOND repair
      // fail at the rename. Clear the bit and let the rename plus the mode
      // above put it back. A destination that is not a regular file is left
      // alone: `writeConfigBackup`'s link/directory guard has already
      // refused those before this function is reached.
      const existing = lstatSync(filePath, { throwIfNoEntry: false });
      if (existing !== undefined && existing.isFile() && (existing.mode & 0o200) === 0) {
        chmodSync(filePath, existing.mode | 0o200);
      }
    }
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * The shared shape of the two refusals this module makes at the FIXED,
 * therefore guessable, `config.json.bak` path: a symbolic link (bytes land in
 * whatever it points at), a directory (there is nowhere for them to land), or
 * a hard link (`nlink > 1` — another name shares this inode). Returns `null`
 * when the path is absent or is a plain regular file, the only two states both
 * ends of the rollback contract may act on.
 *
 * ONE predicate, two callers, and that is the point: `writeConfigBackup`
 * WRITES this copy and `rollbackCodegraphConfig` READS it back. A guard that
 * drifted between the two would leave the rollback trusting a path the writer
 * would have refused, so the refusal is the same at both ends because the
 * trust premise is the same at both ends.
 *
 * `lstat`, never `stat`: `stat` follows a link and reports the victim's
 * regular-file type, which is exactly the case both callers must refuse.
 */
function linkOrDirectoryAt(
  path: string
): { readonly preposition: 'at' | 'through'; readonly kind: string } | null {
  const existing = lstatSync(path, { throwIfNoEntry: false });

  if (
    existing === undefined ||
    (!existing.isSymbolicLink() && !existing.isDirectory() && existing.nlink <= 1)
  ) {
    return null;
  }

  return {
    // "through" for a link (the bytes land in whatever it points at), "at" for
    // a directory (there is nowhere for them to land).
    preposition: existing.isDirectory() ? 'at' : 'through',
    kind: existing.isSymbolicLink()
      ? 'a symbolic link'
      : existing.isDirectory()
        ? 'a directory'
        : `a hard link (link count ${String(existing.nlink)})`
  };
}

/**
 * Copy the config's ORIGINAL bytes to `config.json.bak`, refusing to write
 * through a link that already occupies that path.
 *
 * The backup path is FIXED (`<configPath>.bak`) and therefore guessable, and
 * `.codegraph/config.json.bak` is committable in a consumer project. So a
 * repository can ship that path as a link to an arbitrary file of the
 * attacker's choosing plus a `config.json` that merely OMITS an extension —
 * which is the DEFAULT state of every config written before the include axis
 * existed — and any repair-seam run (a fresh `peaks codegraph init`, the
 * pre-dispatch preflight, the post-slice autorefresh, or either explicit
 * repair verb) would write the whole attacker-authored config file through
 * that link. Arbitrary file overwrite, as the invoking user, with no
 * operator action. `writeFileSync`'s default `'w'` flag is
 * `O_WRONLY|O_CREAT|O_TRUNC`: it follows a symlink and it truncates a hard
 * link's shared inode, so it is the wrong primitive here.
 *
 * Two independent refusals, because either one alone leaves a case open:
 *
 *   1. `lstat` (never `stat`) rejects a SYMBOLIC LINK — `stat` would follow
 *      it and report the victim's regular-file type — and a HARD LINK, which
 *      `lstat` cannot distinguish by type but the link count exposes
 *      (`nlink > 1` means another name shares this inode, so writing here
 *      writes to that file too). Both are refusals, not repairs: silently
 *      replacing someone else's link is not this writer's decision to make.
 *   2. The copy goes through `writeConfigAtomic` (CSPRNG temp + `renameSync`),
 *      so even an entry that appears between the `lstat` and the write is
 *      REPLACED rather than written through — `rename` never follows the
 *      destination's link, and it never truncates the destination's inode.
 *      That also makes the backup atomic, which the module header's
 *      byte-exact-rollback promise needs and a bare `writeFileSync` did not
 *      provide.
 *
 * What is NOT refused: a regular file at the backup path with a link count
 * of 1. That is this writer's own previous backup (a project may legitimately
 * drift and be repaired twice), and replacing it atomically is exactly what
 * the `rename` in (2) does. `O_EXCL` alone would have refused that legitimate
 * case along with the attack, which is why the guard is a link test rather
 * than an existence test.
 *
 * `writeFileSync` there is called only after parsing and planning have both
 * succeeded, so a refusal leaves the config BYTES UNTOUCHED — the throw
 * propagates out of `applyCodegraphConfigRepair` before the rewrite.
 *
 * A4 (`2026-09-17-codegraph-msg-and-refresh`, the L1 half left over from
 * slice-002's S1): the copy carries the ORIGINAL CONFIG'S MODE, because the
 * mode is part of what a rollback restores. The `.bak` exists so an operator
 * can put the previous config back with a `mv`, and a restore that hands
 * back a file whose permissions were decided by this process's umask is not
 * a restore: a `0600` config would come back as `0644` — group- and
 * world-readable, a permission the project never granted it.
 *
 * The mode is read with `statSync` on the config (not `lstatSync`, and not
 * from the caller): the caller has just read that file's bytes, so it
 * exists, and a config that is itself a symlink is a case upstream's own
 * reader follows — the permissions that matter are the ones the operator
 * sees on the config.
 *
 * NOT applied to the config rewrite beside it, deliberately: that path
 * (`writeConfigAtomic(configPath, …)` with no mode) keeps the process
 * default, which is what upstream's own `init` produces. Stated rather than
 * left silent — see this batch's RD artifact, section A4.
 */
function writeConfigBackup(configPath: string, originalText: string): string {
  const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
  const occupied = linkOrDirectoryAt(backupPath);

  if (occupied !== null) {
    throw new Error(
      `codegraph config backup ${backupPath}: refusing to write ${occupied.preposition} ${occupied.kind} occupying ` +
        'this path. Another file or directory shares it, so a backup written here would overwrite ' +
        'that. Remove it (or point `peaks` at a project root whose `.codegraph/` it owns) and re-run.'
    );
  }

  // A4: the ORIGINAL config's mode travels with the copy. `& 0o777` drops
  // the file-type bits `statSync` packs above the permission bits — `chmod`
  // takes permission bits only.
  writeConfigAtomic(backupPath, originalText, statSync(configPath).mode & 0o777);

  return backupPath;
}

/**
 * Apply BOTH config repairs to `<projectRoot>/.codegraph/config.json` in one
 * atomic rewrite.
 *
 * No-op (and no write, no mtime change, no backup) when both lists are
 * empty. Otherwise: back up the original bytes to `config.json.bak`, then
 * rewrite the file with `exclude` reduced by exactly the rules that were
 * both requested and present, and `include` extended by exactly the
 * patterns that were both requested and absent.
 *
 * ONE rewrite, not two. A caller that widened `include` in one write and
 * dropped the newly-offending `exclude` rules in a second would leave a
 * window in which the config on disk is worse than it started (the widened
 * include admits a file that a surviving rule then hides from the index),
 * and would need two backups to stay rollback-exact. One rewrite through
 * the same-directory temp file has neither property.
 *
 * Throws only on real fs/parse failures and on the containment refusal
 * above — the caller decides whether that is fatal (`repair-exclude` /
 * `repair-index` → non-zero exit) or a surfaced warning (`init` → keep
 * going, the init itself already succeeded). Both are refusals BEFORE
 * anything is written, so a throw can never half-apply.
 */
export function applyCodegraphConfigRepair(
  projectRoot: string,
  repair: CodegraphConfigRepairPlan
): CodegraphConfigRepairOutcome {
  if (repair.rulesToRemove.length === 0 && repair.includePatternsToAdd.length === 0) {
    return {
      applied: false,
      reason: 'nothing-to-repair',
      removedRules: [],
      addedIncludePatterns: []
    };
  }

  // Containment FIRST — before even reading (S12 / security R1). The `.bak`
  // guard below protects a FILE path; this protects the DIRECTORY it lives
  // in, so `<root>/.codegraph` as a junction cannot redirect the rewrite (or
  // the parsed read) into another project. Called for its refusal only: the
  // write target stays derived from the caller's `projectRoot`, so this
  // verb's canonicalization remains where L2/S5 put it, at the CLI edge.
  assertCodegraphDirContained(projectRoot);

  const configPath = join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME);
  const originalText = readFileSync(configPath, 'utf8');

  const parsed: unknown = JSON.parse(originalText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`codegraph config ${configPath}: expected a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  const exclude = assertStringArray(record.exclude, 'exclude', configPath);

  // An ABSENT `include` key is tolerated, and is NOT the same as a malformed
  // one: this writer predates the include axis and callers exist whose
  // config carries only `exclude` (a hand-written minimal file; the S2
  // hardening fixtures are exactly that). Throwing here would make the
  // whole repair fail — including the exclude half that used to succeed —
  // so the include axis simply has nothing to extend, and the key is never
  // invented. A key that is PRESENT but is not an array of strings is still
  // an error: that is a genuinely malformed config, and silently ignoring it
  // is how a wrong `include` would survive a repair that reported success.
  const include = record.include === undefined ? [] : assertStringArray(record.include, 'include', configPath);

  const excludePlan = repairCodegraphExclude({ exclude, rulesToRemove: repair.rulesToRemove });
  const includePlan = repairCodegraphInclude({ include, patternsToAdd: repair.includePatternsToAdd });

  if (!excludePlan.changed && !includePlan.changed) {
    return {
      applied: false,
      reason: 'nothing-to-repair',
      removedRules: [],
      addedIncludePatterns: []
    };
  }

  const backupPath = writeConfigBackup(configPath, originalText);

  // Spread first, then replace the keys that changed — every other key keeps
  // its original value AND its original position in the serialized object.
  // `include` is only written back when it actually changed, so a config
  // without that key does not gain one from a repair that did not touch it.
  const nextRecord: Record<string, unknown> = { ...record, exclude: excludePlan.exclude };
  if (includePlan.changed) {
    nextRecord.include = includePlan.include;
  }
  writeConfigAtomic(configPath, serializeConfig(nextRecord, originalText));

  return {
    applied: true,
    configPath,
    backupPath,
    removedRules: excludePlan.removedRules,
    // The patterns that ACTUALLY landed (a caller-supplied pattern that was
    // already present is not an addition), so the report cannot overstate
    // what changed on disk.
    addedIncludePatterns: includePlan.addedPatterns,
    excludeCountBefore: exclude.length,
    excludeCountAfter: excludePlan.exclude.length,
    includeCountBefore: include.length,
    includeCountAfter: includePlan.include.length
  };
}

// ─────────────────────────────────────────────────────────────────────
// Rollback — the read side of the `.bak`
// ─────────────────────────────────────────────────────────────────────

/** Local, because this module must not import `codegraph-exclude-repair.ts`. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type CodegraphConfigRollbackResult =
  | {
      readonly rolledBack: true;
      readonly configPath: string;
      readonly backupPath: string;
    }
  | {
      readonly rolledBack: false;
      readonly configPath: string;
      readonly backupPath: string;
      /** Why the rollback did not happen. Never `null` on this arm. */
      readonly error: string;
    };

/**
 * Put `configPath` back to the bytes `writeConfigBackup` saved beside it, and
 * back to the mode those bytes were saved with.
 *
 * This is the reverse of `applyCodegraphConfigRepair`'s write half and the only
 * reason the `.bak` exists: until this function, the backup had no reader
 * anywhere in the repository, so "byte-exact rollback" described a file nobody
 * ever restored.
 *
 * The guard is `linkOrDirectoryAt` — the SAME predicate that refuses to WRITE
 * through a link at the backup path refuses to READ through one here. The
 * attack it closes is the mirror image of the writer's: `config.json.bak` is
 * fixed and committable, so a repository that ships it as a link would
 * otherwise have the link's target's bytes published into `.codegraph/config.json`
 * as if they were the pre-repair config — attacker-chosen content, written
 * under the operator's own config path, from a file the operator never
 * reviewed. A refusal is a refusal and not a repair, at both ends.
 *
 * The restore runs through `writeConfigAtomic` (same-directory CSPRNG temp +
 * `renameSync`) for the same reason the backup write does: a crash mid-write
 * must leave the repaired config intact rather than a prefix of the restored
 * one, and the mode is applied to the TEMP before the rename so the published
 * file never exists at the process umask. The mode comes from `statSync` of the
 * backup, symmetrical with the write end: the copy carries the original
 * config's mode, so handing that mode back to the config restores what the
 * project had granted rather than this process's umask.
 *
 * A refusal, or a backup that cannot be read, is RETURNED rather than thrown:
 * the caller reports it as a field and must keep going — the forced rebuild it
 * was asked for still has to run. `writeConfigAtomic`'s own fs throw is left to
 * propagate, and the caller catches that too.
 */
export async function rollbackCodegraphConfig(
  configPath: string
): Promise<CodegraphConfigRollbackResult> {
  const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;

  const occupied = linkOrDirectoryAt(backupPath);
  if (occupied !== null) {
    return {
      rolledBack: false,
      configPath,
      backupPath,
      error:
        `codegraph config rollback ${backupPath}: refusing to restore ${occupied.preposition} ${occupied.kind} occupying ` +
        'this path. A backup this writer did not create is not a rollback point, and restoring through it ' +
        'would publish bytes nobody reviewed. Restore it by hand and re-run.'
    };
  }

  let originalText: string;
  let originalMode: number;
  try {
    originalText = readFileSync(backupPath, 'utf8');
    // `& 0o777` drops the file-type bits `statSync` packs above the permission
    // bits — `chmod` takes permission bits only.
    originalMode = statSync(backupPath).mode & 0o777;
  } catch (error) {
    return {
      rolledBack: false,
      configPath,
      backupPath,
      error: `codegraph config rollback: cannot read ${backupPath}: ${errorMessage(error)}`
    };
  }

  writeConfigAtomic(configPath, originalText, originalMode);

  return { rolledBack: true, configPath, backupPath };
}
