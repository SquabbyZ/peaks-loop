/**
 * `Array.isArray` written so that it does NOT narrow.
 *
 * WHY THIS EXISTS (S10, 2026-09-20). TypeScript declares `Array.isArray` as
 * `(arg: any) => arg is any[]`. That is right for an `unknown` argument and
 * WRONG for an already-typed one: applied to a `readonly SliceNode[]`, the
 * guard narrows the value to `any[]`, so every later element access
 * (`n.id`, `e.from`, …) is an `any` access. `@typescript-eslint/no-unsafe-*`
 * then reports the widening, not the caller's intent — and the guard was
 * measuring "is this an array at runtime?", which it still does below.
 *
 * Measured effect of the widening at the S10 census: 107 of the 817 TS
 * `no-unsafe-*` findings across 7 files (slice-dag, workflow-graph-store,
 * workflow-inflight-probe, spec-service, contract-store, eslint-runner,
 * api-diff-openapi). Those files hold values that are ALREADY correctly typed;
 * `Array.isArray` was the only thing discarding the type.
 *
 * Returning plain `boolean` is the honest shape here: it reports the runtime
 * fact and asserts nothing about the type. A predicate like
 * `value is readonly T[]` would silence the same findings with an unchecked
 * assertion — the same offence as a cast — which this slice is explicitly
 * forbidden from adding.
 *
 * Consequence at call sites: after `if (!isArray(x)) throw`, TypeScript does
 * NOT know `x` is defined, because a `boolean` return cannot narrow. A site
 * that also needs defined-ness must say so — write
 * `if (x === undefined || !isArray(x)) throw`, which is what the call sites
 * below do. That is the price of not asserting, and it is paid in the open.
 */
export function isArray(value: unknown): boolean {
  return Array.isArray(value);
}
