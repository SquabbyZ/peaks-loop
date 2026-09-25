---
name: pnpm-version-varies-by-directory-so-a-probe-outside-the-repo-measures-a-different-pnpm
description: pnpm self-switches to the repo's packageManager pin, so `pnpm -v` differs by cwd and a probe root without that field measures a different pnpm
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-25-session-0cf437/sc/commit-msg-slice2.txt
---

`pnpm -v` is not a fact about pnpm. It is a fact about **the directory you ran it in**.

Measured 2026-09-25 on this host, two commands, same shell:

```
$ pnpm -v            # inside D:\peaks-loop   → 10.11.0
$ cd "$TEMP" && pnpm -v                      → 12.6.0
```

`package.json#packageManager` is `pnpm@10.11.0`, and pnpm **self-switches** to a directory's pin. Outside
a pinned directory the globally installed binary answers instead.

## The defect it produced

Slice 2 of job `pkg-build-guard-lows` (`rid-30cc31f7`) was **failed by QA on this alone**. The RD built a
probe workspace in `%TEMP%`, which carried **no `packageManager` field**, and measured four pnpm
invocations against pnpm **12.6.0** — a version this repository never runs. On that version the guard's
package set and the build's set agree, so the RD concluded a review finding's premise was **false** and
re-dispositioned it as ACCEPT.

QA changed **one variable** — pinned the probe root — and the premise came back: at 10.11.0 the two sets
**disagree**. The wrong conclusion had already been written into three durable texts (the module doc, the
backlog's source-of-record entry, and the re-measure trigger's axis).

The corrected finding is also **wider** than the original review said. It is not symlink-shaped: the
guard's inclusion rule is *a directory entry with a non-empty `src/`* and pnpm's is *a workspace project
with a `package.json`*. Neither is nested, so a **real** `packages/<dir>` with a manifest and no `src/`
is built and never walked — at **both** versions. Only the symlink half is version-bound.

## Why it is easy to miss

The probe **ran, printed a table, and was internally consistent**. Nothing in the output says which pnpm
produced it. A probe whose subject is version-dependent, run in a directory that does not pin the
version, produces a number that is reproducible, wrong, and looks exactly like a measurement.

## How to apply

- **Any measurement about pnpm must name the pnpm version it was taken under.** A number about a tool
  whose version varies by directory is not a fact about the tool.
- A probe workspace that must reflect *this* repository's toolchain has to carry the repo's
  `packageManager` field — run it from inside the repo, or copy the pin into the probe root. `%TEMP%` does
  not inherit it.
- If a probe contradicts a finding, **before believing it**, ask what version the probe ran under and
  whether the finding's own measurement pinned it. Here the finding was right and the falsification was
  the artefact.

Related: [[a-single-measurement-of-a-host-sensitive-command-is-not-a-fact-about-the-command]] is the same
shape on a different axis (host variance instead of toolchain version).
