---
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived
name: peaks-cli-request-init-filename-truncation-255-char-actual-limit
description: peaks request init artefact filename slug is silently truncated to 248 chars; the actual code cap is `MAX_FILENAME_SLUG_LENGTH = 248` in src/shared/incrementing-number.ts:50, NOT 57 as the old memory claimed
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-09-session-d9aff4/txt/handoff-021-2026-06-09-session-info-primitive-and-skill-md-consistency.md
---

`peaks request init` writes the request artefact at `.peaks/_runtime/<sessionId>/<role>/requests/<NNN>-<requestId>.md` where the requestId is the slug passed via `--id`. The filename slug is silently truncated to **248 characters** in `buildNumberedFilename` (the kebab-case transform `description.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, MAX_FILENAME_SLUG_LENGTH)`). The total filename is therefore capped at 255 chars (4-char `<NNN>-` prefix + 248-char slug + 3-char `.md` suffix), which is the Windows `MAX_FILENAME_LENGTH` ceiling; if a requestId exceeds that, the OS will surface a real `ENAMETOOLONG` from `mkdir` / `writeFile`.

**The old memory** at `.peaks/memory/peaks-cli-request-init-filename-truncation-57-char-limit.md` claimed the cap was 57 chars. That was wrong — it confused the slug with the file system component, and predated slice #015's 248-char cap. Slice 021 replaced the old memory with this one. The lesson is preserved, but with the correct numbers.

**Why:** `peaks request show` (and the rest of the state machine) looks up the artefact by the full request-id. A truncated filename is a silent inconsistency: the file is on disk but unreachable by name. The state machine does not fall back to fuzzy match. The artefact is effectively orphaned — the transition CLI cannot see it, the state field is null, the workflow is stuck.

**How to apply:**
- **For new slices**: the request-id slug should be ≤ 248 chars (the code's `MAX_FILENAME_SLUG_LENGTH`). With the `<NNN>-` numeric prefix and the `.md` suffix, the total filename is 4 + 248 + 3 = 255 chars — exactly the Windows per-component ceiling. Slices #012, #013 (49, 50 chars) and slice #014 (58 chars) all fit. The 41-char / 57-char guidance in the old memory is **not** the right number to follow.
- **For an already-orphaned slice**: `cd .peaks/_runtime/<sessionId>/rd/requests/ && mv <truncated> <full>` then `peaks request show` works again. Verify with `ls` that the new name is accepted (Windows accepts long filenames; only the kebab-case `slice(0, 248)` cap may have been hit).
- **Slice reference**: see the comment block at `src/shared/incrementing-number.ts:41-48` for the OS-cap rationale and the 4/248/3 char breakdown. The cap is the same in all environments (the function does not branch on platform); it is set to the Windows ceiling because Windows is the most restrictive.
- **Out of scope (slice 021)**: converting the silent 248-char truncation into a loud gate that rejects overlong slugs. The user explicitly locked the threshold at the current silent cap; the defensive 248-char gate is a follow-up slice if observed orphans reappear.

**Test seam:** `tests/unit/incrementing-number.test.ts` (or equivalent) should cover: a 100-char slug, a 248-char slug (passes), a 249-char slug (truncated to 248). The cap is `MAX_FILENAME_SLUG_LENGTH` (`src/shared/incrementing-number.ts:50`).

**Related:** `commander-no-flag-sets-progress-false-not-noprogress-true` (slice #013 lesson — another case where a unit-test miss hid a real bug that QA dogfood caught).
