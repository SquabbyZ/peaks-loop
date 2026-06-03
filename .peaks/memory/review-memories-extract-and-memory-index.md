---
name: review-memories-extract-and-memory-index
description: [CLOSED 2026-06-02 in e611daf] Code review findings on the 2026-06-01 uncommitted changes to project-memory-service.ts — see history for the full blocker / medium / minor list.
metadata:
  type: feedback
  closedAt: 2026-06-02
  closedBy: e611daf
  remainingMinorSlice: 2026-06-03-memory-housekeeping-minor-findings
---

This review memory is **closed**. The 3 BLOCKER + 1 MEDIUM + 1 of 3 minor findings were addressed in commit `e611daf` (2026-06-02 00:04, "feat(memory): hot/warm index + session extract with idempotency and --dry-run/--apply parity"). The remaining 2 minor findings (magic numbers in `summarizeMemoryBody`, read-side regeneration in `readMemoryIndex`) are addressed in slice **2026-06-03-memory-housekeeping-minor-findings**.

For historical context, see the original full review body via `git show e611daf -- .peaks/memory/` (the file's original location was the same `.peaks/memory/...` path, flat layout — no `hot/feedback/` subdir ever existed).

**Why closed:** All BLOCKER findings must be fixed before a memory goes live; the BLOCKERs are gone. Review-of-uncommitted-changes memories should not remain in the hot tier after the change lands.

**How to apply:** Do not re-introduce this memory as a live blocker. If a future change touches `project-memory-service.ts` extract paths, run a fresh review rather than consulting this closed record.
