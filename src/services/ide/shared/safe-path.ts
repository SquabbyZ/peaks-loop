import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

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
