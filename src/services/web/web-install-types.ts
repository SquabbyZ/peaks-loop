/**
 * `src/services/web/web-install-types.ts`
 *
 * The record shapes of browser acquisition (`web-install-service.ts`): what
 * the cache probe answers, what an install run reports, and the body of the
 * install lock on disk. Extracted verbatim (wave 3, file-size cap campaign) so
 * the install module stays under the 300 raw-line cap. Types only — no probe,
 * lock or spawn behaviour lives here. `web-install-service.ts` imports them and
 * re-exports the two that were public, so importers keep resolving
 * `BrowserProbe` / `InstallOutcome` from `web-install-service.js` unchanged;
 * `InstallLockBody` was module-private and stays unexported there.
 */

/** What the cache says, without downloading anything (tech-doc §5.3). */
export interface BrowserProbe {
  readonly installed: boolean;
  /** The resolved Playwright PACKAGE version, or `null` when the package is absent. */
  readonly version: string | null;
  readonly executablePath: string | null;
}

export interface InstallOutcome {
  readonly ok: boolean;
  /** `''` on success, otherwise `WEB_INSTALL_BUSY` | `WEB_INSTALL_FAILED` | `WEB_INSTALL_TIMEOUT`. */
  readonly code: string;
  readonly message: string;
  /** The size warning whenever this call actually ran the installer. */
  readonly warnings: readonly string[];
}

export interface InstallLockBody {
  readonly pid: number;
  readonly startedAt: string;
}
