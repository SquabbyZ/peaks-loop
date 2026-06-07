---
name: slice-015-fix-3-dogfood
description: Slice 015 fix 3 dogfood
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-06-07-session-84feb7/qa/test-reports/015-2026-06-07-fix-4-peaks-cli-self-bugs-and-md.md
---

This is a test memory from slice #015 fix-3 dogfood. The memories:extract --apply now writes files correctly per the slice #015 bug fix that dropped the 3rd-arg `true` default on `.option('--dry-run', ...)`. Pre-#015 the option defaulted to true so the mutual-exclusion check fired on every --apply call. The fix restores the documented side effect.
