/**
 * Fresh-context kill-switch reader (slice 2026-09-07-search-first-preflight).
 *
 * Reads the global `freshContext.enabled` boolean via the config service's
 * nested-key accessor — the same one `peaks config get --key` uses. Defaults
 * to `true` (preflight on) when the key is absent; `false` disables the
 * preflight (no search, no injection), per acceptance criterion #9.
 */
import { getConfig } from '../config/config-service.js';

export function isFreshContextEnabled(): boolean {
  const raw = getConfig({ key: 'freshContext.enabled' });
  return raw !== false;
}
