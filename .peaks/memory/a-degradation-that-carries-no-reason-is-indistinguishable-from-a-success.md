---
name: a-degradation-that-carries-no-reason-is-indistinguishable-from-a-success
description: the RD dispatch block rendered the same fixed sentence whenever codegraph failed, and dropped the preflight note that held the upstream cause — so a broken index looked exactly like a healthy one inside every dispatch record, on every failure, for days
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-06-session-d0d50d/sediment-backlog.md
---

`src/cli/commands/dispatch-commands.ts` built the sub-agent prompt's codegraph block as
`preflight.available ? preflight.block : null`. The preflight's `note` is the only carrier of *why*
codegraph was unusable, and it was not passed. The failure branch therefore fell through to a fixed
constant in `src/services/context/build-dispatch-system-prompt.ts`:

```
## Codegraph structure

codegraph unavailable — proceeding on project-scan only.
```

`buildCodegraphPreflightBlock` has exactly one consumer repo-wide, so the note was dropped on **every**
codegraph failure, not occasionally.

The upstream was, meanwhile, saying something specific and useful — `Failed to index: unable to open
database file` — and nothing on the dispatch path repeated it. Every RD sub-agent for days ran without
the structural context the design provides them, and every dispatch record reads as though that were a
normal state.

**The transferable rule.** A degradation path that does not carry its reason converts one fault into a
silent loss of capability. The two states — "degraded, and here is why" and "degraded, reason not
obtained" — must be distinguishable, and neither may render as the text a healthy run would produce.

Fixed in `33fdefdf`: the block now carries the reason, the fallback says explicitly that no reason was
obtained, and the arms discriminate on both presence and absence (one asserts the block does *not*
contain a bare upstream line), so "some note was rendered" cannot satisfy them. Verified red before the
fix with the source files reverted and the new module left in place, i.e. as an assertion failure
rather than a load error.
