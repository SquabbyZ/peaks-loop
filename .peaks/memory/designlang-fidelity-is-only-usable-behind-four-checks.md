---
name: designlang-fidelity-is-only-usable-behind-four-checks
description: designlang fidelity is only usable behind four checks
metadata:
  type: reference
  sourceArtifact: .peaks/_runtime/2026-11-23-session-320f58/txt/handoff-s4.md
---

Measured on designlang 13.4.1: exit 1 means both "below --min" and "unreachable/timeout/missing
--clone" — only the below-threshold case writes fidelity.json, so the verdict must come from the
report. Two 404s score 100 with exit 0, and `--min abc` becomes NaN (exit 0 on an F page), so
trust both URLs and require HTTP 200 before spawning. `overall = round(0.6*visual + 0.4*motion)`
and static pages get motion=100, so `--min 90` only fails below visual 83 — persist visual/motion.
A baseline must be a LIVE render of the base commit served on loopback (store
`{route, baseCommit, baselineUrl}`, never an image); recorded screenshots cost visual 69 on an
unchanged page. No mask/viewport flags exist: same renderer both sides plus a serve-time
`animation:none; transition:none`, and an unstable route is skipped by the caller.
