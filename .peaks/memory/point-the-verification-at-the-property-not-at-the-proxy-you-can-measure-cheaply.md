---
name: point-the-verification-at-the-property-not-at-the-proxy-you-can-measure-cheaply
description: Point the verification at the property, not at the proxy you can measure cheaply
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-09-24-session-b714c7/txt/handoff.md
---

Stated once in `.peaks/docs/backlog.md` §0: **"A cheap approximation replaced a real property, and then the
approximation was never checked again."** It recurred **four times in one session** (`rid-muf2sasw`) and **each
instance was caught by a different agent than the one who made it**:

1. an import count taken by `grep -rl`, which counts *mentions* of a name, not imports (48 vs the 10 real
   specifiers);
2. a content digest that proved the **source** side while the **emit** went unchecked;
3. an `eslint` exit code standing in for the commit ratchet's per-file standard;
4. one timing standing in for a host-sensitive command whose real spread was ~60 %.

The actionable form is not "be careful". It is two rules. **Name the property, then check the command reads that
property** — if the check could return the same answer when the property is false, it is a proxy (this is why
§2.12's guards report `fresh` over a tree missing a nested emit: "it can fail" and "it misses nothing" are two
different claims, and verification is usually pointed at the first). And **route the check through an agent that
did not write the thing** — all four above were caught only because the author was not the verifier, so a
self-review that passes is not evidence that the property holds.
