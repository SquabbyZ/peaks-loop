---
name: a-new-src-file-over-300-lines-breaks-the-file-size-ratchet
description: The `src/` file-size cap is 300 RAW lines counted as `split('\n').length` — one MORE than `wc -l` — so a 405-line file raises two ratchet ceilings and the baseline refuses to be written.
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-20-session-f7f45b/rd/requests/2026-10-21-race-batch-mode.md
---

The file-size policy in `.peaks/lint/gate-baseline.json` is:

```json
"fileSizePolicyInputs": { "defaultCap": 300, "testsCap": 500, "scopeDirs": ["src","tests","packages","scripts"] }
```

and the census counts a file as `readFileSync(f,'utf8').split('\n').length` — which is **one more
than `wc -l`**, because the trailing newline makes a final empty element. So `wc -l` must be
**≤ 299** for a `src/` file to be under the cap, and `wc -l` of exactly 300 is already over it.

**Why being over the cap is worse than looking over the cap.** A new over-cap `src/` file raises
**two** ceilings — `fileSizeOverCap` and `fileSizeExcessLines` — and a ratchet that may only go DOWN
**refuses to be written**. The generator prints `monotonicity: every ceiling held`; when a ceiling
rose it does not, and the baseline cannot be committed, so the gate goes red. On 2026-10-21 a
sub-agent delivered a 405-line `src/services/batch/batch-fix.ts` (`wc -l`), all of its own tests
green, `tsc` clean — and the slice was unmergeable until the file was split.

**The fix is to split the file, never to raise the ceiling.** A ceiling that can be raised is not a
ratchet. The repo's own pattern for this is `job-commands.ts` + `job-add-slice-command.ts` +
`job-checkpoint-commands.ts` — split by responsibility, each under the cap.

**The check is cheap and it belongs before the commit, not after:**
`wc -l <file>` then **+1** and compare with 300 (`src/`, `packages/`, `scripts/`) or 500 (`tests/`).
The full census is `node .husky/peaks-gate-baseline.mjs`, and the line to read is
`file-size: … src 77, tests 33, … 33365 excess lines` — those numbers must not move.

Note the `tests/` cap is 500, and the same `+1` applies. See
[[the-gate-baseline-has-one-owner-the-orchestrator]] for who may refresh the baseline.
