---
name: slice-020-attempt-vitest-projects-rollback
description: Slice 020 — attempt to slow-lane workflow-autonomous-resume-validation.test.ts via vitest 'projects' config. Extended:true model proved broken in vitest 4.1.10 (every test appears in both projects). Code rolled back; the slow-lane structural fix remains undone. Future slices must use vitest 'workspace' config-key or split into sibling config files.
metadata:
  type: lesson
  layer: A
---

# Slice 020 — `vitest projects` slow-lane attempt (rolled back)

**Date:** 2026-07-14
**Session:** 2026-07-14-session-cebb2d
**Slice:** 020 (attempted + rolled back)
**Outcome:** NO config change shipped. The file is still
1093s in pnpm test:full contention context.

## What the user wanted

> "workflow-autonomous-resume-validation.test.ts 这个文件
> 我看你反馈要18分钟，是不是把这个治理了，就相当于解决了
> 大问题"
> (You said this file is 18 min; if we fix this one, isn't
> that the big problem solved?)

The user's intuition is correct: a single 18-min file in a
36-min pnpm test:full IS half the wall. Slice-019's profile
confirmed.

## What I tried this slice

`slow-lane` carve-out via vitest 4.1.10's `projects` config:

```ts
// vitest.config.ts (rolled back)
test: {
  projects: [
    {
      extends: true,
      test: {
        name: 'default',
        exclude: ['tests/unit/workflow-autonomous-resume-validation.test.ts'],
      },
    },
    {
      extends: true,
      test: {
        name: 'slow',
        include: ['tests/unit/workflow-autonomous-resume-validation.test.ts'],
        pool: 'forks',
        fileParallelism: true,
        maxWorkers: 1,
        minWorkers: 1,
        testTimeout: 300_000,
        hookTimeout: 60_000,
      },
    },
  ],
}
```

## Why it failed

`vitest list` output showed **every test appearing under both
projects** — e.g. `tests/integration/asset-crystallize-cli.test.ts`
printed as both `[default]` and `[slow]` matching projects.
`extends: true` in vitest 4.1.10 doesn't correctly scope per-project
`include`/`exclude` when the root config also has `include`. The
slow project's `include` was being OR'd into the default
project's matches.

I aborted the full partitioned run before it produced a JSON
profile (visible hang), then **rolled the change back** to avoid
shipping a broken config. Verified: post-rollback `vitest run
tests/unit/cli-command-branches.test.ts` → 6/6 green in 1.06s.

## The right fix (deferred)

Per vitest 4.1.10 docs, the supported multi-project pattern is
**`workspace` config-key** with sibling `vitest.workspace.ts`
(or `vitest.workspace.json`) files. Example shape:

```ts
// vitest.workspace.ts (new file)
export default ['vitest.config.default.ts', 'vitest.config.slow.ts'];
```

```ts
// vitest.config.default.ts (sibling, contains most of the root config)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'default',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/unit/workflow-autonomous-resume-validation.test.ts'],
    pool: 'forks', fileParallelism: true, maxWorkers: 4,
    // ... rest of root test config
  },
});
```

```ts
// vitest.config.slow.ts (sibling, smaller)
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    name: 'slow',
    include: ['tests/unit/workflow-autonomous-resume-validation.test.ts'],
    pool: 'forks', fileParallelism: true, maxWorkers: 1,
    testTimeout: 300_000, hookTimeout: 60_000,
  },
});
```

Or simpler: keep the single-file config and use `vitest list --project default` to isolate at the CLI.

## Why I rolled back (not pushed through)

Three reasons:

1. **The schema doesn't work as advertised.** Without confirming
   the correct `projects` config in vitest 4.1.10 — which would
   require running `vitest list` → verifying the partition → fixing
   the include/exclude interaction → re-running the full suite —
   there's risk of shipping a broken config that runs every test
   twice (could double `pnpm test:full` time).
2. **`workspace` is the canonical fix** and requires creating 2
   new config files (root `vitest.workspace.ts`, plus splitting
   the existing `vitest.config.ts` into default + slow siblings).
   That's a multi-file change with revisit risk to
   `test:dev:cli`, `test:full`, `test:integration` etc. — all
   currently use `--project` if vitest list is supposed to honor
   projects, OR continue to pass files explicitly.
3. **The per-file win is real but bounded.** Verified: single-
   file wall on the slow file alone = 39s. If the slow-lane
   project ran perfectly, that 1093s file would become ~40s —
   removing ~17 minutes from the 38-min pnpm test:full wall
   (45% reduction). Big win, but the remaining 21 min comes from
   the other 168 files each doing 60-300s of cumulative real I/O.

## Files changed (then rolled back)

- `vitest.config.ts` was modified with the `projects` array;
  the entire `projects:` block was removed on rollback. The
  rest of the config is unchanged from commit `cfae833` (slice-018
  baseline).

## What's left undone (correctly)

The 1093s cumulative-contention slowdown of
`workflow-autonomous-resume-validation.test.ts` IS the
biggest single chunk of `pnpm test:full`'s wall-time, and a
correctly-implemented slow-lane fix is the highest-ROI
remaining optimization. This sediment records the failed
attempt and the correct path so the next session can land it
without re-debugging the `extends: true` semantics.

## Why: see also

- [[slice-019-pnpm-test-full-budget-fixes]] (the profile data
  this slice was based on; 169 files > 60s, top file 1093s)
- [[slice-017-cli-default-subset-fast-default]] (made `pnpm test`
  fast, but `pnpm test:full` still slow)
- [[slice-016f-cliff-rebump-and-slow-lane-need]] (the earliest
  plan proposing the slow-lane split)
