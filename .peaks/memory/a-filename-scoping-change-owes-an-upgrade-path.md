---
name: a-filename-scoping-change-owes-an-upgrade-path
description: a-filename-scoping-change-owes-an-upgrade-path
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-18-session-dedff6/txt/handoff-thirdparty.md
---

Changing a prerequisite path to `<rid>`-scoped also changes the commit-leg acceptance key
(`backcompat-acceptance.ts`). The seed is idempotent (it returns early when the file exists), so an
existing workspace keeps the old bare entry forever. After such a change, a project initialized on
the previous version hard-fails every feature/bugfix/refactor commit until someone edits the tracked
list by hand.

**Why:** a migration written as "new installs get the new key" silently assumes there are only new
installs. The acceptance list is durable state on disk, not a derived value.

**How to apply:** when scoping a path, make the judge accept the prerequisite's own declared legacy
tiers as aliases with the same `until`, keep the seed writing the new key, and test both directions
— a pre-existing bare entry passes, a different artifact's entry still fails. The alias must come
from the table row, never from file content.
