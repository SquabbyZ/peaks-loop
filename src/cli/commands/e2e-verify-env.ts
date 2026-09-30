/**
 * e2e-verify support surface — moved VERBATIM out of `e2e-verify.ts` for the
 * 300-raw-line cap (slice `b1-filesplit-campaign`, wave 3C): the public
 * input/result types, the two Playwright env-var names, and the env
 * resolver. `e2e-verify.ts` re-exports the public types, so existing import
 * paths keep working.
 */
import { existsSync } from 'node:fs';

export type E2EVerifyInput = {
  readonly projectRoot: string;
  readonly slice: string;
  readonly dispatchId?: string;
};
export type E2EVerifyResult = {
  readonly outcome: 'pass' | 'fail' | 'skipped' | 'no-fixtures';
  readonly passCount: number;
  readonly failCount: number;
  readonly skippedReason?: string;
  /** When the real Playwright runner is used, the chromium-exit summary. */
  readonly runner?: 'playwright' | 'stub';
};

export const PLAYWRIGHT_USER_DATA_DIR_ENV = 'PEAKS_PLAYWRIGHT_USER_DATA_DIR';
export const PLAYWRIGHT_PROFILE_NAME_ENV = 'PEAKS_PLAYWRIGHT_PROFILE_NAME';

export function resolvePlaywrightEnv(): {
  readonly userDataDir: string;
  readonly profileName: string;
} | null {
  const userDataDir = process.env[PLAYWRIGHT_USER_DATA_DIR_ENV];
  const profileName = process.env[PLAYWRIGHT_PROFILE_NAME_ENV];
  if (!userDataDir || !profileName) return null;
  if (!existsSync(userDataDir)) return null;
  return { userDataDir, profileName };
}
