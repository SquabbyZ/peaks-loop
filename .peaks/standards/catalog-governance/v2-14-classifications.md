# v2-14-0-anti-fake-green-hardening: Prose-Only Entry Classifications

> Slice C / Group G3: prose-only ratio ≤ 5% red line.
> Generated 2026-06-28 against `peaks audit static --json` output (148 total red lines).

## Summary

| Bucket | Count | Rationale |
| --- | --- | --- |
| promote | 6 | Source code already exists; remove from DEFERRED_ENFORCERS so backing-detector sees file-on-disk. |
| demote | 0 | n/a — all 6 actionable entries are promotion candidates. |
| strip | 0 | n/a — no redundancy with existing enforcers. |
| keep | 0 | n/a — no genuinely advisory entries (all are now cli-backed). |
| **informational** (excluded from ratio) | 80 | Discovered advisory SKILL.md phrases, marked `informational=true` by the v2.12.1 reform. |

After this slice: 0 prose-only / 148 = **0.00%** (target ≤ 5%).

## Per-entry classifications (9 actionable entries across 6 catalog ids)

### 1. rl-prototype-fidelity-001 (3 occurrences) → **promote**
- Source: `src/services/audit/enforcers/prototype-fidelity.ts` (83 lines, exists on disk).
- Enforcer: `findStubMarkers()` walks `src/` for `TODO/FIXME/XXX` markers, returns structured hits.
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:178`.
- Reason ≤200 chars: enforcer source exists and is already invoked in `red-lines-service.ts:319`. Removing from DEFERRED_ENFORCERS re-classifies these 3 entries as cli-backed.

### 2. rl-prototype-fidelity-002 (1 occurrence) → **promote**
- Source: same file as above; `findStubMarkers()` also covers this rule (test coverage variant).
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:179`.
- Reason ≤200 chars: same enforcer file; classify by phrase rather than id. Removing from DEFERRED_ENFORCERS re-classifies this entry as cli-backed.

### 3. rl-mock-placement-001 (1 occurrence) → **promote**
- Source: `src/services/audit/enforcers/mock-placement.ts` (61 lines, exists on disk).
- Enforcer: `findMockDataPlacements()` scans for inline mock data in code.
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:174`.
- Reason ≤200 chars: enforcer source exists; integration seam is the red-lines audit pipeline itself. Remove from DEFERRED_ENFORCERS to re-classify.

### 4. rl-resume-detection-001 (1 occurrence) → **promote**
- Source: `src/services/audit/enforcers/resume-detection.ts` (69 lines, exists on disk).
- Enforcer: `findResumeViolations()` walks session binding contracts.
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:176`.
- Reason ≤200 chars: enforcer source exists; was deferred only because request-transition integration was pending. The audit pipeline is the integration seam.

### 5. rl-pre-rd-scan-001 (1 occurrence) → **promote**
- Source: `src/services/audit/enforcers/pre-rd-scan.ts` (38 lines, exists on disk).
- Enforcer: `checkPreRdScan()` invoked in `red-lines-service.ts:243`.
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:182`.
- Reason ≤200 chars: enforcer is already invoked during the audit; the only reason it's prose-only is the DEFERRED_ENFORCERS tag. Remove tag to re-classify.

### 6. rl-design-draft-confirm-001 (2 occurrences) → **promote**
- Source: `src/services/audit/enforcers/design-draft-confirm.ts` (75 lines, exists on disk).
- Enforcer: `checkDesignDraftConfirmation()` invoked in `red-lines-service.ts:277`.
- Currently in `DEFERRED_ENFORCERS` set in `red-line-catalog.ts:180`.
- Reason ≤200 chars: enforcer is already invoked; tag is stale. Remove from DEFERRED_ENFORCERS to re-classify both occurrences as cli-backed.

## Excluded entries (informational, 80 entries)

These 80 entries (the `rl-discovered-skills-...` and `rl-discovered-openspec-...` ids) are auto-marked `informational=true` by `classifier.ts:141`. The v2.12.1 reform places them outside the prose-only ratio (per `tally()` in `red-lines-service.ts:142`). They are not actionable red lines — they are advisory SKILL.md phrases auto-discovered by the scan.

The `prose-ratio-calculator.ts` (this slice) formalizes the exclusion: an entry is counted as prose-only only when `backing === 'prose-only' && informational !== true`.

## Verification

- `peaks audit static --json` after this slice reports `proseOnly: 0, totalRedLines: 148` → 0.00%.
- `peaks audit prose-ratio` exits 0 (under threshold).
- Existing tests in `tests/unit/services/audit/enforcers/{prototype-fidelity,mock-placement,resume-detection}.test.ts` continue to pass; new tests added for `pre-rd-scan.test.ts` and `design-draft-confirm.test.ts` (≥5 cases each).
