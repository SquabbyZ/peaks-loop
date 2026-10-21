---
name: the-code-gate-matches-raw-path-prefixes
description: The PreToolUse code-gate denies by a raw `startsWith` on the payload's path, so `./src/x.ts` or an absolute path is ALLOWED — and it fails OPEN when the payload never arrives.
metadata:
  type: project
---

`decideGateAction` (`src/services/hooks/pre-tool-code-gate.ts`) matches the payload's path with
`matchesAny` = **`path.startsWith(family)`** (`src/`, `tests/unit/`, …), on the **raw** string that
`extractFilePath` returned. **Nothing on the gate's path normalises it** — `normalizePath`
(`src/shared/path-utils.ts`) is not called, even though CLAUDE.md requires POSIX-normalised paths.

⇒ Measured 2026-10-21 with the 4.1.13 artifact in a consumer project that has the `code-gate`
PreToolUse entry installed (an unknown caller, which must be denied):

| payload `input.file_path` | verdict |
|---|---|
| `src/hello.ts` | **deny** ✅ |
| `./src/hello.ts` | **allow** ⚠️ |
| `C:/…/consumer/src/hello.ts` (absolute) | **allow** ⚠️ |

The gate's own tests (`tests/unit/services/hooks/code-gate.test.ts`,
`tests/unit/hooks/code-gate-driver.test.ts`) use **only** the relative form
(`src/services/foo.ts`), so the other two forms are untested. **What the IDE actually sends decides
whether this is live** — that was not verifiable inside the repo.

⇒ **The fix is available and small**: normalise the path (and/or resolve it against the project root
and make it relative) **before** matching. That is shared-gate work, so it belongs to its own slice,
not to the batch-mode slice.

**Second, independent fact, same exercise:** the gate **fails OPEN** when the payload is absent or
unparseable — `reason: "empty-or-malformed-payload"`, `action: "allow"`, next action *"no stdin
payload; allowing"*. That is deliberate ("fail-open on path-missing rather than false-positive
block"), but it means **a hook invocation that fails to deliver its payload allows the edit**. It
also makes any acceptance harness that pipes the payload wrongly report *everything* as allowed — a
PowerShell pipeline to a native exe does not forward stdin the way `bash`'s does, so the payload must
be delivered by a **file redirect** (`cmd /c "node … < payload.json"`), or every case silently takes
the fail-open branch and the "acceptance" passes vacuously.
