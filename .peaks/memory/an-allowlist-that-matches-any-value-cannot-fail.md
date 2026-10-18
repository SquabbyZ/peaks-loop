---
name: an-allowlist-that-matches-any-value-cannot-fail
description: an-allowlist-that-matches-any-value-cannot-fail
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-lint.md
---

`artifact-lint-service.ts` allowlisted `/^\s*-\s*state:/i` — ANY state value — before the placeholder
rules ran. A `- state: implemented (working tree)` line was therefore neither flagged nor parsed; the
state machine failed closed later, far from the author. The `- type:` allowlist was stricter but had
the mirror problem: a non-bare value was not allowlisted, yet no rule matched it, so it passed too.
Three RD artifacts in one session wrote `- type: feature (…)` and all three commits went green.

**Why:** an allowlist is a skip, not a validator. A pattern that matches every value of a field
expresses "never inspect this", which is the opposite of validation.

**How to apply:** if a metadata line is machine-read, validate it explicitly and skip it with that
validation — do not put a value-agnostic pattern in the allowlist. A malformed value must reach a
rule that can red.
