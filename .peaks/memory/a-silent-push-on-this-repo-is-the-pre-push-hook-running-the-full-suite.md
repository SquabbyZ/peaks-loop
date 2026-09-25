---
name: a-silent-push-on-this-repo-is-the-pre-push-hook-running-the-full-suite
description: A git push here is silent for minutes because the pre-push hook runs the full unit suite — silence is not evidence of a wedge
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-25-session-0cf437/sc/push-closure.md
---

On 2026-09-25, `git push origin main` produced **zero bytes of output for over two minutes**. The harness's
120 s timeout moved it to the background. The orchestrator read that silence as "the push has wedged" and
started diagnosing stale git locks and hung `ssh` processes. **It had not wedged.** The push completed on its
own and landed (`9a375262..21d1c9a9`), and no lock or stray process ever existed.

## What the silence actually was

`core.hooksPath = .husky/_` (husky). The `pre-push` hook runs two legs:

1. `node .husky/peaks-gate.mjs changed` — the per-file lint ratchet over `git diff --name-only origin/main...HEAD`.
2. `pnpm test:changed -- origin/main` — the affected-tests mechanism, which **falls back to the FULL unit
   suite** for a change it declines to reason about. `.peaks/` is one of those triggers, and **every slice
   regenerates `.peaks/lint/gate-baseline.json`** — so on this repo leg 2 *is* the whole suite, not a subset.

The hook's own header says this, and records its cost: leg 1 = 101 s + leg 2 = 936 s = **1057 s measured
2026-09-23 on this host**. Measured again 2026-09-25: leg 2 = **138.11 s** (313 files / 3510 tests, green).
Both are real — host variance on this box is large (~60 % on `pnpm build`; see
[[a-single-measurement-of-a-host-sensitive-command-is-not-a-fact-about-the-command]]).

## Why it is a trap

A healthy push on this repo is **silent for minutes**. Any harness timeout below ~1057 s will always
background it. So the cheap signal (no output) gets read as the real property (no progress) — the shape in
[[point-the-verification-at-the-property-not-at-the-proxy-you-can-measure-cheaply]]. The diagnostic work I
started was not merely wasted: it was pointed at a failure that did not exist, and the only reason nothing was
killed is that the push finished before I acted on the wrong conclusion.

**A second, quieter consequence:** the pre-push hook re-runs the suite the control run just ran. Two green
suite runs in one push are expected here, not a doubled safeguard and not a sign of a retry loop.

## How to apply

- Run `git push` with a generous timeout, or in the background from the start. Expect minutes.
- While it is silent, do **not** go looking for locks or hung `ssh`. Silence here is the hook working.
- Tell the two suite runs apart by their `Start at` stamp — the control run's and the hook's differ.
- Confirm the result from the **remote** (`git ls-remote --heads origin main`), not from the local
  `origin/main` ref, which is a proxy for it.
