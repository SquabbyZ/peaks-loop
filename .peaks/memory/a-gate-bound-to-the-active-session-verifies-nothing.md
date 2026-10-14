---
name: a-gate-bound-to-the-active-session-verifies-nothing
description: A gate that enumerates the ACTIVE session verifies nothing when the work lives in another one
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-14-session-2f9323/txt/handoff.md
---

The last slice of job `backlog-9x-drain` was resumed from a **fresh** session while its six rid carriers
lived under the session that produced them. At commit, the artifact-contract pre-commit leg
(`.husky/pipeline/contract-verdict.mjs:173` → `getSessionIdCanonical`, `src/services/session/session-manager.ts:558`)
resolved `.peaks/_runtime/session.json` — the **active** binding — found **0 rids**, and permitted the commit
while saying so truthfully: *"no rid to verify … Nothing was refused"*, exit 0. Run explicitly against the
producing session, the same checker reported `complete: true` with all eight gates passed. Both sentences
were true; only one of them was a check.

**Why:** the leg's own header makes *"ZERO RIDS IS A PASS, LOUDLY"* a deliberate decision — refusing would
block the very first commit of every new project, which is how a gate dies and gets bypassed. The blind spot
is that a **live, valid binding pointing at someone else's session** is indistinguishable from a fresh one:
both are `carriers.size === 0`. There is no override either — `PEAKS_SESSION_ID` is read by five CLI commands
and by neither the resolver nor the hook, so the leg cannot be pointed at the right session by
configuration.

**How to apply:** when a job is resumed from a session other than the one that produced it, do not read the
commit hook's *"Nothing was refused"* as a pass — run
`peaks workflow verify-pipeline --rid <rid> --project . --session-id <the producing sid>` and treat **that**
verdict as the check; omitting `--session-id` consults no skip-state and falls back to the same active
binding. More generally: whenever a gate reports zero of the thing it checks, establish whether that means
"nothing to check" or "checked the wrong place" before believing either — the second reads exactly like the
first. When the two disagree, report the real check and the vacuous one separately rather than letting one
green sentence stand for both.
