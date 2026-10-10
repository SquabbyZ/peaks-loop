---
name: step-11-memory-sediment-is-enforced-by-prose-and-the-only-executable-check-reads-the-prose
description: Step 11 memory sediment is enforced by prose and the only executable check reads the prose
metadata:
  type: lesson
  sourceArtifact: .peaks/_runtime/2026-10-10-session-062f74/txt/handoff.md
---

The "BLOCKING on workflow complete" rule for memory sediment (`skills/peaks-code/SKILL.md` §Step 11;
`skills/peaks-code/references/step-11-memory-sediment.md`) is addressed to the LLM as prose. Nothing
executable refuses when it is skipped. Verified in this round: `peaks workflow verify-pipeline`
(`src/services/workflow/pipeline-verify-service.ts`) checks QA state and Gate H feedback promotion
over `.peaks/memory/*.md` entries whose `metadata.type` is `feedback` — it does not check that a
handoff was ever sedimented; and `peaks code emit-handoff` (`src/services/code/emit-handoff.ts`)
refuses only on the JOB ledger (`remaining > 0`), says nothing about memory, and must be invoked to
have any effect at all. The one executable thing in the repository that mentions Step 11 is
`src/services/audit/enforcers/lint-peaks-code-runtime.ts`, a linter asserting that the HEADING LINE
matching `step 11.*memory sediment` is present in `skills/peaks-code/SKILL.md` — it tests the prose,
not the act, and it stays green on a round that sediments nothing. Measured outcome for this round:
`.peaks/memory/` holds 444 markdown files and none has a 2026-10-10 mtime, i.e. zero sediment,
which is the same failure the 2026-07-03 audit found and Step 11 was created to prevent. If this
step must be truly blocking, the refusal has to move into a CLI exit code; prose cannot be the only
enforcer of a rule whose violation produces no output at all.
