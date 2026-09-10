---
name: two-functions-answering-what-is-the-current-session-will-drift-and-the-shadowed-one-wins-silently
description: Two functions answering "what is the current session" will drift, and the shadowed one wins silently
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-10-session-528a63/txt/handoff-defect-sweep.md
---

`getCurrentSessionId` read `.peaks/_runtime/session.json`; `getSessionIdCanonical` **preferred a
per-caller binding** and only fell back to that file. They returned **different answers**, and an
explicit `peaks workspace init --session-id X --allow-session-rebind` rewrote only the file — so the
caller binding **shadowed the rebind**, and the rebind silently did not take for every command
resolving through the other function.

Observed: `peaks session checkpoint` and `session 24h-mode` persisted into one session's directory while
`peaks job *` read another's; `session info --active` contradicted `session.json`. This was the root of
an episode that cost hours of manual rebinding, and of a recorded defect (D6) that had fixed the
*missing* `--session-id` without ever seeing the *wrong* session it then resolved to.

**Why:** two public surfaces for one question is a standing invitation to drift, and the drift is
invisible because each function is individually correct. Worse, the *less* obvious one wins — the
resolver with a priority list shadows the plain file read, so the "canonical" file stops being
canonical.

**How to apply:** when two code paths answer the same question, either consolidate them or make the
precedence explicit and tested. An explicit user/orchestrator action (here, a rebind) must invalidate
or update **every** source that shadows it. And when a symptom looks like "the wrong thing happened",
check whether two resolvers disagree *before* debugging behaviour — compare the sources directly, as
here: `cat session.json` vs the caller-binding file.
