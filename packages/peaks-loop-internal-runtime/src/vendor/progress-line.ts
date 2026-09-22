import type { ChildStatus, VendorId } from '../types.js';
import { isJsonObject } from '../guards/json-object.js';

/** The states `ChildStatus.state` allows — the set the reader below checks. */
const CHILD_STATES: readonly ChildStatus['state'][] = [
  'running',
  'stale',
  'crashed',
  'oom-killed',
  'done',
  'spawn-failed'
];

function isChildState(value: unknown): value is ChildStatus['state'] {
  if (typeof value !== 'string') return false;
  return CHILD_STATES.some((state) => state === value);
}

/**
 * The old `String(x ?? '')` for the JSON scalars a status line carries, and `''`
 * for everything else. A non-scalar used to stringify to `'[object Object]'`
 * (or throw on a symbol) — `no-base-to-string` rejects that, and no caller
 * wants it. Scalars keep the exact old result, so a line that parsed before
 * still yields the same `rid` / `note`.
 */
function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}

/**
 * Parse one progress line from a vendor's `--output-format json` stream into a
 * `ChildStatus`, or `null` when the text is not one.
 *
 * WHY THIS EXISTS (batch B2). The three vendor adapters carried this body
 * verbatim, and every field of it went straight from `JSON.parse`'s `any` into
 * a `ChildStatus` — `state` included, which is a six-member union the old code
 * assigned to without checking anything:
 *
 *     const o = JSON.parse(stdout);   // any
 *     state: o.state,                 // any -> 'running' | 'stale' | …
 *
 * That reads as typed and validates nothing, and because `JSON.parse` returns
 * `any`, no compiler complaint was possible. Here each field is checked, and a
 * line that fails is `null` — the outcome the adapters already produced for
 * unparseable text or a missing numeric `progress`.
 *
 * ONE BEHAVIOUR CHANGE, STATED PLAINLY: a line whose `state` is not one of the
 * six now reads as `null` instead of as a `ChildStatus` whose `state` violates
 * its own type. There is no honest default to substitute — inventing one (say
 * `'running'`) would keep the lie and make it harder to see. Nothing in `src/`
 * or `src/cli/` calls `parseStatusLine`; the only readers are each adapter's own
 * unit test, and all three use `state: 'running'`.
 *
 * The `rid` / `note` / `ts` fallbacks preserve the old coercions exactly
 * (`String(x ?? '')`, `Number(x ?? Date.now())`), so a line that used to parse
 * still yields the same record.
 */
export function parseProgressLine(stdout: string, vendor: VendorId): ChildStatus | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!isJsonObject(parsed)) return null;

  const progress = parsed['progress'];
  if (typeof progress !== 'number') return null;

  const state = parsed['state'];
  if (!isChildState(state)) return null;

  return {
    rid: asText(parsed['rid']),
    vendor,
    progress,
    state,
    note: asText(parsed['note']),
    ts: Number(parsed['ts'] ?? Date.now())
  };
}
