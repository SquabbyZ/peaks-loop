/**
 * `src/services/web/browser-cache-probe.ts`
 *
 * The browser-cache probe (slice S3, file 18; R6, tech-doc §5.3): it asks the
 * resolved Playwright package where its executable WOULD be and checks the
 * filesystem — no download, no spawn, so `peaks web status` can report cache
 * state on a machine with nothing installed. Moved verbatim (wave 3, file-size
 * cap campaign) together with the two path derivations and the readdir guard it
 * depends on, so `web-install-service.ts` stays under the 300 raw-line cap.
 * `web-install-service.ts` re-exports `probeBrowserInstalled` so importers keep
 * resolving it from `web-install-service.js` unchanged; the three helpers were
 * module-private there and are not re-exported.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

import { loadPlaywright, playwrightVersion } from './playwright-loader.js';
import type { BrowserProbe } from './web-install-types.js';

/**
 * Is the pinned browser on disk? Never throws, never spawns, never downloads.
 *
 * **It answers about the artifact `launch()` starts** (R6). `executablePath()`
 * names the `chromium` build, but `chromium.launch()` with no options and
 * `headless` defaulting true resolves `chromium-headless-shell`
 * (`registry.getExecutableName`) — a SEPARATE ~271 MiB download. Probing the
 * full chromium therefore answered "installed" for a machine on which no op
 * could launch: `launch()` failed, S1's net downloaded, the probe kept saying
 * installed, and `peaks web install` short-circuited to a no-op success. See
 * `headlessShellDir` for how the right path is obtained.
 *
 * `version` is reported even when the executable is missing, because "the
 * package is cached but its browser is not" is a different diagnosis from
 * "nothing is installed" — the first is one `peaks web install` away.
 */
export async function probeBrowserInstalled(): Promise<BrowserProbe> {
  const version = await playwrightVersion();
  if (version === null) {
    return { installed: false, version: null, executablePath: null };
  }
  try {
    const chromiumPath = (await loadPlaywright()).chromium.executablePath();
    const shellDir = headlessShellDir(chromiumPath);
    if (shellDir === null) {
      // Not a registry shape we recognise: answer about the path Playwright
      // handed us, exactly as this probe did before R6, rather than about a
      // directory we invented.
      return { installed: existsSync(chromiumPath), version, executablePath: chromiumPath };
    }
    // Absent is the answer, and the whole point: `null` here is what steers
    // `peaks web install` to download and `acquireChromium` to refuse.
    const executablePath = headlessShellExecutable(shellDir);
    return { installed: executablePath !== null, version, executablePath };
  } catch {
    // The package resolved but would not load — a broken cache, not a download.
    return { installed: false, version, executablePath: null };
  }
}

/**
 * The `chromium_headless_shell-<rev>` directory that sits beside
 * `chromiumExecutablePath`'s own revision directory, or `null` when the path is
 * not shaped like Playwright's registry.
 *
 * Playwright's public API cannot name the shell — `BrowserType.executablePath()`
 * takes no options and always answers with the `chromium` build — so it is
 * derived from the one path Playwright does hand out. One naming rule is
 * assumed, and it is the one the cache itself shows: `<rev>` directories are
 * named after the browser, `chromium-1243` beside `chromium_headless_shell-1243`.
 */
function headlessShellDir(chromiumExecutablePath: string): string | null {
  const segments = chromiumExecutablePath.split(/[\\/]/);
  let revision = -1;
  for (let i = segments.length - 1; i > 0; i -= 1) {
    if (/^chromium-\d+$/.test(segments[i] ?? '')) {
      revision = i;
      break;
    }
  }
  const revisionDir = segments[revision];
  if (revision <= 0 || revisionDir === undefined) {
    return null;
  }
  return join(
    segments.slice(0, revision).join(sep),
    revisionDir.replace('chromium-', 'chromium_headless_shell-')
  );
}

/**
 * The shell executable inside `shellDir`, or `null`.
 *
 * The shell's own platform directory is deliberately NOT assumed — it is
 * `chrome-headless-shell-<platform>` where chromium's is `chrome-<platform>` —
 * so the file is looked for rather than named from a copy of Playwright's
 * per-platform path table.
 */
function headlessShellExecutable(shellDir: string): string | null {
  for (const entry of safeReaddir(shellDir)) {
    const platformDir = join(shellDir, entry);
    for (const file of safeReaddir(platformDir)) {
      if (/^chrome-headless-shell(\.exe)?$/.test(file)) {
        return join(platformDir, file);
      }
    }
  }
  return null;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    // Absent is the normal case on a machine that never installed the shell.
    return [];
  }
}
