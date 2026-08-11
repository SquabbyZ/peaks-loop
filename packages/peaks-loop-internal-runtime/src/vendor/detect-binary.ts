import { execFile } from 'node:child_process';

const DETECT_TIMEOUT_MS = 3000;

/** Resolve a binary through the platform's PATH lookup without invoking a shell. */
export function detectBinaryInstalled(binary: string): Promise<boolean> {
  const locator = process.platform === 'win32' ? 'where.exe' : 'which';

  return new Promise((resolve) => {
    execFile(locator, [binary], { timeout: DETECT_TIMEOUT_MS }, (error, stdout) => {
      resolve(error === null && stdout.trim().length > 0);
    });
  });
}
