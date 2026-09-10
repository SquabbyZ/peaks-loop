/**
 * Acquire the chromium browser (slice S1, file 10; S3 adds the ordered gate).
 *
 * The order is load-bearing and is the whole of AC5's first half (tech-doc §5.1):
 *
 *   1. `PEAKS_WEB_DISABLED=1` → refuse, BEFORE any resolve, any lock file and
 *      any cache touch. A gate evaluated after a spawn is not a gate.
 *   2. resolve the pinned Playwright (no npx, no shell — `playwright-loader`).
 *   3. probe the cache. This is spawn-free and download-free (R6): it answers
 *      about the artifact `launchOnce` actually starts — the headless shell —
 *      so "is an install needed" never costs 700 MB to ask, and never answers
 *      about a browser this code will not launch.
 *   4. launch, or refuse with `WEB_INSTALL_REQUIRED`.
 *
 * **Step 4 is a refusal, not a download** (R3). Installing here meant a blocking
 * `spawnSync` on the daemon's request loop for up to 20 minutes: `/health`
 * starved, `status` reported the daemon `orphaned`, `stop` could not prove
 * ownership and left it running, and the CLI gave up at 30 s and called the op
 * failed while the download carried on invisibly. The download now belongs to
 * `peaks web install`, which runs in the caller's own process, on the caller's
 * terminal, and prints its size before it blocks. The daemon answers the op with
 * the tier-3 envelope instead.
 *
 * We never delete anything in the Playwright cache; recovery is delegated to
 * Playwright's own `install --force` (design §10.1).
 */
import { getErrorMessage } from 'peaks-loop-shared/result';

import { loadPlaywright, type PlaywrightModule, type PwBrowser } from './playwright-loader.js';
import { installCommandLine, isWebDisabled, probeBrowserInstalled } from './web-install-service.js';

/** The message Playwright raises when the browser binary was never downloaded. */
const MISSING_EXECUTABLE_RE = /Executable doesn't exist/i;

export interface AcquiredChromium {
  readonly browser: PwBrowser;
  readonly version: string;
}

/**
 * The ordered gate: disable → resolve → cache probe → launch-or-refuse.
 *
 * Every exit here is off the download path, by design — see the module
 * docstring. The `CODE: detail` shape is `web-daemon-service`'s
 * `failureResponse` convention, so the caller gets `WEB_INSTALL_REQUIRED` and
 * not a collapsed `WEB_OP_FAILED`.
 */
export async function acquireChromium(): Promise<AcquiredChromium> {
  assertWebEnabled();
  const playwright = await loadPlaywright();
  const probe = await probeBrowserInstalled();

  if (!probe.installed) {
    throw new Error(`WEB_INSTALL_REQUIRED: ${installRequiredDetail(probe.version)}`);
  }
  try {
    return await launchOnce(playwright);
  } catch (error) {
    if (!MISSING_EXECUTABLE_RE.test(getErrorMessage(error))) {
      throw error;
    }
    // The probe named an existing executable that launch still would not take —
    // a half-written or corrupt revision. `--force` is the documented recovery
    // (R6), and the caller has to run it: this process must not download.
    throw new Error(`WEB_INSTALL_REQUIRED: --force ${installRequiredDetail(probe.version)}`);
  }
}

/** One sentence, shared by both refusal paths, naming the command that fixes it. */
function installRequiredDetail(version: string | null): string {
  const held = version === null ? 'the pinned Playwright is not resolvable' : `playwright@${version} is cached`;
  return (
    `${held} but its browser is not launched-ready; run \`peaks web install\` ` +
    `(\`npx ${installCommandLine().join(' ')}\`)`
  );
}

/** Step 1. `PEAKS_WEB_DISABLED=1` means no browser, no spawn, no cache touch. */
function assertWebEnabled(): void {
  if (isWebDisabled(process.env)) {
    throw new Error(
      'WEB_DISABLED: PEAKS_WEB_DISABLED=1 — the local browser path is switched off for this process'
    );
  }
}

/**
 * Launch with no options: `headless` defaults true and Playwright resolves
 * `chromium-headless-shell` (`registry.getExecutableName`). That is deliberate —
 * the full `chromium` build under new-headless mode was measured on this machine
 * at **15 101 ms to `close()`**, against **102 ms** for the shell, and S2's
 * teardown has to finish inside `STOP_EXIT_TIMEOUT_MS = 10 s` or the daemon is
 * SIGTERM'd mid-teardown and its browser is orphaned (AC6). `probeBrowserInstalled`
 * is what had to change, not this.
 */
async function launchOnce(playwright: PlaywrightModule): Promise<AcquiredChromium> {
  const browser = await playwright.chromium.launch();
  return { browser, version: browser.version() };
}
