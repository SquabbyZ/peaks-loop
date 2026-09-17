---
name: it-reddens-and-it-misses-nothing-are-two-different-claims-and-only-the-first-gets-tested
description: "it reddens" and "it misses nothing" are two different claims, and only the first gets tested
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-e-group.md
---

A new guard was accepted on the strength of two mutations that both reddened it. A third mutation —
different in kind — reddened **nothing**: `package.json#files` could name a path that does not exist,
and 63 tests passed. Nothing in the repo read that array. The guard was fine; the claim "the guard
works" had been silently widened to "the area is covered".

The same slice then demonstrated the gap was live: it had moved a published contract out of `docs/`,
and the only reason the package still ships it is that a human updated the one `files` line by hand.

**Why:** a mutation test answers "can this fail?", which is cheap to ask and cheap to satisfy. "What
does this not look at?" has no bound — you cannot enumerate the absences by trying inputs. So the
first question gets asked, the second does not, and a passing mutation battery reads as coverage.

**How to apply:** after a guard is proven falsifiable, ask separately **what class of defect it was
never pointed at** — a different file, a different layer, a config file rather than code. And when a
slice involves hand-syncing two artifacts (a `files` list and a directory, a manifest and its
contents), ask what would notice a miss; if the answer is "the person doing it", that is the guard to
write.
