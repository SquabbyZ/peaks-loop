/**
 * `JSON.parse`, with the shape CHECKED before the value is used.
 *
 * WHY THIS EXISTS (S12, 2026-09-20). `lib.es5.d.ts` declares
 * `JSON.parse(text: string): any`, so every unvalidated parse is a place where
 * `any` ENTERS a file and then flows outward — at the S12 census that was ~448
 * `@typescript-eslint/no-unsafe-*` findings across 48 files, the largest single
 * root of the TS `any` population. The findings sit downstream of the parse;
 * the parse is what has to change.
 *
 * WHAT THIS IS NOT. The shortest-looking fix is
 *
 *     function parseJson<T>(raw: string): T { return JSON.parse(raw) as T; }
 *
 * It has a type parameter and reads as "typed", but it validates nothing: the
 * `as T` is still there, wearing a costume. That is the same offence as a
 * suppression comment and harder to see, and S12 forbids it outright.
 *
 * So the type parameter here is the SCHEMA, not the result. `z.infer<S>` is
 * derived FROM the schema that actually ran, which is why the returned type is
 * a claim the runtime already checked rather than an assertion about it.
 *
 * Sibling precedent: `src/shared/array-guards.ts` (S10) returns plain
 * `boolean` rather than a `value is T[]` predicate for the same reason.
 */
// Type-only: `z` is used for `z.ZodType` / `z.infer` and for nothing at runtime.
import type { z } from 'zod';

/**
 * Parse `raw` and return it only if it matches `schema`. Throws (from
 * `schema.parse`) when the text is not JSON, or is JSON of the wrong shape.
 * Use where a malformed value is a defect that must be visible.
 */
export function parseJson<S extends z.ZodType>(raw: string, schema: S): z.infer<S> {
  // No cast: `JSON.parse`'s `any` is accepted by `parse`'s `unknown` parameter,
  // and `schema.parse` establishes the return type by checking it.
  return schema.parse(JSON.parse(raw));
}

/**
 * The outcome of {@link tryParseJson}. A DISCRIMINATED result rather than
 * `T | null`, because "the text is not JSON" and "the text is JSON of the wrong
 * shape" are different failures and a caller that must treat them differently
 * has to be able to say so.
 *
 * WHY NOT `T | null` (2026-09-23). Collapsing both to `null` is precisely the
 * shape this repository's own `catch-return-null` ratchet exists to catch —
 * "caller cannot distinguish failure from success" — and it had already cost a
 * real defect rather than merely risking one. `readJsonIfExists` in
 * `src/services/sediment/pool-read.ts` had no `catch` and THREW on malformed
 * JSON, so replacing it with the `T | null` form silently downgraded "the whole
 * command fails" to "this bee is skipped". Neither primitive could restore the
 * pair — the old `tryParseJson` mapped both failures to `null`, and `parseJson`
 * throws on both — so that reader had to hand-roll its parse in two steps. The
 * user adjudicated on 2026-09-21 that parsing must fail loudly while a wrong
 * shape is skipped; `reason` is what finally lets a caller reproduce that pair
 * without hand-rolling it. See
 * `tests/unit/services/sediment/pool-read-semantics.test.ts`.
 */
export type TryParse<S extends z.ZodType> =
  { ok: true; value: z.infer<S> } | { ok: false; reason: 'malformed' | 'shape' };

/**
 * Parse `raw` into `schema`, reporting WHICH failure occurred when it fails.
 * Never throws: `malformed` is text that is not JSON, `shape` is JSON the
 * schema rejected.
 *
 * Callers whose two failures are the same outcome collapse it at their own call
 * site (`r.ok ? r.value : null`) — visibly, and outside a `catch` — which is
 * the shape those file-backed readers already had. Callers that must keep the
 * failures apart switch on `reason`. Use `parseJson` when every failure is a
 * defect that must be visible.
 */
export function tryParseJson<S extends z.ZodType>(raw: string, schema: S): TryParse<S> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  const result = schema.safeParse(decoded);
  return result.success ? { ok: true, value: result.data } : { ok: false, reason: 'shape' };
}
