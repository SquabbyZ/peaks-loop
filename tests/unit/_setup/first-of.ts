// tests/unit/_setup/first-of.ts
//
// Runtime-narrowing accessor for the first element of a `readonly T[]`.
//
// WHY NOT `items[0]!`
//
// `tsconfig.json` enables `noUncheckedIndexedAccess`, so `result[0]` on a
// `readonly DoctorCheck[]` has type `DoctorCheck | undefined` and reading any
// property off it is a TS2532. The non-null assertion silences that, but this
// repository reports `@typescript-eslint/no-non-null-assertion` at WARN level
// and warnings count toward the `eslintFindings` ceiling in
// `.peaks/lint/gate-baseline.json` — a ceiling that may only go DOWN. One `!`
// per site would spend 29 findings against a budget the cleanup program is
// trying to reduce, so the assertion is not available here.
//
// THIS IS A STRENGTHENING OF THE ASSERTION, NOT A WEAKENING
//
//   - Non-empty array: the returned value is the SAME value `items[0]` gives —
//     same reference, same static type `T`, no copy, no default, no coercion.
//     Every replacing call site therefore asserts on an identical object.
//   - Empty array: `items[0]` silently yields `undefined`, and the surrounding
//     `expect(undefined.id)` then throws a bare `TypeError: Cannot read
//     properties of undefined (reading 'id')` that names neither the array nor
//     the intent. This helper throws a NAMED error instead, so the failure says
//     what actually went wrong.
//
// So the empty case goes from "silently wrong, then confusing" to "loudly
// wrong, with a name" — strictly more information, never less.
//
// PRECEDENT
//
// This is the same narrowing, and the same choice to throw a named error, that
// `tests/unit/doctor/codegraph-probe-uses-resolved-root.test.ts` already makes
// in its local `first()` helper. This module is the reusable form of it.
//
// Opt-in per test file, like the sibling `tmp-workspace` / `clock` / `io`
// helpers — nothing is auto-registered by `index.ts`.

/**
 * Return `items[0]`, narrowing `undefined` away at runtime rather than with a
 * non-null assertion.
 *
 * @param items A `readonly` array the caller has established is non-empty
 *   (typically via `expect(result).toHaveLength(1)` immediately above, or
 *   because the producer under test returns exactly one element per branch).
 * @returns `items[0]` — the identical value the index expression would give.
 * @throws Error when `items` is empty, naming the helper so the failure is
 *   attributable rather than a downstream `TypeError`.
 */
export function firstOf<T>(items: readonly T[]): T {
  const value = items[0];
  if (value === undefined) {
    throw new Error('firstOf: expected a non-empty array');
  }

  return value;
}
