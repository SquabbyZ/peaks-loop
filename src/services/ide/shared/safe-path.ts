import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative } from 'node:path';

export type HookScope = 'project' | 'global';

/** True iff `childPath` resolves to `parentPath` or any path nested inside it. */
export function isInsidePath(childPath: string, parentPath: string): boolean {
  const rel = relative(parentPath, childPath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/**
 * Reject settings targets that are symlinked or escape the configured root.
 * Used by the hook / statusline / MCP install paths to keep the project root the
 * sole owner of writable settings files.
 */
export function assertSafeSettingsFile(
  scope: HookScope,
  root: string,
  dirName: string,
  settingsFileName: string
): { settingsPath: string } {
  const settingsPath = join(root, dirName, settingsFileName);
  const dirPath = join(root, dirName);
  if (existsSync(dirPath) && lstatSync(dirPath).isSymbolicLink()) {
    throw new Error(`${dirName} directory must not be a symlink`);
  }
  if (existsSync(settingsPath)) {
    if (lstatSync(settingsPath).isSymbolicLink()) {
      throw new Error(`${settingsFileName} must not be a symlink`);
    }
    const realRoot = realpathSync(root);
    if (!isInsidePath(realpathSync(settingsPath), realRoot)) {
      throw new Error(`${settingsFileName} must stay inside the ${scope} root`);
    }
  }
  return { settingsPath };
}

/**
 * True when `path` itself is a link; an ABSENT path is not one. `lstat`, never
 * `stat`: `stat` follows the link and reports the victim's type. ENOENT (the
 * ordinary first write, which must still happen) and EACCES are both `false`.
 */
function pathIsLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * True when the settings file, or the DIRECTORY holding it, is a LINK — a
 * symlink, or a Windows junction, which `lstat` also reports as one.
 *
 * The file-only form of this check could not see a linked directory: the file
 * under it is ordinary, `lstat(file)` says `false`, and every write lands in the
 * link target. `> settingsPath` follows a link, so this is what a writer must
 * ask before it writes.
 *
 * `assertSafeSettingsFile` is the throwing, path-building form of the same
 * question for the install paths; this is the boolean these callers need,
 * because they REPORT a refusal in their result record rather than throw. It
 * also decides the directory with `lstat` alone — `existsSync` follows a link,
 * so a dangling directory link reads as absent there.
 *
 * An ABSENT file or directory answers `false`: that is the first write.
 */
export function isLinkedSettingsFile(settingsPath: string): boolean {
  return pathIsLink(settingsPath) || pathIsLink(dirname(settingsPath));
}
