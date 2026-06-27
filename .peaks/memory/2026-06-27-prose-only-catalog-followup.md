---
name: 2026-06-27-prose-only-catalog-followup
description: Follow-up slice (deferred from v2.12.1 patch) — triage the 89 prose-only red-lines the v2.12.0 dogfood flagged. Catalog governance work, NOT a regression.
metadata:
  priority: P3
  scope: src/services/audit/enforcers
  affects: peaks audit static prose-only ratio (60.1% vs target 5%)
---

# Prose-only red-line catalog follow-up (deferred)

## Context

The v2.12.0 self-dogfood surfaced this as a pre-existing baseline finding
(not introduced by v2.12.0):

- **`peaks audit static` prose-only ratio: 89 / 148 = 60.1%**
- Target ratio: ≤ 5%
- The 89 prose-only entries are mostly:
  - `## Deviation note:` blocks in `skills/*/SKILL.md` (marking CLI registration lag vs service-layer availability)
  - `code:` snippets inside `MUST NOT` paragraphs (illustrative, not enforceable)
  - "MUST NOT proceed" / "MUST NOT be conflated" prose without a corresponding enforcer file

## Why deferred from v2.12.1

Each prose-only entry would need one of:

1. **Promote to cli-backed**: write a new enforcer (`src/services/audit/enforcers/<name>.ts`) that mechanically checks the rule. Each enforcer = ~50 LoC + 5-10 tests. 89 enforcers ≈ 5000-9000 LoC + 500-900 tests. High blast radius — a single over-eager enforcer could block legitimate work.
2. **Demote to a low-priority catalog marker**: mark as `informational: true` so the audit-static ratio excludes them.
3. **Strip from the catalog**: if the prose-only rule is already covered by an existing enforcer (most `Deviation note` blocks are), drop the redundant entry.

Each option requires careful per-entry review. The P3-6 follow-up
slice is the right scope for that work, NOT a v2.12.1 patch.

## Proposed plan (follow-up slice, post-v2.12.1)

1. **Read the catalog dump** — `peaks audit static --json` produces 148 entries; sort by source file/line.
2. **Bucket the 89 prose-only entries** into:
   - "promote candidate" (rule has a clear mechanical check)
   - "demote candidate" (rule is informational; coverage already exists)
   - "strip candidate" (redundant; another enforcer covers it)
   - "keep" (genuinely advisory; needs no machine check)
3. **For promote candidates**, write enforcer files + tests in a multi-CC slice (`v2-12-1-prose-only-catalog-promote`).
4. **For demote candidates**, add `metadata.informational: true` to the rule + update the audit-static ratio calculation to exclude informational entries.
5. **For strip candidates**, remove from the catalog + re-run audit to confirm no coverage regression.
6. **For keep**, document the rationale + accept the 60.1% as the new baseline.

## Why this is NOT blocking v2.12.0

- The 89/148 prose-only ratio was already present in v2.11.2; the v2.12.0
  work did NOT add to it (verified by `git diff v2.11.2..v2.12.0 -- src/services/audit/enforcers/` = empty).
- `peaks audit static` still returns `ok: true`; the 60.1% is a soft metric,
  not a hard gate.
- Other L2/L3 checks (skill-parse, build:dist-version-matches-source,
  L3 orphan sessions) pass.

## Scope guard

This follow-up is its own slice. Do NOT bundle it into v2.12.1; the
promote / demote / strip decisions each need a slice plan with a
multi-CC Group A→E boundary, decision record, and a v2.12.x release
commit.

**Owner**: peaks-audit (catalog governance)
**Suggested version**: v2.12.1 or v2.13.0 (depending on blast radius)
**Suggested slice**: `v2-12-1-prose-only-catalog-promote` (multi-CC)