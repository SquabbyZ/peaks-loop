/**
 * Binding status service — v2.18.2 read-only introspection helper.
 *
 * Surfaces the on-disk binding-store contents to the
 * `peaks binding status` CLI command (follow-up issue #2, deferred
 * from the v2.18.0 PRD §3.4 nice-to-have list).
 *
 * The service is intentionally read-only: it never calls
 * `registerInstance`, `heartbeat`, `dropInstance`, or any other
 * mutator. The only writes it performs are to stdout/stderr (the
 * rendering layer). This is the v2.18.2 "no side effects on status"
 * contract — a user running `peaks binding status` must not see their
 * own binding change underneath them.
 *
 * Format modes:
 * - `table` (default for non-TTY): ASCII table with columns
 *   `sid | callerId | pid | roles | lastHeartbeat`. Designed to be
 *   greppable and pipeable; no ANSI colour, no padding tricks.
 * - `json` (default when `--json` is set): raw binding dump matching
 *   the zod `BindingSchema` shape.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { readBinding, type Binding, type InstanceRecord } from './binding-store.js';
import { getSessionMeta } from './session-manager.js';

export type BindingStatusFormat = 'table' | 'json';

export type BindingStatusView = {
  /** The raw binding that was read (or `null` when no binding exists). */
  binding: Binding | null;
  /** The on-disk source of the binding (informational; the CLI uses this for the header). */
  source: 'canonical' | 'legacy' | 'none';
  /** The project root the binding was read from. */
  projectRoot: string;
  /** True when the binding's callerIds do not match the current outer-session-id env signal. */
  stale: boolean;
  /** The current outer-session-id resolved from PEAKS_OUTER_SESSION_ID / CLAUDE_CODE_SESSION_ID / 'unknown'. */
  outerSessionId: string;
};

/**
 * Read the binding from disk and assemble the read-only view. Pure
 * helper that does no filesystem writes; safe to call from any test.
 */
export function loadBindingStatus(projectRoot: string): BindingStatusView {
  const binding = readBinding(projectRoot);
  const canonicalExists = existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json'));
  const legacyExists = existsSync(join(projectRoot, '.peaks', '.session.json'));
  const source: BindingStatusView['source'] = canonicalExists ? 'canonical' : legacyExists ? 'legacy' : 'none';

  const outerSessionId = readOuterSessionId();
  const stale = binding === null
    ? false
    : !Object.values(binding.instances).some((inst) => inst.callerId.startsWith(outerSessionId));

  return { binding, source, projectRoot, stale, outerSessionId };
}

export function readOuterSessionId(): string {
  return readOuterSessionIdFromEnv(process.env) ?? 'unknown';
}

/** Pure env read (no process.env dependency) so callers can inject an env. */
function readOuterSessionIdFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const peaks = env.PEAKS_OUTER_SESSION_ID;
  if (typeof peaks === 'string' && peaks.length > 0) return peaks;
  const claude = env.CLAUDE_CODE_SESSION_ID;
  if (typeof claude === 'string' && claude.length > 0) return claude;
  return undefined;
}

/**
 * Resolve the outer (harness / IDE) session id for the auto-compact
 * context-percent probe. Order: env signal first (PEAKS_OUTER_SESSION_ID /
 * CLAUDE_CODE_SESSION_ID), then the bound peaks session's recorded
 * `outerSessionId` (`session.json` meta). Returns `undefined` when neither is
 * available — the caller passes `undefined` through and the adapter's fallback
 * returns null → conservative-fallback. Vendor-neutral: this helper has no
 * IDE-specific naming; the env-var read lives alongside the binding layer.
 */
export function resolveOuterSessionId(
  projectRoot: string,
  sessionId: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envOuter = readOuterSessionIdFromEnv(env);
  if (envOuter !== undefined) return envOuter;
  const recorded = getSessionMeta(projectRoot, sessionId)?.outerSessionId;
  return typeof recorded === 'string' && recorded.length > 0 ? recorded : undefined;
}

/**
 * Render the binding as a pipeable ASCII table. The columns are fixed
 * (no truncation, no wrapping) so a downstream `awk` / `cut` pipeline
 * can be built against it. Returns the empty string (NOT a header
 * row) when the binding has no instances, so callers can detect "no
 * data" via the row count.
 */
export function formatTable(view: BindingStatusView): string {
  if (view.binding === null) return '';
  const rows: string[][] = [];
  for (const [sid, inst] of Object.entries(view.binding.instances)) {
    rows.push([sid, inst.callerId, String(view.binding.pid), inst.roles.join(','), inst.lastHeartbeat]);
  }
  if (rows.length === 0) return '';
  const header = ['sid', 'callerId', 'pid', 'roles', 'lastHeartbeat'];
  const all = [header, ...rows];
  const widths = header.map((_, i) => Math.max(...all.map((r) => r[i]!.length)));
  const pad = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [pad(header), sep, ...rows.map(pad)].join('\n');
}

/**
 * Render the binding as a JSON envelope. The shape mirrors
 * `BindingSchema` (camelCase keys kept for back-compat with the
 * existing v2.18.0 callers; instance fields are nested under
 * `instances[<sid>]`).
 */
export function formatJson(view: BindingStatusView): Record<string, unknown> {
  if (view.binding === null) {
    return {
      binding: null,
      source: view.source,
      projectRoot: view.projectRoot,
      stale: view.stale,
      outerSessionId: view.outerSessionId
    };
  }
  return {
    binding: view.binding,
    source: view.source,
    projectRoot: view.projectRoot,
    stale: view.stale,
    outerSessionId: view.outerSessionId
  };
}

export function isInstanceRecord(value: unknown): value is InstanceRecord {
  // Cheap duck-type guard for tests that build a binding literal;
  // canonical validation lives in `BindingSchema` from binding-store.
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.startedAt === 'string' &&
    Array.isArray(v.roles) &&
    typeof v.callerId === 'string' &&
    typeof v.lastHeartbeat === 'string';
}
