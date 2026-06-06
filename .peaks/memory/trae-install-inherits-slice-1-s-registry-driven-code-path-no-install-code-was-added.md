---
name: trae-install-inherits-slice-1-s-registry-driven-code-path-no-install-code-was-added
description: Trae install inherits slice #1's registry-driven code path; no install code was added
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

Slice #2's Trae support is purely "fill the table" — `peaks hooks install` for Trae users uses the same registry-driven install path as Claude, just with `dirName: '.trae'`. No install code was added. The same applies to `peaks statusline install`. This is the architectural promise of slice #1: new IDEs = 50 lines of adapter + a few tests, not a new install pipeline.
