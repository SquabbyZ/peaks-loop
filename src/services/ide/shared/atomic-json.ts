import { closeSync, constants, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';

export const ATOMIC_JSON_FILE_MODE = 0o600;

/**
 * Read a JSON object file using a no-follow open. Returns an empty object when
 * the file does not exist or is empty. Throws when the file exists but does not
 * contain a JSON object (so callers can distinguish "no settings" from
 * "malformed settings").
 */
export function readJsonObjectFile<T extends Record<string, unknown> = Record<string, unknown>>(
  filePath: string
): T {
  if (!existsSync(filePath)) return {} as T;
  const fd = openSync(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const raw = readFileSync(fd, 'utf8').trim();
    if (raw.length === 0) return {} as T;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('settings file must contain a JSON object');
    }
    return parsed as T;
  } finally {
    closeSync(fd);
  }
}

/**
 * Atomically write a JSON file: create a unique temp file in the same
 * directory, fsync its contents via close, then `rename` over the target. A
 * failure during rename removes the temp file (best effort). The target is
 * created with 0o600 permissions.
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tempPath = join(dir, `.settings.${randomUUID()}.tmp`);
  const fd = openSync(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, ATOMIC_JSON_FILE_MODE);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tempPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // best effort cleanup
    }
    throw error;
  }
}
