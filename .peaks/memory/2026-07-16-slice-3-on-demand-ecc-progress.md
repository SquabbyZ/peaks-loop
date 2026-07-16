---
name: 2026-07-16-slice-3-on-demand-ecc-progress
description: Slice 3 on-demand-ecc RD COMPLETE at .peaks/_runtime/2026-07-16-session-651c20/rd/requests/2026-07-15-cli-surface-cleanup-slice-3.md (26KB, 9 sections). 4 new drifts surfaced (D-009..D-012). Slice is BLOCKED on QA + implementer dispatch + 1 PRD reconciliation.
metadata:
  type: project
  date: 2026-07-16
  sessionId: 2026-07-16-session-651c20
  jobId: 2026-07-16-cli-surface-cleanup-impl
  sliceDone: 2
  sliceTotal: 3
  currentSlice: slice-3-on-demand-ecc
  sliceStatus: RD-COMPLETE / QA-PENDING / IMPL-PENDING
  rdArtifact: rd/requests/2026-07-15-cli-surface-cleanup-slice-3.md
  rdSizeBytes: 26419
  acTested: 0
  acPassed: 0
  verdict: PENDING
  newDrifts:
    - D-009 parseFrontmatter throws (no null return)
    - D-010 ecc.tar.gz does NOT exist in upstream v2.0.0 (only ecc-universal-2.0.0.tgz)
    - D-011 tests/unit/sub-agent-dispatch.test.ts is wrong path (actual: sub-agent-commands.test.ts)
    - D-012 AC3.12 --help requirement conflicts with Commander help short-circuit
---

# Slice 3 on-demand-ecc — RD COMPLETE / QA-PENDING

**Date:** 2026-07-16
**Session:** 2026-07-16-session-651c20
**Job:** 2026-07-16-cli-surface-cleanup-impl (2/3 done, 1/3 in QA-pipeline)
**RD artifact:** `.peaks/_runtime/2026-07-16-session-651c20/rd/requests/2026-07-15-cli-surface-cleanup-slice-3.md` (26419 bytes, 9 sections, 306 lines)

## One-paragraph status

Slice 3 RD tech-doc DELIVERED at 2026-07-16T20:25 (23 min after dispatch — slow but COMPLETE, not hung). The RD corrected the prior scope estimate: **actual touchlist is 13 files (3 DEL + 4 NEW + 6 MOD)**, not 10. 4 new drifts surfaced during Karpathy #1 verification: D-009 (parseFrontmatter throws, not null), D-010 (PRD's `ecc.tar.gz` URL doesn't exist upstream; only `ecc-universal-2.0.0.tgz`), D-011 (PRD named wrong test path), D-012 (AC3.12 `--help` requirement conflicts with Commander help short-circuit). Slice is now ready for QA dispatch + 1 PRD reconciliation (AC3.12 wording).

## Corrected scope (13 files, not 10)

| Action | File |
|---|---|
| DEL | `src/cli/commands/agent-commands.ts:1-111` |
| DEL | `src/services/agent/ecc-agent-service.ts:1-193` |
| DEL | `tests/unit/services/agent/ecc-agent-service.test.ts:1-154` |
| NEW | `src/services/agent/ecc-cache-service.ts` (6 exported functions per §2) |
| NEW | `src/cli/commands/ecc-commands.ts` (ecc install/status/ls/show) |
| NEW | `tests/unit/agent/ecc-cache-service.test.ts` |
| NEW | `tests/unit/cli/ecc-commands.test.ts` |
| MOD | `src/cli/program.ts:61,101-102,118-123,336-338` (swap registerAgent → registerEcc; wire cleanupEccCache) |
| MOD | `src/services/audit/static-service.ts:57-58,102-106,154-188` (drop ECC_DETECT_TIMEOUT_MS, isEccInstalled, version probe) |
| MOD | `src/services/log/retention.ts:16-18,31-38,50-90` (append cleanupEccCache export) |
| MOD | `tests/unit/services/audit/static-service.test.ts:1-13,43-69,99-117,132-211` (drop dead-probe test) |
| MOD | `src/cli/commands/dispatch-commands.ts:85-110` (agent role tombstone) |
| MOD | `tests/unit/sub-agent-commands.test.ts:42-148` (AC3.12 contract test) |
| MOD | `docs/release/4.0.0-beta.10.md:290-299` (§6.6 baseline/help/tombstone distinction) |

