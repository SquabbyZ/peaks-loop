/**
 * `src/services/standards/standards-files.ts`
 *
 * The file-level operations of the standards writer.
 *
 * They live here rather than in `project-standards-service.ts` because that
 * file is already over the repo's file-size cap, and every line added to an
 * over-cap file raises the whole-tree excess-lines ratchet. The rule the
 * repo follows is "the cap is a permission, not a target" — a new concern
 * goes into a new module until the big one is split.
 */
import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

import type { ConstitutionFileUpdate } from './standards-constitution.js';
import type { StandardsWriteStatus } from './project-standards-service.js';

/**
 * The mode a newly created standards file is written with.
 *
 * Owner-only: the files are project instruction bodies, not world-readable
 * artefacts, and the mode is spelled once so the number is not a literal at
 * the call site.
 */
const NEW_FILE_MODE = 0o600;

/**
 * Create a file that must not exist yet.
 *
 * `O_EXCL` is the guard: the write fails if the file appeared between the
 * plan and the write, so a hand-written `CLAUDE.md` / `AGENTS.md` is never
 * clobbered. `O_NOFOLLOW` refuses to write through a symlink.
 */
export function writeNewFile(path: string, content: string): void {
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    NEW_FILE_MODE
  );
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/** Append to a file that already exists, refusing to follow a symlink. */
export function appendExistingFile(path: string, content: string): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW);
  try {
    writeFileSync(fd, content, 'utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Apply ONE constitution file's plan: create it when absent, append the
 * managed block when it has none, leave it alone otherwise.
 *
 * The `prevalidate` callback is the caller's write-target guard — it lives
 * with the other containment checks, and this module does not need to know
 * what they are.
 */
export function applyConstitutionFile(input: {
  readonly file: ConstitutionFileUpdate;
  readonly writtenFiles: string[];
  readonly appendedFiles: string[];
  readonly prevalidate: (file: ConstitutionFileUpdate) => void;
}): StandardsWriteStatus {
  input.prevalidate(input.file);
  const targetPath = resolve(input.file.filePath);
  if (input.file.status === 'planned') {
    writeNewFile(targetPath, input.file.content);
    input.writtenFiles.push(input.file.relativePath);
    return 'written';
  }
  if (input.file.status === 'appended') {
    appendExistingFile(targetPath, input.file.appendBlock);
    input.appendedFiles.push(input.file.relativePath);
  }
  return input.file.status;
}

/** The marker a 2.x pointer file carries. */
const POINTER_MARKER = 'Canonical peaks-loop 2.0 rules live at:';

/**
 * Is this file a 1.x rules file — real content, not a 2-line pointer?
 *
 * An unreadable file counts as "not thick": the probe reports what it can
 * prove, not what it failed to read.
 */
function isThickRulesFile(entryPath: string, entry: string): boolean {
  if (!entry.endsWith('.md')) return false;
  try {
    return !readFileSync(entryPath, 'utf8').includes(POINTER_MARKER);
  } catch {
    return false;
  }
}

/**
 * Detect whether the consumer project still carries a 1.x "thick"
 * `.claude/rules/` tree (the legacy layout that 2.0 migrates away
 * from). A project with thick 1.x rules should NOT be silently
 * re-initialised into the 2.0 `.peaks/standards/` layout; the
 * caller should explicitly run `peaks standards migrate --from-claude-rules`
 * instead. A new project (no `.claude/rules/` tree, or only a
 * previously-thinned 2-line-pointer tree) is safe to bootstrap
 * directly into the 2.0 canonical layout.
 */
export function hasThickOneXClaudeRules(projectRoot: string): boolean {
  const claudeRulesDir = join(projectRoot, '.claude', 'rules');
  if (!existsSync(claudeRulesDir)) return false;
  if (!lstatSync(claudeRulesDir).isDirectory()) return false;
  // Walk one level deep; if any .md file under common/ or
  // typescript/ (or the language pack) exists and is NOT a
  // 2-line pointer, treat the tree as thick 1.x.
  const stack: string[] = [claudeRulesDir];
  let dir = stack.pop();
  while (dir !== undefined) {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      const entryPath = join(dir, entry);
      let entryStat;
      try {
        entryStat = lstatSync(entryPath);
      } catch {
        continue;
      }
      if (entryStat.isDirectory()) {
        stack.push(entryPath);
      } else if (isThickRulesFile(entryPath, entry)) {
        return true;
      }
    }
    dir = stack.pop();
  }
  return false;
}
