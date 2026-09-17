---
name: the-shipped-default-for-fail-closed-strictness-is-the-user-s-call-not-the-implementer-s
description: The shipped default for fail-closed strictness is the user's call, not the implementer's
metadata:
  type: decision
  sourceArtifact: .peaks/_runtime/2026-09-16-session-5bcf09/sc/release-4-advisory-default.md
---

The user chose option C — advisory-by-default + opt-in strict (`PEAKS_CODEGRAPH_INDEX_STRICT=1`) — for the new codegraph index integrity gate. Reason given and recorded: blocking-by-default would red-light every downstream project on upgrade (any project that tracks a .mjs, any project that ever deleted a file without --force, any project that deliberately narrowed include). The implementer recorded the option and surfaced the consequences; the user chose. This is the correct shape for any new gate that is satisfied by an existing-state drift in downstream repos.
