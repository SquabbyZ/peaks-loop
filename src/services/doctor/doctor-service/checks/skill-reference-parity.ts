/**
 * Check: canonical-store vs IDE skill-tree parity
 * (`skills:reference-parity:<ide>:<skill>`).
 *
 * The reported host shape: `~/.peaks/skills/peaks-code/references/fast-lane-norm.md`
 * exists while `~/.claude/skills/peaks-code/references/fast-lane-norm.md` does
 * not. `peaks skill sync` closes that gap, but nothing named it first, so the
 * missing reference surfaced only when a skill's prose cited it.
 *
 * Read-only: the check lists both trees and reports the difference. It never
 * repairs, rewrites, or deletes. A mismatch is a warning — a skill missing one
 * reference still runs — and the message names the LLM-run repair.
 *
 * IT ALWAYS EMITS A ROW. A check that stays silent when it finds nothing
 * cannot be told apart from one that never ran, so this one says "clean" out
 * loud: `skills:reference-parity:store` with `ok: true` when every tree is in
 * parity, or when there was nothing to compare. The SAME id goes red when
 * the store could not be compared at all (absent or unreadable).
 *
 * The canonical store is the anchor: only skills present under
 * `<PEAKS_HOME or ~/.peaks>/skills` are compared, so a user-authored skill that
 * exists only in an IDE root is not reported as drift.
 *
 * Symlinks are followed (`statSync`, not `lstatSync`), so the common junction
 * install compares equal; a real copy whose file set drifted is the case this
 * check exists for. Each directory is visited once by resolved path, so a
 * junction cycle cannot invent phantom paths.
 */

import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { getAdapter, listAdapterIds } from '../../../ide/ide-registry.js';
import type { DoctorCheck, DoctorCheckPlugin, DoctorContext } from '../types.js';

/** One (IDE, skill) pair whose file set differs from the canonical store. */
type SkillParityIssue = {
  ide: string;
  skill: string;
  missing: string[];
  extra: string[];
};

const MANAGED_MARKER_SUFFIX = '.peaks-managed';
/** Atomic-write scratch names the canonical store leaves behind; never assets. */
const TEMP_ENTRY_PREFIX = '.peaks-tmp-';
/** Secondary bound: a legitimate skill tree is shallow. */
const MAX_DEPTH = 24;
/** How many paths the message names per side, so a large drift stays readable. */
const REPORT_LIMIT = 3;
const REPAIR_HINT = 'Ask the LLM to run `peaks skill sync`';

/** Walk state: the tree root, the files collected so far, and the dirs seen. */
type SkillTreeWalk = {
  root: string;
  into: Set<string>;
  visited: Set<string>;
};

function listRelativeFiles(root: string): Set<string> {
  const walk: SkillTreeWalk = { root, into: new Set<string>(), visited: new Set<string>() };
  collectFiles(walk, '', 0);
  return walk.into;
}

function collectFiles(walk: SkillTreeWalk, prefix: string, depth: number): void {
  if (depth > MAX_DEPTH) return;
  const directory = prefix === '' ? walk.root : join(walk.root, prefix);
  let identity: string;
  try {
    identity = realpathSync(directory);
  } catch {
    // An unreadable directory contributes no comparable files.
    return;
  }
  if (walk.visited.has(identity)) return;
  walk.visited.add(identity);
  for (const name of readEntryNames(directory).sort()) {
    if (isIgnoredEntryName(name)) continue;
    const relativePath = prefix === '' ? name : `${prefix}/${name}`;
    const kind = entryKind(join(walk.root, relativePath));
    if (kind === 'directory') {
      collectFiles(walk, relativePath, depth + 1);
    } else if (kind === 'file') {
      walk.into.add(relativePath);
    }
  }
}

/** Names directly under `directory`; an unreadable directory has none. */
function readEntryNames(directory: string): string[] {
  try {
    return readdirSync(directory);
  } catch {
    return [];
  }
}