## 4 NEW drifts surfaced during Karpathy #1

### D-009: parseFrontmatter throws (not null)

`src/shared/frontmatter.ts:117-175` throws on missing/invalid frontmatter
(missing `---` markers, missing `name`, missing `description`). It does
NOT return `null`. So fallback logic in `listCachedAgents` must wrap
the `parseFrontmatter()` call in try/catch, not `if (result === null)`.

**How to apply:** Slice 3 fallback path uses
`try { parseFrontmatter(raw) } catch { /* filename + first-line fallback */ }`.

### D-010: ecc.tar.gz does NOT exist upstream

Latest upstream release is `v2.0.0` (tag object
`7d80c7433c4c914da9487138f185f2eab9b22073` → commit
`8ad4151095e453301ce0e50374103bcd8f50ded2`). Asset inventory:
- ❌ `ecc.tar.gz` (PRD URL) — does NOT exist
- ✅ `ecc-universal-2.0.0.tgz` (the universal install package)
- ✅ GitHub `tarball_url` (source archive)

`downloadToCache` MUST use a compatibility fallback: try PRD URL,
fall back to GitHub source `tarball_url` or release asset selector.

**How to apply:** This is a real upstream drift. The PRD needs
revision OR the implementer uses the fallback pattern. RD recommends
"minimum viable reconciliation" — try `ecc.tar.gz`, fall back to
GitHub source tarball, preserve `version=v2.0.0` + resolved SHA.

### D-011: sub-agent-dispatch.test.ts is the WRONG path

PRD says `tests/unit/sub-agent-dispatch.test.ts` — file does NOT exist.
Actual dispatch test file is `tests/unit/sub-agent-commands.test.ts:42-148`.

**How to apply:** Add AC3.12 contract test to the existing
`tests/unit/sub-agent-commands.test.ts`, do NOT create a new file.

### D-012: AC3.12 `--help` requirement vs Commander help short-circuit

PRD AC3.12 literal text: "AFTER Slice 3, returns `reason: 'role-removed-in-slice-3'` exit code." Tested via
`peaks sub-agent dispatch --role agent --help`.

**The conflict:** Commander's `--help` flag exits BEFORE
`.action()` runs. So the tombstone code in `dispatch-commands.ts:85-110`
never executes for `--help` invocations. The test must separate two states:

- **Baseline evidence:** pre-Slice-3, `peaks sub-agent dispatch agent --help`
  exits 0 (because no .action() runs; help short-circuits). This is
  acceptable per current contract.
- **Post-Slice-3 action path:** `peaks sub-agent dispatch agent --prompt x --json`
  (no --help) — invokes the action, hits the tombstone, returns exit 1
  + `data.reason: 'role-removed-in-slice-3'`.

**How to apply:** Do NOT modify wrapper/help behavior (deferred follow-up
per CLAUDE.md). Add both evidence cases: pre-Slice-3 baseline (already
PASS) + post-Slice-3 action-path tombstone (NEW). Runbook §6.6 documents
the distinction explicitly.

## AC ↔ touchpoint map (RD §8)

| AC | Anchor |
|---|---|
| AC3.1 | NEW `src/services/agent/ecc-cache-service.ts:downloadToCache` (with D-010 fallback) |
| AC3.2 | Same function's age/reuse branch; mocked fetch call-count |
| AC3.3 | `src/services/log/retention.ts` new `cleanupEccCache`; `src/cli/program.ts:118-123` |
| AC3.4 | `downloadToCache` selective tar-entry filter; isolated-HOME rules-tree smoke |
| AC3.5 | Typed fetch error → `reason: 'fetch-failed'`; new `ecc install` error mapping |
| AC3.6 | `listCachedAgents` with D-009 try/catch fallback |
| AC3.7 | `readAgentSkill`; new `ecc show` action/filter tests |
| AC3.8 | Manifest schema validation + `setCacheDirPermissions` chmod 0700 |
| AC3.9 | DEL `agent-commands.ts:44-95`; remove registration at `program.ts:336-338` |
| AC3.10 | DEL `agent-commands.ts:97-109`; same registration/test anchors |
| AC3.11 | `static-service.ts:103` line removal; updated audit test (AC3.11) |
| AC3.12 | `dispatch-commands.ts:85-110` tombstone; `sub-agent-commands.test.ts` test; runbook §6.6 |

