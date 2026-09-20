# Lint rules this repo deliberately diverges from

> Created 2026-09-20. One section per rule, each with the evidence that drove the
> decision, so a future reader can tell a **decision** from an **oversight**.
>
> A divergence recorded here is not "we didn't get around to it". It is a rule we
> looked at, measured against this repo, and chose to override — with the numbers
> written down so the choice can be re-litigated if the numbers change.

---

## `@typescript-eslint/require-await` — OFF (2026-09-20)

**Status:** turned off repo-wide with an explicit `'off'` line in
`config/eslint/.peaks-rules.cjs`. It is **inherited** from
`plugin:@typescript-eslint/recommended-type-checked`, so the override has to be
explicit — a silently-absent line would read as an oversight rather than a
decision.

**Residual signal moved to a guard.** See "What replaces it" below.

### What the rule actually does

Its description says *"disallow async functions which do not return promises and
have no `await` expression"*, which reads as if it exempts promise-returning
functions. **It does not**, and that was measured with a probe file rather than
inferred from the source:

| probe | flagged? |
|---|---|
| `async function f(): Promise<void> { const x = 1 + 1; }` | **yes** |
| `async (): Promise<void> => { … }` | **yes** |
| `async m(): Promise<void> { … }` | **yes** |
| `async function g(): Promise<number> { return Promise.resolve(1); }` | no |
| `async function h(): Promise<void> {}` (empty body) | no |

The implementation fires iff `async && !hasAwait && !isEmptyFunction &&
!(isAsyncGenerator && isAsyncYield)`. The type checker is consulted **only** for
(a) whether a `ReturnStatement`'s expression is thenable, (b) body-less arrows,
(c) `yield`. **The declared return type is used only by the autofix suggestion, to
rewrite `Promise<T>` → `T`.**

So the rule will happily flag a function whose return type is written
`Promise<void>` — and acting on its suggestion is a **tsc error**, because
removing `async` changes the return type from `Promise<T>` to `T`.

> ⚠️ **A trap for anyone writing the replacement guard:** an `async` function's
> *inferred* return type is **always** a Promise. A predicate of the form "flag
> when the return type is not a Promise" therefore flags **nothing**. The only
> workable basis is the **explicit annotation**.

### The evidence

The figure carried through the decision process was **291** — `src`, `tests` and
`packages`. **`scripts/` carries 2 more, so the true before-count was 293**, and
the `scripts` sites were never exempted from anything. The table below is the 291
that were classified; the guard added at the end of this section reports 0 in
`scripts/`, because the two there are contract-bearing.

Classification, by AST over all of them:

| scope | n | explicit `Promise<…>` | own-body `throw` | gratuitous |
|---|---|---|---|---|
| `tests/` | 197 | 19 | 14 | **18** (`it`/`test` callbacks) |
| `src/` | 90 | 62 | 19 | 14 |
| `packages/` | 4 | 4 | 0 | 0 |
| **non-test total** | **94** | **66** | 19 | **14** |

**32 of 291 (11%) are genuinely gratuitous. The other 259 are the rule being
wrong** — either the `async` is required by an explicit `Promise<…>` contract, or
it is deliberately turning a `throw` into a rejection, or it satisfies an
interface that returns a Promise (`execute: async () => ({…})` against
`readonly execute: (ctx) => Promise<GuardRunResult>`, and similar).

Stripping `async` from all 314 original sites produced **363 tsc errors**, so
"just remove them" was never a cleanup — it was an interface rewrite.

### The safety question, measured rather than argued

The real hazard a reader should care about is the one the rule's rationale names:
**an `async` function with no `await` runs synchronously, so a later `await` added
at the top silently makes everything below it asynchronous — and if that code has
a side effect, the ordering changes with no error.**

That hazard is genuine. In this repo it lands on exactly **10 sites**:
`src/services/adapter/codex-adapter.ts:20,23,26,29,32` and
`copilot-adapter.ts:20,23,26,29,32` — each `async m() { throw new
ADAPTER_NOT_IMPLEMENTED(…) }`, whose only callers are
`await expect(x.y()).rejects.toBeInstanceOf(…)`. Removing `async` there makes the
throw synchronous, so `expect(…)` is never reached and the throw escapes into the
enclosing `async it` callback — **vitest fails that test loudly**. Both files
describe themselves as `⚠ DEAD CODE — zero importers`.

Every other `throw`-bearing site has callers that `await`, which re-wraps a
synchronous throw into a rejection — so behaviour is unchanged.

### Why not the two obvious alternatives

- **Keep it and accept the noise.** It is the only ratchet axis measuring "lint
  strictness", and 259 known non-defects inside that number would make the number
  stop meaning "debt". The repo already keeps one policy rule as accepted debt
  (`max-lines` / `max-lines-per-function`, see `.peaks/docs/lint-gate.md` §8.2) —
  but those findings are *true statements about code shape*, whereas these are
  *false positives about correct code*.
- **Turn it off and rely on review.** Rejected because the residual signal is
  real and cheap to keep — see below.

### The mutation-testing claim, checked

`async` without `await` is sometimes defended as "useful for mutation testing".
**In this repo it is not**, on two independent grounds:

- `stryker.conf.js`'s `mutate` covers **4 files**
  (`src/services/loop/{evaluator-dispatcher,monotonic-guard,monotonic-runner,run-driver}.ts`)
  and **none of the 291 sites is in them**;
