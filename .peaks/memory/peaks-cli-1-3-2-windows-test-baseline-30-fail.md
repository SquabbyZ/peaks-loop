---
name: peaks-loop-1-3-2-windows-test-baseline-30-fail
description: peaks-loop 1.3.2 Windows test baseline (30-fail)
metadata:
  type: reference
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

peaks-loop 1.3.2 baseline test failure count on Windows: 30 pre-existing failures (all `EPERM: symlink` on Windows-without-developer-mode). New slices MUST NOT introduce new failures; running `pnpm vitest run` should report 30 fail / baseline-pass ±0. The 30-fail baseline is referenced in the slice #1 tech-doc and RD artifact as the "no regression" gate.
