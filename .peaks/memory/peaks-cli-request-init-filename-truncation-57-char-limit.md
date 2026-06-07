---
name: peaks-cli-request-init-filename-truncation-57-char-limit
description: peaks request init truncates artefact filenames to 57 characters; slice #014 with a 58-char request-id hit REQUEST_NOT_FOUND until the file was renamed manually
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/txt/handoff-014-2026-06-07-remove-legacy-progress-start-surface.md
---

`peaks request init` writes the request artefact at `.peaks/_runtime/<sessionId>/<role>/requests/<NNN>-<requestId>.md` where the requestId is the slug passed via `--id`. The filename is silently truncated to 57 characters when the full name exceeds that limit. Windows supports up to 255 chars per filename, so this is a peaks-cli internal buffer, not a filesystem constraint. Slice #014 with request-id `014-2026-06-07-remove-legacy-progress-start-surface` (58 chars including the leading `003-` index prefix and trailing `.md` extension, or ~30 chars in the slug itself) hit this — the file was written as `...remove-legacy-progress-start-surfac.md` (missing the trailing 'e'), and `peaks request show` immediately returned `code: REQUEST_NOT_FOUND` because the on-disk file didn't match the request-id.

**Why:** `peaks request show` (and the rest of the state machine) looks up the artefact by the full request-id. A truncated filename is a silent inconsistency: the file is on disk but unreachable by name. The state machine does not fall back to fuzzy match. The artefact is effectively orphaned — the transition CLI cannot see it, the state field is null, the workflow is stuck.

**How to apply:**
- **For new slices**: when choosing a request-id slug, KEEP THE FULL PATH ≤ 57 CHARS INCLUDING the `<NNN>-` index prefix and the `.md` extension. Concretely: the slug should be ≤ 41 chars (57 - 14 [for `<NNN>-YYYY-MM-DD-`] - 3 [for `.md`] + 1 [for the leading dash the index adds]). Slices #012, #013 fit (49, 50 chars); slice #014 did not (58 chars).
- **For an already-orphaned slice**: `cd .peaks/_runtime/<sessionId>/rd/requests/ && mv <truncated> <full>` then `peaks request show` works again. Verify with `ls` that the new name is accepted (Windows accepts long filenames; only peaks-cli's buffer is at 57).
- **Slice #015 candidate fix**: bump the filename buffer in `peaks request init` (wherever the artefact path is constructed) from 57 to ≥ 255 (Windows max). Verify with a smoke test that writes a 100-char request-id slug.
- **Test seam**: add a regression test that calls `peaks request init --id "0000-2026-06-07-very-long-slug-that-exceeds-fifty-seven-characters"` and asserts the file is written with the full slug (no truncation).

**Related:** `commander-no-flag-sets-progress-false-not-noprogress-true` (slice #013 lesson — another case where a unit-test miss hid a real bug that QA dogfood caught).
