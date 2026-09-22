# any-governance program — handoff

> Written 2026-09-23 at the end of an execution session, for whoever picks this
> up next. The repo is the record; this file is the index to it.

## Where things stand

- **HEAD `913b453c`**, working tree **clean**, **33 commits ahead of `origin/main`**
  (nothing has been pushed).
- **Ratchet ceiling: `eslintFindings = 2943`.** It was NOT tightened after batch B4
  — see "The one gap in this state" below.
- Last full `test:unit` the orchestrator ran: **311 files / 3463 passed / 0 failed
  / 3 skipped**.

### The any program is essentially closed

TS-side `no-unsafe-*` went **817 → 281 → 236 → 102 → 37**.

**The last 37 are NOT repo-side leaks.** Batch B4 named their six entries, and all
of them are **outside this repo's source** — which is exactly why an instrument
that walked 60 lines up from each finding looking for eight repo patterns found
nothing. Full detail and the per-root table are in `913b453c`'s commit message
and `.peaks/_runtime/2026-09-19-session-b7530f/rd/b4-report.txt`.

**Do not re-open those 37 as a repo cleanup.** Three of the six roots
(`@types/node`'s `Readable.on('data', cb)`, `String.replace`'s replacer,
`vi.fn()`'s `Procedure`) are 19 findings of pure parameter annotation; one root
(`fzf@0.5.2`'s `.d.ts`) is a genuine defect but needs a dependency decision; one
(`no-unsafe-finally`) is not an `any` root at all — it is **core ESLint** control
flow, swept in because the bucketer matched on the **name** `no-unsafe-*`.

## The one gap in this state

**`pnpm gate:repo` was killed by the harness for low system memory** part-way
through, so batch B4 carries **no independently measured findings total, no
per-rule census, and no full-suite run**. The agent reported 2878 findings
against the 2943 ceiling and a 309/311 full run with 2 host timeouts; those are
**its** measurements and are recorded as **unconfirmed**.

**First task next session:** re-run `node .husky/peaks-gate.mjs repo` and the
per-rule census. If 2878 holds, ratchet the ceiling 2943 → 2878. Then run the
full `pnpm test:unit`.

## The lead worth chasing first

**The host's process-spawn latency is degraded, and it is probably not Windows.**

The discriminator, from the fingerprint table in
`tests/unit/_setup/subprocess-timeouts.ts`:

| operation | measured |
|---|---|
| `process.kill(99998, 'SIGKILL')` | **0 ms** — a syscall, creates no process |
| `node -e 0` | **1.45 s** |
| `git --version` | **1.76 s** |
| `taskkill /T /F /PID <missing>` | **37–90 s** |

**Everything that CREATES a process is slow; the one thing that does not is
instant.** Pure enumeration would not spare the non-spawning path. A running
`360tray` (360 Total Security) intercepting process creation fits every data
point — and would make this fixable with **exclusions** rather than a permanent
property of the machine. It would also supersede B1/B3's "Windows process
enumeration degraded" reading.

This matters beyond test speed: it inflates every sub-agent dispatch.

## What is deliberately NOT done

Each of these is recorded in a commit message; none is a surprise:

- **The remaining manually-maintained count pins.** Batch B1 fixed that class on
  ONE guard by replacing its literals with cross-measurements (an independently
  sourced reach number plus injection arms — the working example is
  `tests/unit/standards/esm-relative-import-extension.test.ts`). B4 did the same
  for the async guard. **If you add more such guards, copy that pattern rather
  than writing a new literal** — a pin whose expectation is derived from the
  traversal it guards is a **tautology**, not a guard.
- **B4 task 1 touched 5 integration files that have never EXECUTED** — the
  integration config refuses to start against a stale `dist/`. Run `pnpm build`
  first, then those files.
- **~30 tests in annotated files still run under the global 30 s** at 15–24 s
  measured: about 30 % headroom. Thin, not red.

## The execution regime (read this before dispatching)

`.peaks/docs/slice-execution-regime.md` records four efficiency levers the user
adopted after a run that produced ~20 sub-agent-hours for −45 findings (three of
those slices produced **zero**):

1. **Batch 3–5 roots per dispatch** — verification is paid per slice, not per root.
2. **Full `test:unit` only at batch boundaries**; scoped tests inside.
3. **Pins must not need manual maintenance.**
4. **Mechanical one-line changes: the orchestrator may apply them directly** —
   with a deliberately narrow scope (a pin literal or a test `timeout`), only
   with an independently measured justification, and **always declared**. The
   declaration obligation is the load-bearing part, not the permission.

It worked: batch B2 cut **−135 findings in one dispatch**, against −45 across the
four slices before it.

## Known host flakiness — do not chase it

A wall-clock timeout **in a file you never touched** is the known host problem.
`tests/unit/_setup/subprocess-timeouts.ts` carries a **host-fingerprint table**
(S6 / B1 / B3 columns) precisely so you can tell "the host changed" from "the
tests got slower". Report such a failure; do not widen a budget for it and do not
re-open it as a regression.

The budgets were recalibrated in batch B3 by S6's own method (worst measured
member × 4), and the file documents the direction-of-error argument: an
over-generous budget costs **speed of signal**, an over-tight one costs
**correctness of signal**. The injection control still holds — a real
never-resolving promise in an annotated test still fails.
