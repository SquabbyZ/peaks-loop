/**
 * Pure short-sid suffix helpers for the Peaks statusLine.
 *
 * Extracted from `skill-statusline-renderer.ts` (slice
 * 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * repair cycle) to keep the renderer under the Karpathy 800-line cap.
 * The module is I/O-free and only depends on the read-only
 * `StatusLineModel` shape from `skill-statusline-service.ts` plus the
 * `StatusPalette` interface still owned by the renderer. Re-exports
 * both helpers so the existing test surface (`formatShortSid` direct
 * tests + `computeRootSuffix` helper-level tests in
 * `tests/unit/skills/skill-statusline-sid-only-marker.test.ts`) keeps
 * importing from the renderer for back-compat.
 *
 * Pure module — no I/O, no clock dependency, no side effects.
 */

import type { StatusLineModel } from './skill-statusline-service.js';

/**
 * Minimal palette slice consumed by {@link computeRootSuffix}. The full
 * `StatusPalette` is defined as a module-private interface inside the
 * renderer; the suffix helper only needs `trailSeparator`. Re-declared
 * structurally so the helper has no upward import on the renderer.
 */
export interface SidSuffixPalette {
  readonly trailSeparator: string;
}

/**
 * Format a session id as a short, terminal-friendly tag.
 *
 * Returns the last kebab-segment of `sessionId` (e.g.
 * `2026-08-04-session-3fe1be` → `3fe1be`), or the empty string when
 * the input is empty. Pure; safe for ASCII rendering across
 * PowerShell, Git Bash, and zsh (AC7).
 *
 * Slice 2026-08-05-statusline-empty-render-and-short-sid-suffix.
 */
export function formatShortSid(sessionId: string): string {
  if (sessionId.length === 0) return '';
  const last = sessionId.split('-').pop();
  return last ?? sessionId;
}

/**
 * Compute the project-root cell of the status line. Returns the
 * `<trailSep><root>` portion (and optionally the ` [shortSid]` suffix).
 *
 * Pure helper — no I/O. The `sessionId` is read from the model that the
 * service already resolved once via `getSessionIdCanonical`. Per-state
 * matrix (see the docstring inside `renderStatusLine` in
 * `skill-statusline-renderer.ts` for the AC/PB references):
 *
 *   - state === 'invalid-presence'           → no sid (G2 invariant)
 *   - state === 'idle' | 'stale' | 'active'   → sid iff model.sessionId resolves
 *     to a non-empty shortSid string
 *   - rootLabelText === ''                   → empty string
 *
 * Exported so tests can drive the helper without spinning up the full
 * renderer (marquee, palette, etc.).
 */
export function computeRootSuffix(
  model: StatusLineModel,
  rootLabelText: string,
  palette: SidSuffixPalette,
): string {
  if (!rootLabelText) return '';
  let suffix = `${palette.trailSeparator}${rootLabelText}`;
  if (model.state === 'invalid-presence') return suffix;
  // Defensive: older callers may build a model without `sessionId`
  // (the field is optional in some test fixtures predating the
  // sid-only-marker slice). Treat undefined the same as null.
  if (model.sessionId === null || model.sessionId === undefined) return suffix;
  const short = formatShortSid(model.sessionId);
  if (short.length === 0) return suffix;
  return `${suffix} [${short}]`;
}
