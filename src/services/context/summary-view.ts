/**
 * `--summary` — bounded, additive views of large CLI envelopes.
 *
 * Slice 2026-09-10-context-audit-and-discipline (Slice B, part 1).
 *
 * Rationale (measured, session 2026-09-07-session-245530): dumping a full
 * `peaks memory reindex --json` array four times cost ≈ 160 KB ≈ 40K tokens
 * of orchestrator context — roughly 4% of a 1M window for ONE command
 * repeated. The default envelopes stay exactly as they are (back-compat);
 * `--summary` is an OPT-IN view that keeps counts + names-of-first-N and
 * drops the per-entry bodies, which remain on disk and are re-readable with
 * the full command. No information is destroyed — only the in-context copy
 * shrinks.
 *
 * Byte bound: every summary object is passed through `fitSummaryToBytes`,
 * which shrinks string arrays (longest first) until the JSON serialization is
 * ≤ `SUMMARY_DATA_MAX_BYTES` (2 KB minus a small envelope reserve, so the
 * PRINTED envelope stays ≤ `SUMMARY_MAX_BYTES`). Scalars are never touched,
 * so counts and paths stay exact.
 */

/** Hard ceiling for the PRINTED `--summary` envelope, in UTF-8 bytes. */
export const SUMMARY_MAX_BYTES = 2048;
/**
 * Reserve for the envelope wrapper (`ok`/`command`/`warnings`/`nextActions`/
 * error fields) that the CLI adds around `data`. The builders cap `data` at
 * `SUMMARY_DATA_MAX_BYTES` so the whole printed envelope stays ≤ 2 KB.
 */
export const SUMMARY_ENVELOPE_RESERVE_BYTES = 512;
/** Cap applied to the summary `data` object itself (pretty-printed size). */
export const SUMMARY_DATA_MAX_BYTES = SUMMARY_MAX_BYTES - SUMMARY_ENVELOPE_RESERVE_BYTES;
/** Per-name character cap — a name is a label, not a document. */
export const SUMMARY_NAME_MAX_CHARS = 120;
/** How many names each command asks for before the byte fitter trims. */
export const SUMMARY_INITIAL_NAMES = 40;

/** A bounded `{count, names}` view: `count` is the true total, `names` a prefix. */
export interface BoundedNames {
  readonly count: number;
  readonly names: readonly string[];
}

function clipName(name: string, maxChars: number): string {
  const collapsed = name.replace(/\s+/g, ' ').trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars - 1)}…`;
}

/**
 * Build a `{count, names}` view. `count` is always the full length; `names`
 * carries the first `SUMMARY_INITIAL_NAMES` (clipped) entries — the byte
 * fitter may trim further.
 */
export function boundedNames(names: readonly string[]): BoundedNames {
  return {
    count: names.length,
    names: names.slice(0, SUMMARY_INITIAL_NAMES).map((n) => clipName(n, SUMMARY_NAME_MAX_CHARS)),
  };
}

/**
 * Size of the value AS PRINTED — `printResult` serializes with `null, 2`, so
 * the bound must be measured on the pretty form, not the compact one.
 */
function byteLength(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value, null, 2) ?? '', 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Collect every array (with its key path) nested in `node`. */
function collectArrays(node: unknown, path: string, out: Array<{ path: string; array: unknown[] }>): void {
  if (Array.isArray(node)) {
    out.push({ path, array: node });
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    collectArrays(value, path === '' ? key : `${path}.${key}`, out);
  }
}

/**
 * Shrink `data` (in place on a clone) until its JSON form fits `maxBytes`.
 *
 * Algorithm: repeatedly find the LONGEST nested array and drop its last
 * element. Scalars are never modified, so `count` fields stay truthful; the
 * `names` arrays simply show fewer names. Returns the input unchanged when it
 * already fits or when there is no array left to trim.
 */
export function fitSummaryToBytes<T extends Record<string, unknown>>(
  data: T,
  maxBytes: number = SUMMARY_DATA_MAX_BYTES,
): T {
  let out: T;
  try {
    out = structuredClone(data) as T;
  } catch {
    try {
      out = JSON.parse(JSON.stringify(data)) as T;
    } catch {
      return data; // not serializable — leave the caller's object alone
    }
  }
  // Each iteration removes one element, so the bound is the total element
  // count — a cheap upper limit that can never spin forever.
  for (let guard = 0; guard < 100_000; guard++) {
    if (byteLength(out) <= maxBytes) return out;
    const arrays: Array<{ path: string; array: unknown[] }> = [];
    collectArrays(out, '', arrays);
    let longest: { path: string; array: unknown[] } | null = null;
    for (const candidate of arrays) {
      if (candidate.array.length === 0) continue;
      if (longest === null || candidate.array.length > longest.array.length) longest = candidate;
    }
    if (longest === null) return out; // nothing left to shrink
    longest.array.pop();
  }
  return out;
}