- Stryker's 16 mutators contain **no `async`-removal mutation** at all
  (`grep -c async` across the mutator modules = 0). The upstream feature request
  is still open ([stryker-js#933](https://github.com/stryker-mutator/stryker-js/issues/933)).

Side observation, recorded because it is a real config defect found while
checking: `@stryker-mutator/typescript-checker` is a devDependency but is **not
listed in `plugins`**, so it is not active; and core `8.7.1` vs `vitest-runner`
`9.6.1` is a major-version mismatch.

### What replaces it

- **18 gratuitous `it`/`test` `async` callbacks were removed** (vitest awaits the
  returned value either way, so the `async` was pure redundancy).
- **A guard in `tests/unit/standards/gratuitous-async-guard.test.ts`** carries the
  residual class. `tests/` is exempt, matching the existing `tests/**` overrides,
  so it covers **`src/` and `packages/`**. It reports **exactly 14** sites, each
  listed below. It runs with `pnpm test:unit` (~3 s, `ts.createProgram` + checker)
  and pins its own reach — **817 files, 578 async functions, 577 type-checked** —
  so a broken traversal cannot pass as a clean one.

  The 14: `src/cli/commands/{code-job-shape-commands:55, job-commands:349,354,371}`,
  `src/services/adapter/{codex,copilot}-adapter:17`,
  `capability-guard-runner/contracts/{J04:24, J05:76}`,
  `evolution/{independent-evaluator-runner:122, regression-skeptic-runner:98}`,
  `llm/stub-runner:35`, `slice/slice-decompose-runners:{39,89,153}`.
  `packages/` contributes 0.

### A spec correction worth keeping

The predicate as first specified had **five** conditions and reported **21**, not
14. The seven extras all return a thenable — `awaitBatch: async (x) =>
pollDispatchRecords(x)` (×4) and `query: async (…) => { …; return base.query(…) }`
(×3). **The rule being replaced exempts a thenable return expression**, so those
seven were never findings and were never candidates; the predicate was missing
the rule's own exemption.

Adding it — a type-checker thenable test, the same basis the rule uses — yields
exactly 14. **Both numbers are pinned separately in the guard (21 without the
exemption, 14 with), so the sixth condition is auditable rather than smuggled.**
Anyone changing the predicate should expect both pins to move, and should be able
to say why.

That is the whole argument for replacing a rule with a guard rather than simply
disabling it: the guard's replacement is precise enough to state, and precise
enough to be wrong about. A predicate that "looked right" would have reported 21
and nobody would have noticed the 7.

Upstream context, for whoever revisits this:
[typescript-eslint#11731](https://github.com/typescript-eslint/typescript-eslint/issues/11731)
argues the rule should not be in a recommended set at all, on the grounds that
`async` without `await` "safeguards the invocation and API surface, avoiding
accidentally leaking synchronously thrown errors"; and
[`eslint-config-recommended-plus-types`](https://classic.yarnpkg.com/en/package/eslint-config-recommended-plus-types)
names `require-await` among the recommended rules it considers not universally
agreed upon.

### When to reconsider

- If the guard's count stops being a small, inspectable number.
- If `promise-function-async` is ever enabled (it is not, today) — the two rules
  directly contradict each other, and this override would need re-reading.
- If a future `async`-removal mutator lands in Stryker **and** the `mutate` glob
  grows to cover code where this pattern matters.

---

## `@typescript-eslint/no-unsafe-*` on JavaScript files — OFF for JS (2026-09-20)

**Status:** five type-aware rules turned off for `**/*.js`, `**/*.jsx`, `**/*.cjs`
and `**/*.mjs`, via one appended `overrides` entry in
`config/eslint/.peaks-rules.cjs`.

### The contradiction this fixes

`config/eslint/tsconfig.lint.json` sets `allowJs: true` with **`checkJs: false`** —
the configuration **deliberately does not establish types** for JavaScript files.
And then a **type-checked** rule family is applied to them.

**A rule that demands a property the config explicitly declines to establish is not
strictness; it is a contradiction.** There is no type there to be unsafe about.

956 findings across 23 files — 54% of the whole `no-unsafe-*` family. The five that
actually fire: `no-unsafe-member-access` 389, `-assignment` 214, `-argument` 156,
`-call` 146, `-return` 51.

### `no-unsafe-*` is a NAME, not a class

The rule names share a prefix; they do not share a mechanism. **Turning the family
off by name would have switched off checks that have nothing to do with types:**

| rule | origin | type-aware? | on JS |
|---|---|---|---|
| `no-unsafe-member-access` / `-assignment` / `-argument` / `-call` / `-return` | `@typescript-eslint` | **yes** | **exempted** |
| `no-unsafe-finally` | **ESLint core** | **no** | still `error` |
| `no-unsafe-negation`, `no-unsafe-optional-chaining` | **ESLint core** | no | still `error` |
| `no-unsafe-declaration-merging`, `-enum-comparison`, `-function-type`, `-unary-minus` | `@typescript-eslint` | **no** | still `error` |

`--print-config` was used to confirm each of the untouched rules still reports on
JS. The cut is by **type-awareness**, not by prefix.

### Reach, evidenced per (file, rule)

The way to get this wrong is to cut wider than claimed — the mirror of the guards
this repo has repeatedly found narrower than advertised. So the cut is evidenced
per `(file, rule)` rather than by totals:

| | before | after |
|---|---|---|
| TS side, type-aware family | 538 | **538** (equal) |
| TS rule map and per-file totals | — | byte-identical; **0 TS files changed** |
| JS side, non-family rules | 80 | **80** (equal) |
| JS per-file per-rule diff, 32 files | — | **not one non-family finding moved** |
| the five rules, 85 `(file, rule)` pairs | 956 | **0** |

No rule rose on either side.

### When to reconsider

If `scripts/**` is ever migrated to TypeScript, or `checkJs` is turned on for it,
this exemption stops being a contradiction fix and becomes a real hole — at which
point the type-aware family should come back for those files, and the 956 should
be treated as genuine debt rather than a category error.
