---
name: i-fixed-the-three-places-is-itself-a-claim-and-it-is-the-one-nobody-checks
description: "I fixed the three places" is itself a claim, and it is the one nobody checks
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-f-group.md
---

A report said three doc/code inconsistencies had been corrected. Two had. The third — a module header
still describing itself as "consumed by the LLM-side runner", which the same report identified as the
module's cause of death — was still there, three lines above the "all 13 exports have zero importers"
line the report was proud of. The claim about the fix was the only claim in the report that no test,
no grep and no reviewer was pointed at.

**Why:** completing a task and describing a completed task are different acts, and the description is
written from memory of the work rather than from the artifacts. Every other claim in the report had
something to falsify it — the injection reddened, the packer printed a line. "I changed three places"
had nothing, so it passed by default.

**How to apply:** for any statement of the form "I changed/resolved/covered N things", make the report
carry the **N addresses** — file:line for each. It is a five-second addition that makes the claim
checkable, and it is the one claim most likely to be wrong. When reviewing, treat a count without
addresses as unverified rather than as summarised.