/** `.`/`..`, managed sidecars and scratch siblings are not skill assets. */
function isIgnoredEntryName(name: string): boolean {
  return (
    name === '.' ||
    name === '..' ||
    name.endsWith(MANAGED_MARKER_SUFFIX) ||
    name.startsWith(TEMP_ENTRY_PREFIX)
  );
}

/** What `absolutePath` is, following symlinks; an unreadable entry is `other`. */
function entryKind(absolutePath: string): 'directory' | 'file' | 'other' {
  try {
    const stats = statSync(absolutePath);
    if (stats.isDirectory()) return 'directory';
    return stats.isFile() ? 'file' : 'other';
  } catch {
    // A dangling link or an unreadable entry is not a comparable file.
    return 'other';
  }
}

/** Skill names under `root` (directories only, symlinks followed). */
function listSkillNames(root: string): string[] {
  const skills: string[] = [];
  for (const name of readEntryNames(root).sort()) {
    if (isIgnoredEntryName(name)) continue;
    if (entryKind(join(root, name)) === 'directory') skills.push(name);
  }
  return skills;
}

/**
 * Why the canonical store cannot be compared, or null when it is a readable
 * directory. An absent path is handled separately (a fresh host is not a
 * finding); an existing but unusable path is, because it would otherwise look
 * exactly like "no drift".
 */
function storeProblem(canonicalRoot: string): string | null {
  let kind: 'directory' | 'file' | 'other';
  try {
    const stats = statSync(canonicalRoot);
    kind = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
  } catch {
    return 'cannot be read';
  }
  if (kind !== 'directory') return 'is not a directory';
  try {
    readdirSync(canonicalRoot);
  } catch {
    return 'is not readable';
  }
  return null;
}

function diffSkillTrees(
  ide: string,
  skill: string,
  canonicalFiles: ReadonlySet<string>,
  ideFiles: ReadonlySet<string>
): SkillParityIssue | null {
  const missing = [...canonicalFiles].filter((path) => !ideFiles.has(path)).sort();
  const extra = [...ideFiles].filter((path) => !canonicalFiles.has(path)).sort();
  if (missing.length === 0 && extra.length === 0) return null;
  return { ide, skill, missing, extra };
}

function summarize(paths: readonly string[]): string {
  const shown = paths.slice(0, REPORT_LIMIT).join(', ');
  const rest = paths.length - REPORT_LIMIT;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/**
 * Keep a filesystem-derived name inside the check-id schema's id alphabet.
 * The message keeps the real name; only the id is normalised, because the
 * doctor's own `doctor-self:check-id-pattern` check fails the report on an id
 * the schema cannot match.
 */
function toIdSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '-');
  return /^[A-Za-z0-9]/.test(cleaned) ? cleaned : `s-${cleaned}`;
}

function toCheck(issue: SkillParityIssue, canonicalRoot: string): DoctorCheck {
  const parts = [
    `Skill ${issue.skill} under IDE ${issue.ide} diverges from the canonical store at ${canonicalRoot}`
  ];
  if (issue.missing.length > 0) parts.push(`missing: ${summarize(issue.missing)}`);
  if (issue.extra.length > 0) parts.push(`extra: ${summarize(issue.extra)}`);
  return {
    id: `skills:reference-parity:${toIdSegment(issue.ide)}:${toIdSegment(issue.skill)}`,
    ok: false,
    severity: 'warning',
    message: `${parts.join('; ')}. ${REPAIR_HINT}.`
  };
}

/** The store-level RED row: one id and one severity for both failure arms. */
function storeWarningRow(message: string): DoctorCheck {
  return { id: 'skills:reference-parity:store', ok: false, severity: 'warning', message };
}

/**
 * The store-level RED row when the canonical store cannot be compared, or null
 * when it can: both failure arms share one id and one `severity: 'warning'`.
 */
