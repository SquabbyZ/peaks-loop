---
name: peaks-loop-forgiving-cli-filters-kind-type-outcome-fall-through-to-unfiltered-on-unknown
description: peaks-loop: forgiving CLI filters (--kind / --type / --outcome fall through to unfiltered on unknown)
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-10-session-6bcac7/txt/handoff-2026-06-10-fuzzy-matching-implementation.md
---

peaks-loop CLI subcommands that accept a structured filter (`--kind`, `--type`, `--outcome`, etc.) should treat unknown values as "no filter" rather than hard-erroring. The user-friendly behavior is: pass a typo → still get results (just from the unfiltered set) → see all entries → pick up the spelling from the result shape.

The loader layer can still throw a strict error (e.g., `searchMemory({ kind: 'no-such-kind' as ProjectMemoryKind })` returns `[]` rather than throwing). The CLI side passes `undefined` to the loader when the value isn't in the union. This split keeps the API strict (testable) and the CLI friendly (live).

Used by: `src/cli/commands/memory-commands.ts` (kind filter), `src/cli/commands/retrospective-commands.ts` (type + outcome filters).
