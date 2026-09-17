---
name: a-fix-script-that-matches-on-an-id-format-it-half-knows-will-skip-rows-without-saying-so
description: A fix script that matches on an id format it half-knows will skip rows without saying so
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-09-17-session-607ead/txt/handoff-rid-c-group.md
---

A script correcting a markdown table against `results.json` matched row ids as `L01` and table rows as
`L1`, so every **single-digit** row failed to match and was **silently skipped**. Seven rows kept the
stale values the script existed to correct — and the script's own summary reported success. The fix
had to be fixed.

**Why:** it is the same silent-no-op shape as the defects the script was correcting: a partial match
returns "nothing to do", not "I could not find this", and the two are indistinguishable in the output.
A row that does not match looks exactly like a row that is already correct.

**How to apply:** when a script joins two representations, **assert the join count** — expected rows
matched vs rows in the input — and fail loudly on any gap. Here the giveaway was available: the script
touched 14 of 21 rows when the table had 21. Pair it with the diff trick that would have caught it
immediately: compare the *whole* table against the source and require zero differences, rather than
updating rows one at a time.
