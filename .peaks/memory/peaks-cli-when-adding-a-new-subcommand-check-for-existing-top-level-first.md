---
name: peaks-cli-when-adding-a-new-subcommand-check-for-existing-top-level-first
description: peaks-cli: when adding a new subcommand, check for existing top-level first
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-10-session-6bcac7/txt/handoff-2026-06-10-fuzzy-matching-implementation.md
---

In peaks-cli, each top-level command (`peaks memory`, `peaks retrospective`, etc.) is registered in exactly one place. If a slice needs a new subcommand under an existing top-level, the new subcommand's `.action(...)` registration must be added to the file that already owns the top-level — NOT registered as a new top-level.

Concrete example: T5 of the fuzzy-matching slice initially registered a duplicate `program.command('memory')` in `memory-commands.ts`, which collided with the existing `peaks memory` registration in `core-artifact-commands.ts`. The fix was to delete the duplicate top-level and add the `peaks memory search` subcommand to the existing `peaks memory` cluster in `core-artifact-commands.ts` (using a lazy import inside the `.action` handler to avoid an import cycle).

Diagnostic: startup error "cannot add command 'X' as already have command 'X'" means two files are trying to register the same top-level.