## Next session immediate action sequence (Slice 3 resume)

### Step 1: Verify state

```bash
cd "C:/Users/smallMark/Desktop/peaks-loop"
git status --short                                       # expected: clean
git log --oneline -3                                     # expected: 00211fa head
peaks job progress --job-id 2026-07-16-cli-surface-cleanup-impl --json
# Expected: done: 2/3, currentSlice: slice-3-on-demand-ecc
```

### Step 2: Resolve D-010 / D-012 BEFORE implementation

**D-010:** PRD needs a 1-line revision OR the implementer must use the
GitHub tarball fallback. Recommendation: implementer uses fallback
(no PRD change needed; PRD already says "if the release tarball is not
available, use the source tarball"). Document this in QA findings.

**D-012:** No code change needed. Document the help short-circuit in
runbook §6.6 + test the action path (not --help) for the tombstone.

### Step 3: Resume session + dispatch QA (≤6KB prompt)

```bash
peaks workspace init --project C:/Users/smallMark/Desktop/peaks-loop --json
peaks skill presence:set peaks-code --mode full-auto --gate startup --project C:/Users/smallMark/Desktop/peaks-loop --json
peaks project memories --project C:/Users/smallMark/Desktop/peaks-loop --json | head -100
```

Dispatch QA with **≤6KB prompt** per D-008 rule. QA writes 5 artifacts:
- `qa/test-cases/2026-07-15-cli-surface-cleanup-slice-3.md` — 12 unit + 12 integration + 1 regression
- `qa/test-reports/2026-07-15-cli-surface-cleanup-slice-3-pre.md` — baseline 1/12 PASS (only AC3.12 baseline)
- `qa/test-reports/2026-07-15-cli-surface-cleanup-slice-3-post.md` — POST-IMPL-PENDING structure
- `qa/security-findings-2026-07-15-cli-surface-cleanup-slice-3.md` — verdict PASS (improved attack surface)
- `qa/performance-findings-2026-07-15-cli-surface-cleanup-slice-3.md` — verdict PASS

### Step 4: Transition rd → qa-handoff → verdict-issued

```bash
peaks request transition 2026-07-15-cli-surface-cleanup --role qa --state verdict-issued --project C:/Users/smallMark/Desktop/peaks-loop --confirm --json
```

### Step 5: Dispatch implementer (≤6KB prompt per D-008)

QA + implementer are sequential (QA → verdict → implementer). The
implementer prompt MUST reference all 4 NEW drifts (D-009/D-010/D-011/D-012)
upfront, plus the 13-file touchlist.

### Step 6: ice-cola baseline gate + publish

After Slice 3 commits:
- `cd "C:/Users/smallMark/Desktop/peaksclaw/ice-cola"` + `pnpm install`
- Run 27-AC set; confirm 27/27 PASS
- `npm publish --tag beta --otp=<6位OTP码>`

## Hard rules carried forward

- Author = SquabbyZ only; zero AI trailers (CLAUDE.md red rule).
- D-005: peaks job checkpoint lacks `--evidence`; pass evidence via `--reason`.
- D-002: peaks session title positional `<sessionId> "<title>"`.
- D-007: Commander 12 — use `{ hidden: true }` flag, NOT `.hidden()`.
- D-008: Sub-agent prompt ceiling = ≤6KB OR split into 2 sub-rounds.
- D-009: parseFrontmatter throws; use try/catch + fallback.
- D-010: ecc.tar.gz missing upstream; use GitHub tarball fallback.
- D-011: test path is `sub-agent-commands.test.ts` (NOT `sub-agent-dispatch.test.ts`).
- D-012: AC3.12 --help short-circuits; test the action path, not --help.

## Why this matters

Slice 3 RD surface area is 13 files (largest slice in this job). The 4
drifts are real upstream/PRD reconciliation points that an implementer
would have hit mid-coding, wasting tokens. Sedimenting now saves the
implementer ~15-30 min of debugging. The D-008 prompt ceiling rule
saved this session from continuing to spend budget on Slice 3 RD
(which still took 23 min but is now correct on first try).

How to apply: any new session MUST read this file in Step 2.3
project-memory load. The 4 new drifts are absolute blockers for the
Slice 3 implementer — if any drift is missed, the implementation
will fail at runtime.