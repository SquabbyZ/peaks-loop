/**
 * "This unknown value is a plain JSON object" — the one narrowing this package
 * uses to open a value that came out of `JSON.parse`.
 *
 * WHY IT LIVES HERE RATHER THAN IN EACH READER (batch B2). Two readers in this
 * package need to open a parsed value before they can check its fields:
 * `src/status-protocol.ts` (a status record) and `src/vendor/progress-line.ts`
 * (a progress line). The alternative to this function is not "no function" — it
 * is `const rec: Record<string, unknown> = JSON.parse(raw)`, which is a CAST:
 * it asserts the shape instead of checking it, and because `JSON.parse` returns
 * `any` the assertion is invisible to the TS lint ratchet. So the check is
 * written out once, at the boundary, and both readers call it.
 *
 * The three clauses are each load-bearing:
 *   - `typeof value === 'object'` rejects strings, numbers, booleans, bigints,
 *     symbols, undefined and functions in one go;
 *   - `value !== null` — `typeof null` is the famous `'object'`;
 *   - `!Array.isArray(value)` — an array IS a JSON value, and this predicate is
 *     a named narrowing (NOT the repo's non-narrowing `src/shared/array-guards.ts`
 *     `isArray`, which this package cannot import and whose job is the opposite
 *     one). An array has no named fields, so treating one as an object would
 *     hand every field read `undefined`.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
