/**
 * Write one design contract file without ever clobbering a user-owned file.
 *
 * A missing file is written. An existing file is left alone unless `force` is
 * set, in which case the old content is copied to `<file>.bak` first, so a
 * forced rewrite stays recoverable.
 */
import { existsSync } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export type WriteDesignContractFileInput = {
  readonly filePath: string;
  readonly content: string;
  readonly force?: boolean | undefined;
};

export type WriteDesignContractFileResult = {
  readonly written: boolean;
  /** The `.bak` path created by a forced rewrite, or `null`. */
  readonly backupPath: string | null;
};

export async function writeDesignContractFile(
  input: WriteDesignContractFileInput
): Promise<WriteDesignContractFileResult> {
  const present = existsSync(input.filePath);
  if (present && input.force !== true) return { written: false, backupPath: null };

  await mkdir(dirname(input.filePath), { recursive: true });
  let backupPath: string | null = null;
  if (present) {
    backupPath = `${input.filePath}.bak`;
    await copyFile(input.filePath, backupPath);
  }
  await writeFile(input.filePath, input.content, 'utf8');
  return { written: true, backupPath };
}