function storeFailureRow(canonicalRoot: string): DoctorCheck | null {
  if (!existsSync(canonicalRoot)) {
    return storeWarningRow(
      `Canonical skill store not found at ${canonicalRoot}; IDE skill roots were not compared`
    );
  }
  const problem = storeProblem(canonicalRoot);
  if (problem === null) return null;
  return storeWarningRow(
    `Canonical skill store at ${canonicalRoot} ${problem}; IDE skill roots were not compared`
  );
}

/** The divergence rows for every IDE skill root, or the GREEN store row. */
function compareIdeSkillTrees(
  canonicalRoot: string,
  ideRoots: ReadonlyArray<{ ide: string; skillsDir: string }>
): DoctorCheck[] {
  const canonicalSkills = new Map<string, Set<string>>();
  for (const skill of listSkillNames(canonicalRoot)) {
    canonicalSkills.set(skill, listRelativeFiles(join(canonicalRoot, skill)));
  }

  const checks: DoctorCheck[] = [];
  let compared = 0;
  for (const { ide, skillsDir } of ideRoots) {
    if (!existsSync(skillsDir)) continue;
    for (const [skill, files] of canonicalSkills) {
      compared += 1;
      const issue = diffSkillTrees(ide, skill, files, listRelativeFiles(join(skillsDir, skill)));
      if (issue !== null) checks.push(toCheck(issue, canonicalRoot));
    }
  }
  if (checks.length > 0) return checks;
  const clean =
    compared === 0
      ? `No skill tree to compare with the canonical store at ${canonicalRoot}; nothing to compare`
      : `Every IDE skill tree is in parity with the canonical store at ${canonicalRoot} (${compared} skill trees compared)`;
  return [{ id: 'skills:reference-parity:store', ok: true, message: clean }];
}

/**
 * Pure comparator. `canonicalRoot` is the canonical skills store
 * (`<PEAKS_HOME or ~/.peaks>/skills`); `ideRoots` are the IDE-side skills
 * directories to compare against it. Roots that do not exist are skipped, so
 * the wrapper may pass every adapter that declares `skillInstall`.
 *
 * IT ALWAYS EMITS A ROW. The store-level row `skills:reference-parity:store`
 * has FOUR outcomes: GREEN in parity (the comparison ran and every tree
 * matched), GREEN with nothing to compare (no IDE skill root exists), RED
 * when the store is absent, and RED when the store is not a readable
 * directory. A diverging tree reports its own `<ide>:<skill>` row instead.
 */
export function compareSkillReferenceParity(
  canonicalRoot: string,
  ideRoots: ReadonlyArray<{ ide: string; skillsDir: string }>
): DoctorCheck[] {
  const failure = storeFailureRow(canonicalRoot);
  if (failure !== null) return [failure];
  return compareIdeSkillTrees(canonicalRoot, ideRoots);
}

function canonicalSkillsStore(): string {
  const home = process.env.PEAKS_HOME?.trim();
  const root = home !== undefined && home.length > 0 ? home : join(homedir(), '.peaks');
  return join(root, 'skills');
}

/** IDE skills dirs from the adapter registry, existing roots only. */
function existingIdeSkillRoots(): Array<{ ide: string; skillsDir: string }> {
  const roots: Array<{ ide: string; skillsDir: string }> = [];
  for (const ide of listAdapterIds()) {
    const skillsDir = getAdapter(ide).skillInstall?.skillsDir;
    if (skillsDir === undefined || !existsSync(skillsDir)) continue;
    roots.push({ ide, skillsDir });
  }
  return roots;
}

function run(context: DoctorContext): readonly DoctorCheck[] {
  const injected = context.options.skillParity;
  if (injected !== undefined) {
    return compareSkillReferenceParity(injected.canonicalRoot, injected.ideRoots);
  }
  return compareSkillReferenceParity(canonicalSkillsStore(), existingIdeSkillRoots());
}

export const check: DoctorCheckPlugin = {
  name: 'skill-reference-parity',
  run
};
