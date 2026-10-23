---
name: a-difference-between-two-artifacts-is-not-a-change-between-two-versions
description: a difference between two artifacts is not a change between two versions
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-22-session-b0e6e2/txt/handoff-t1-backlog-2026-10-23.md
---

Measured 2026-10-23 (T1 backlog campaign, `rid-t1-ide-payload-cwd`). An earlier revision of the §19.5
backfill block stated that "the 2.1.308 → 2.1.309 delta: the declared base hook-input schema no longer
names `scratchpad_dir`, `served_call` or `caller_session_id`". Comparing both binaries byte for byte
afterwards showed the opposite: the DECLARED schema literal is byte-identical in the two versions
(1,525 bytes, sha256 `331a86f1…`) and so is the top-level key list (170 bytes, sha256 `7d48c684…`). The
declared schema names none of the three in EITHER version; the key list names all three in BOTH. The
"delta" was a comparison of the declared schema against the key list — two different things inside ONE
version — reported as a change between two versions.

**Why.** The sentence was on its way into a committed document, and it was false against both binaries.
A version claim has to be earned by comparing the two versions TO EACH OTHER, with the same extractor
on both sides.

**How to apply.** Before writing "X changed between A and B", produce the A-vs-B measurement. If the
difference you are looking at is between two artifacts of the SAME version, it is a fact about the
artifact set, not a version delta — say so instead. And when a false claim has to go, REMOVE it rather
than reword it: a reworded false claim is still false, and the artifact should say that it was removed
and why, so the next reader does not reintroduce it.
