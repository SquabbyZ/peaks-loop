/**
 * Acquire the chromium browser (slice S1, file 10; extended in S3).
 *
 * Lazy, on the first browser-touching op (PRD R2 / tech-doc §3.3): resolve
 * Playwright, launch, and only if the executable is missing run the one-time
 * `playwright install chromium` and retry. We never delete anything in the
 * Playwright cache — recovery is delegated to Playwright's own
 * `install --force` (design §10.1).
 *
 * S3 wraps this with the `PEAKS_WEB_DISABLED` gate, the install lock and the
 * tier-3/4 degradation chain; S1 deliberately keeps only the two tiers it can
 * observe (1 = already installed, 2 = installed on this call).
 */
import { spawnSync } from 'node:child_process';

import { getErrorMessage } from 'peaks-loop-shared/result';

import { resolveNpxInvocation } from '../lint/npx-resolver.js';
import { loadPlaywright, PLAYWRIGHT_VERSION_PIN, type PwBrowser } from './playwright-loader.js';

/** The message Playwright raises when the browser binary was never downloaded. */
const MISSING_EXECUTABLE_RE = /Executable doesn't exist/i;

export interface AcquiredChromium {
  readonly browser: PwBrowser;
  readonly version: string;
  /** 1 = browser already present; 2 = this call performed the lazy download. */
  readonly tier: 1 | 2;
}

/** Resolve → launch → install-on-missing → retry. */
export async function acquireChromium(): Promise<AcquiredChromium> {
  const playwright = await loadPlaywright();
  try {
    const browser = await playwright.chromium.launch();
    return { browser, version: browser.version(), tier: 1 };
  } catch (error) {
    if (!MISSING_EXECUTABLE_RE.test(getErrorMessage(error))) {
      throw error;
    }
    runChromiumInstall();
    const browser = await playwright.chromium.launch();
    return { browser, version: browser.version(), tier: 2 };
  }
}

/** Exact argv of the lazy download: `npx --yes --package playwright@<pin> -- playwright install chromium`. */
function runChromiumInstall(): void {
  const invocation = resolveNpxInvocation([
    '--yes',
    '--package',
    `playwright@${PLAYWRIGHT_VERSION_PIN}`,
    '--',
    'playwright',
    'install',
    'chromium'
  ]);
  const result = spawnSync(invocation.command, [...invocation.args], {
    stdio: 'ignore',
    // The one-time chromium download must not pop a console window at the user.
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(
      `WEB_INSTALL_FAILED: \`playwright install chromium\` exited with status ${String(result.status)}`
    );
  }
}
