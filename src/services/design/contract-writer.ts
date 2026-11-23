/**
 * Write one design contract file without ever clobbering a user-owned file.
 *
 * A missing file is written. An existing file is left alone unless `force` is
 * set, in which case the old content is copied to `<file>.bak` first, so a
 * forced rewrite stays recoverable.
 *
 * Every write — including the `<file>.bak` copy target — goes through
 * {@link assertSafeDesignWritePath}: a target that is a symlink, or one whose
 * real path resolves outside the project root, is an escape attempt and is
 * refused before anything is read or copied.
 */
import { existsSync, lstatSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { isInsidePath, stablePath } from '../../shared/path-utils.js';

export type WriteDesignContractFileInput = {
  readonly filePath: string;
  readonly content: string;
  readonly force?: boolean | undefined;
  readonly projectRoot: string;
};

export type WriteDesignContractFileResult = {
  readonly written: boolean;
  /** The `.bak` path created by a forced rewrite, or `null`. */
  readonly backupPath: string | null;
};

/**
 * Refuse a write whose target is a symlink or resolves outside `projectRoot`.
 *
 * The containment half uses `stablePath`, so a symlinked ANCESTOR directory
 * (`design/` itself pointing elsewhere) is caught even when the file does not
 * exist yet. The `lstat` half catches a symlinked target — including a dangling
 * one, which `existsSync` would miss because it follows the link.
 */
export function assertSafeDesignWritePath(filePath: string, projectRoot: string): void {
  if (!isInsidePath(stablePath(filePath), stablePath(projectRoot))) {
    throw new Error(`Refusing to write outside the project root: ${filePath}`);
  }
  const stats = lstatSync(filePath, { throwIfNoEntry: false });
  if (stats !== undefined && stats.isSymbolicLink()) {
    throw new Error(`Refusing to write through a symlink: ${filePath}`);
  }
}

export async function writeDesignContractFile(
  input: WriteDesignContractFileInput
): Promise<WriteDesignContractFileResult> {
  assertSafeDesignWritePath(input.filePath, input.projectRoot);
  const present = existsSync(input.filePath);
  if (present && input.force !== true) return { written: false, backupPath: null };

  await mkdir(dirname(input.filePath), { recursive: true });
  let backupPath: string | null = null;
  if (present) {
    backupPath = `${input.filePath}.bak`;
    assertSafeDesignWritePath(backupPath, input.projectRoot);
    await copyFile(input.filePath, backupPath);
  }
  await writeFile(input.filePath, input.content, 'utf8');
  return { written: true, backupPath };
}

/** A machine-owned file (no user content, no backup): guard, then overwrite. */
export async function writeMachineDesignFile(
  filePath: string,
  content: string,
  projectRoot: string
): Promise<void> {
  assertSafeDesignWritePath(filePath, projectRoot);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content, 'utf8');
}
