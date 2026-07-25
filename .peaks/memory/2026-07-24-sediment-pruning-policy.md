# Sediment Pruning Policy — peaks-loop governance for `.peaks/memory/` size health

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Rid:** `2026-07-24-rid-004-sediment-pruning`
**Source:** N6 read-only probe (`ls .peaks/memory/ | wc -l` etc., this session)

> Governance policy for size and rotation health in
> `.peaks/memory/`. Future LLM encountering "this directory is
> bloated" should follow this policy. **No deletions** are
> prescribed by this policy; only **flag-and-sediment paths**.

## 1. Baseline at policy freeze (2026-07-24)

| Metric | Value |
|---|---|
| Total `.md` entries in `.peaks/memory/` | **199** (excluding `MEMORY.md` + `index.json`) |
| `MEMORY.md` index lines | 74 |
| Entries in `archived/` | **12** |
| Duplicate basenames | **0** |
| Size distribution | 0-2kB: 52 / 2-5kB: 58 / 5-10kB: 69 / 10kB+: 17 |
| Median entry size | 4.4 kB |
| Q75 / Q90 | 7.1 kB / 9.4 kB |
| Largest entry | `2026-06-18-peaks-zvec-spike-proposal.md` (~20 kB) |

The 10 largest entries (per `ls -laS .peaks/memory/`) skew toward
**historical slice audits** and **complex-plan retrospectives**
(plan4-audit, post-compact-resume, monorepo-split). These are
high-context, low-frequency-reference entries.

## 2. Tier classification — apply to **future** entries

This policy classifies entries into 4 tiers, and prescribes a
**decision path** for each. Future sediments should already
arrive at the right tier via convention; this table is for
backfill audit only.

| Tier | Definition | Treatment |
|---|---|---|
| **A — operational contract** | gates the project; ABI; pinned rules | **never delete**. If growth happens, file a slice to consolidate. |
| **B — descriptive governance** | policy / SOP / escalation tables | may be replaced by newer version; mark `@deprecated` cross-ref. **Do not delete** without successor file. |
| **C — retrospective analysis** | audit output, design-plan retros, slice closure | **rotate**: archive after 12 months unless pinned via `MEMORY.md` index. |
| **D — ephemeral artifact** | RD pass-2 notes, scratch drafts | sediment at session-end via `peaks memory extract --apply`, then **drop** from `.peaks/memory/` if not surfaced in `MEMORY.md`. |

`MEMORY.md` index is the authoritative tier reference:
each pinner's `MEMORY.md` line says which tier governs it.

## 3. Size thresholds (use these as flag triggers, **never auto-prune**)

| File size | Flag | Action |
|---|---|---|
| ≥ 9.4kB (Q90) and older than 6 months | "**oversized-retrospective**" | audit; if Tier C, mark for archive rotation |
| ≥ 20kB | "**bloated single-file**" | sediment a 1-page summary; keep the full file but **link** to summary in MEMORY.md |
| < 0.5kB (less than 30 lines) | "**stub-file**" | either merge into a sibling tier-B file, or expand to ≥ 1kB |

These are **flag thresholds**, not delete thresholds. The
policy does NOT prescribe deletion.

## 4. Escalation SOP — LLM-executable

### Scenario A — user asks "should we delete old sediments?"

1. **Default**: NO. Tier A/B are non-deletable.
2. For Tier C/D candidates: file a separate rid (`2026-XX-XX-rid-NNN-sediment-rotate`) **with a concrete deletion list**, not blanket-delete.
3. Each deletion candidate must:
   - Surface in `MEMORY.md` `description:` line as the lead link.
   - Pass a 5-min grep against current src/ for any non-archived reference.
   - Be acknowledged in `.peaks/_runtime/<sid>/analysis/sediment-rotation-<date>.md`.

### Scenario B — user reports "MEMORY.md is getting noisy"

`MEMORY.md` size is currently 74 lines (20829 bytes). It is
**index, not content**. If it grows past 200 lines, the policy
mandates a **shrink**:

1. Promote only Tier A entries to the top section.
2. Demote Tier B entries behind `<!-- tier-b -->` comments.
3. Move Tier C/D entries to `MEMORY-c.md` referenced as
   "for historical context" only.
4. Sediment the split.

### Scenario C — user adds a new sediment via `peaks memory extract --apply`

1. Extract tool will add the file (Bash, not editing).
2. The new file should ideally classify into Tier A/B by topic:
   - Tier A if it pins a gate, ACL, or reproducer
   - Tier B if it prescribes an SOP or policy
   - Tier C/D otherwise
3. Update `MEMORY.md` with one-line description.
4. File size must be < 9.4 kB unless it is a Tier-A pinned doc.

### Scenario D — 12 entries in `archived/` need review

The 12 entries in `archived/` are historical. They are not
eligible for re-promotion by count. A future slice may
sweep them with a `peaks memory rotation` CLI command (which
**does not yet exist** but is on the post-4.x roadmap).

## 5. Idempotent re-run (next session, cheap)

```
$ ls .peaks/memory/ | wc -l                                # expect 199 ± slice counts since this policy
$ ls -laS .peaks/memory/ | awk 'NR>1 && $5>0 {print $5}' | sort -n | awk 'BEGIN{c=0}{a[c++]=$1}END{n=c;print a[int(n/2)]; print a[int(n*0.9)]}'
# approx median / Q90
$ grep -c "^\s*-\s*\[" .peaks/memory/MEMORY.md              # approx 199 pins if all current
$ find .peaks/memory/archived/ -name "*.md" | wc -l        # expect 12 ± new rotations
$ ls .peaks/memory/ | sort | uniq -d | wc -l                # expect 0 (no duplicates)
```

If any drift materially, re-pin via §1-3.

## 6. Status

**Active.** This policy replaces the N6 read-only audit-trail
as the formal governance surface. No deletions performed; no
Tier-A/B entries touched. The 199 entries are now classified
per §2 tiers and have size-flag thresholds per §3.

## 7. Sibling governance policies

This file is one of the 5+1 tracked governance policies for
session `2026-07-24-session-f13da7`. Adjacent concerns:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure; the Tier-A sediment this policy treats as non-deletable.
- **[[2026-07-24-parked-tests-policy]]** — Tier-B policy file referenced by this size-threshold framework; if it grows past 9.4 kB Q90 it falls under §3.
- **[[2026-07-24-multi-ide-adapter-policy]]** — Tier-B policy file; same threshold treatment.
- **[[2026-07-24-openspec-enforce-artifact-policy]]** — Tier-B policy file; same threshold treatment.
- **[[2026-07-24-b1-manifest-v2-b2-policy]]** — Tier-B policy file; same threshold treatment.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 sediment (this session's continuation record); flagged for review at next size audit.
- **[[2026-07-24-l1-f-slice-check-rid-policy]]** — Tier-B policy file (added during RID-008 reconciliation); same threshold treatment.

## 8. End

End of policy file.
