---
name: verify-a-memory-entry-s-premise-before-relaying-it-as-an-open-item
description: Verify a memory entry's premise before relaying it as an open item
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/sc/tracker-reconciliation-2026-09-10.md
---

While inventorying outstanding work, several memory entries were relayed as live blockers before
being checked. Three were stale: a release "pending CI verification" that had shipped **eighteen
versions earlier** (4.0.18 → the project is at 4.0.36), a lint slice "waiting on 4.0.16" whose
capability (`peaks lint check` / `baseline`) already exists, and a QA A/B/C decision made moot because
the option it weighed had shipped. Presenting those to the user would have manufactured work that did
not need doing, and made a healthy project look stalled.

**Why:** a memory records what was true when it was written, and nothing invalidates it later. The
older and more specific the claim, the more likely it has been quietly satisfied — the more confident
the entry sounds, the less it should be trusted without a check.

**How to apply:** before relaying a memory entry as a live decision or open item, spend one command
verifying its premise — a version number, `git tag -l`, `--help` on the command it claims is missing,
an existence check on the file it names. If the premise is gone, **mark the entry resolved in place
with the superseding evidence named** rather than deleting it: the record of what was believed, and
why it stopped being true, is worth keeping. Relate the correction, don't just drop the item.
