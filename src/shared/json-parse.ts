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
 * Parse `raw` and return it only if it matches `schema`; `null` when the text
 * is not JSON, or is JSON of the wrong shape. Use where "absent or malformed"
 * and "absent" are the same outcome for the caller — the file-backed readers
 * in this repo, whose existing `catch { return null }` already said so.
 */
export function tryParseJson<S extends z.ZodType>(raw: string, schema: S): z.infer<S> | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = schema.safeParse(decoded);
  return result.success ? result.data : null;
}
