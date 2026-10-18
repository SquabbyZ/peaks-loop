---
name: a-missing-prerequisite-must-read-as-a-prerequisite
description: a-missing-prerequisite-must-read-as-a-prerequisite
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-rootdist.md
---

`verify-codegraph-tarball.test.ts` read the repo-root `dist/` but asserted only on the script's exit
code, so an unbuilt tree produced `expected 1 to be +0` — indistinguishable from a broken whitelist.
The statusline suite next to it already threw `Run "pnpm build" in the repo root before running this
test.`; the tarball suite did not. A shared `assertBuiltPath` now makes the missing build name itself.

**Why:** a failure whose message does not name its cause sends the reader to the wrong file. The
cost of not building implicitly (≈9–14 s) is a deliberate call; the message is what makes that call
safe.

**How to apply:** when a test consumes build output rather than `src/`, assert the artifact exists
before the assertion that consumes it, and name the path and the build command. Do not add an
implicit build to fix the message.
