# L1.F Policy — `peaks slice check --skip-tests` requires `--rid`

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Author:** MiniMax (Opus 4.8) — owner-takeover ACTIVE
**L1 source:** `.peaks/_runtime/<sid>/analysis/l1-index.md` §1 row L1.F

> Governance policy for the `peaks slice check --skip-tests`
> symptom. Closes the L1 coverage gap flagged in
> `readiness-check-2026-07-24.md` §"L1 symptom coverage audit".

---

## 1. What the symptom is

Running:

```
$ peaks slice check --skip-tests
SLICE_CHECK_FAILED: No --rid supplied. Pass --rid <id> on the CLI
to identify which slice to check.
```

This is the documented behavior of the `peaks slice check`
command: it requires `--rid <id>` to identify which slice
artifact to inspect. The error message is intentional and
correct — the CLI cannot infer which slice without the
explicit `--rid`.

## 2. Why this is policy (not a bug)

The L1.F row in `l1-index.md` was marked "catalog-only" with
"no governing policy" because the symptom does not represent
a bug, regression, or governance failure. It is the **expected
exit-1 path** when `--rid` is absent.

The reason this row deserves a policy at all (vs being
deleted from the L1 index) is that future LLMs encountering
this error message in CI logs or during slice work might
mistake it for a real failure. The policy below prescribes
the canonical escalation path.

## 3. Escalation SOP — LLM-executable

### Scenario A — `peaks slice check` exits with `--rid` missing

1. **Default**: this is the documented behavior. **Do not**
   file a bug, **do not** edit CLI code, **do not** patch
   the slice-check service to default `--rid`.
2. Pass the correct `--rid <id>` for the slice you are
   checking. The format is the change-id slug, e.g.
   `--rid 2026-07-24-rid-001-b1-n4-parked-governance`.
3. If you do not know which `--rid` to pass, list candidates
   with `peaks slice ls` (slice-list CLI primitive).
4. Sediment under `.peaks/memory/<date>-slice-check-rid-context-<slug>.md`
   with `[[2026-07-24-l1-f-slice-check-rid-policy]]` backlink
   if the situation was non-trivial (e.g. `--rid` was missing
   from a tracked CI script that was failing silently).

### Scenario B — user asks "should we make `--rid` optional?"

**No** by default. The `--rid` is a **load-bearing identifier**
that distinguishes slices in the artifact directory
`.peaks/_runtime/<sessionId>/<role>/requests/<rid>-<change-id>.md`.
Making it optional would either:
- Force the CLI to guess (introduces ambiguity),
- Force a fallback to the `.peaks/_runtime/current-change`
  binding file (which is itself session-id-keyed, not
  change-id-keyed — wrong axis), or
- Introduce a default like "first slice in directory" (breaks
  determinism).

The only legitimate de-`--rid` path is a tracked PRD that
explicitly proposes a slice-binding resolver with a
verifiable default. Until then, `--rid` is mandatory.

### Scenario C — user reports "the error message is unclear"

If the user finds the message "Pass --rid <id> on the CLI to
identify which slice to check" insufficient:

1. File a slice to improve the message; the canonical
   location is `src/services/slice/slice-check-service.ts`
   (the envelope-writer for slice-check failures).
2. The new message must include: (a) the literal `--rid`
   flag, (b) an example valid value, (c) a pointer to
   `peaks slice ls` for the list.
3. **Do not** relax the requirement itself; only improve the
   error envelope.

### Scenario D — non-anchoring concern (G1 audit-trail)

If this policy file goes missing (ephemeral layer cleared,
search engine cannot find it), re-bootstrap from
`.peaks/memory/MEMORY.md` index line for this file, or rerun
the L1-checklist at
`analysis/l1-index.md` §1 row L1.F.

## 4. Idempotent re-run (next session)

```
$ peaks slice check --skip-tests                                     # expect SLICE_CHECK_FAILED (exit 1) + envelope
$ peaks slice check --skip-tests --rid 2026-07-24-rid-001-b1-n4-parked-governance  # expect valid slice-check run
$ peaks slice ls --json | head -3                                     # expect ≥1 entry (catalog reference)
$ cat .peaks/memory/MEMORY.md | grep "2026-07-24-l1-f-slice-check"    # expect ≥1 hit
```

If file paths or behavior diverges unexpectedly, re-pin via
§3 of this policy.

## 5. Status

**Active.** This policy closes the L1.F coverage gap that was
flagged in `readiness-check-2026-07-24.md` §"L1 symptom
coverage audit". The L1.F symptom row in
`analysis/l1-index.md` §1 should now read "policy-only (no
bug, no fix)" instead of "catalog-only".

## 6. Sibling governance policies

This file is the 8th tracked governance policy for session
`2026-07-24-session-f13da7`. Adjacent concerns:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure; orthogonal to slice-check.
- **[[2026-07-24-parked-tests-policy]]** — parked-tests governance; orthogonal to slice-check (but parked-tests scenarios interact with `peaks slice check` when re-pinning).
- **[[2026-07-24-multi-ide-adapter-policy]]** — adapter field verification; orthogonal to slice-check.
- **[[2026-07-24-openspec-enforce-artifact-policy]]** — OpenSpec apply gate; orthogonal to slice-check.
- **[[2026-07-24-sediment-pruning-policy]]** — memory size health; relevant if this policy grows past 9.4 kB Q90.
- **[[2026-07-24-b1-manifest-v2-b2-policy]]** — RID-008 Tier-1.1 inline PRD; orthogonal to slice-check.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 closure record; documents when this policy was filed.

End.