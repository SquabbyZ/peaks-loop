---
name: a-dependency-whose-backend-was-replaced-must-be-checked-for-ability-not-for-the-label
description: removing a native addon moved a production dependency onto a fallback backend that could not open the database it already had — the commit checked the backend's NAME in status output and stopped; codegraph stayed broken for days with every RD dispatch silently degraded
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-06-session-d0d50d/sediment-backlog.md
---

`5dfc5362` (2026-10-05) removed `better-sqlite3` from peaks-loop's own dependencies and from
`.npmrc`'s `onlyBuiltDependencies`, as part of moving peaks-loop's own stores to `node:sqlite`.
Its message records the consequence it foresaw, and stops there:

> "Upstream codegraph still carries it as an OPTIONAL dep over its own `node-sqlite3-wasm`, so
> `peaks codegraph status` keeps saying "Backend: wasm"; **that is not a regression from this change**."

What it checked was the **label** the dependency prints about itself. What it did not check was
whether the fallback backend could **open the database that already existed**.

It could not. Measured with a control on this host: `node-sqlite3-wasm` opens a DELETE-mode
database (exit fine) and fails on a WAL-mode database with `unable to open database file`. The
repo's `.codegraph/codegraph.db` had been written on 2026-10-02 by the native backend, i.e. in WAL
mode (header bytes 18/19 = 2). So from 2026-10-05 onward nothing could read it, `peaks codegraph
status` and `index` failed, every RD dispatch was degraded to "codegraph unavailable — proceeding
on project-scan only", and every slice checkpoint's auto-refresh failed too.

**Why the addon could not simply be restored:** on Node v24.21.0 (ABI 137) `better-sqlite3@11.10.0`
publishes no prebuilt binary, so `prebuild-install` falls through to `node-gyp`, which needs Visual
Studio and fails with `Could not find any Visual Studio installation to use`. This is not a property
of one machine; it is the state of the ecosystem for that pair. Restoring the addon is not a fix.

**The transferable rule.** When a dependency's backend or driver is replaced — by the dependency
itself, by you, or by a transitive install decision — "the new backend starts" and "the new backend
can read the data we already have" are two different assertions, and only the second one is what a
real user hits. The first is what the status line prints. Check the second, with a control, before
believing the first.

**Superseded in fact, not in lesson:** upgrading to codegraph 1.6.2 removes this particular failure
(1.6.2 uses Node's built-in `node:sqlite` with full WAL). The lesson survives the fix.
