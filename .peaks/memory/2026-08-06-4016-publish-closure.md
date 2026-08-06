---
name: 4016-publish-closure
description: peaks-loop 4.0.16 publish closure sediment (ESLint JS/TS Gate + OCR 1.8.x multi-language reviewer + lint strictification)
metadata:
  type: publish-closure
  scope: project-level
  effective: 2026-08-06
  related-rid: 2026-08-06-eslint-strict-metrics (PRD-002b) + 2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild (PRD-002)
  related-memories:
    - 2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild-sediment
    - 2026-08-06-prd002b-qa-cycle3-blocked-on-pre-existing-flakes
    - incremental-first-no-touch-stockcode-rule
---

# peaks-loop 4.0.16 publish closure — 2026-08-06

## TL;DR

**4.0.16 published to npm at `https://registry.npmjs.org/peaks-loop/-/peaks-loop-4.0.16.tgz`**. 11 commits on main, 26 files, +1509/-960 LOC. 8 NEW CLI capabilities. QA verdict-issued (manual override cycle 3 on pre-existing test timeouts). User global `npm i -g peaks-loop@4.0.16` 成功，`peaks --version` reports 4.0.16.

## Final state

- **main HEAD**: `2068df89` (chore(release): bump to 4.0.16)
- **tag**: `v4.0.16` (created + pushed)
- **npm registry**:
  - `peaks-loop@4.0.16` ✅ published (dist.tarball + dist.integrity + dist-tags.latest)
  - `peaks-loop-shared@0.0.47` ✅ lockstep published (auto-bumped by `scripts/release-pack.mjs`)
  - `peaks-loop-mut@0.1.19` + `peaks-loop-shared-channel@0.0.23` also lockstep
- **PR-002 + PR-002b + version bump = 11 commits**, all with:
  - Empty trailers (no Co-Authored-By)
  - SquabbyZ sole-author
  - Total +1509/-960 LOC
- **User smoke test**: `peaks --version` → `4.0.16`; `peaks lint --help` + `peaks code-review --help` 可见子命令

## 9-step publish recipe execution

| Step | Result | Note |
|---|---|---|
| 1. peaks version bump 4.0.16 | ✅ | Manual edit (peaks version is read-only). Bumped package.json + peaks-loop-shared/package.json + src/version.ts |
| 2. CHANGELOG.md 4.0.16 entry | ✅ | 8 NEW CLI + 3 NEW runner options + rule severity + OCR clear-zero + 7 binding decisions + 5 pre-existing timeouts |
| 3. peaks-loop-shared lockstep | ✅ | 0.0.45 → 0.0.46 manually, then 0.0.46 → 0.0.47 auto-bumped by publish workflow |
| 4. pnpm build | ✅ | exit 0, build-integrity OK |
| 5. npm pack --dry-run | ✅ | peaks-loop-4.0.16.tgz 2.1MB / 1573 files |
| 5b. version bump commit | ✅ | 2068df89 on main, no trailer |
| 6. git tag v4.0.16 | ✅ | tag created |
| 7. git push origin main v4.0.16 | ✅ | tag pushed, publish.yml auto-triggered |
| 8. npm view peaks-loop@4.0.16 | ✅ | version 4.0.16, integrity sha512, deps include peaks-loop-shared 0.0.47 (inlined via pnpm pack --no-workspace) |
| 9. user smoke test (global npm install) | ✅ | peaks --version 4.0.16; CLI surface verified |

## 8 NEW CLI capabilities shipped

1. `peaks lint` (parent, un-hidden) — JS/TS ESLint verifier for peaks-rd Gate B5
2. `peaks lint check` (default) — diffOnly + baseline waiver + redLine
3. `peaks lint baseline` — one-shot full-repo scan → .peaks/lint/baseline.json
4. `peaks lint detect-eslint` — 5-state probe for npx availability
5. `peaks lint --red-line` (or `peaks lint check --red-line`) — generates .peaks/memory/lint-redline-summary.md
6. `peaks code-review detect-ocr-18` — 5-state probe for OCR 1.8.x install + LLM config
7. `peaks code-review run-ocr-18 --language <py|go|java|rust|cpp|csharp|ruby|php>` — 8-language multi-language reviewer
8. `peaks code-review ocr-18-delegate-preview` — Delegation Mode (no LLM key required)

## Lessons for next publish

### Lesson 1 — `peaks version` is read-only; bump manually

`peaks version` does NOT support bump. The convention is to edit 3 files manually:
- `package.json` (root)
- `packages/peaks-loop-shared/package.json` (lockstep)
- `packages/peaks-loop-shared/src/version.ts` (CLI_VERSION)

Future: a `peaks version bump 4.0.17` command would be useful (reads from `git tag --list 'v*.*.*'` and `peaks-loop-shared/package.json` to enforce lockstep + gate).

### Lesson 2 — lockstep shared auto-bumps at publish time

`scripts/release-pack.mjs` (driven by `gate-cli-version` step in publish.yml) **auto-bumps** `peaks-loop-shared` from local manifest to whatever satisfies the lockstep invariant. Result: I expected peaks-loop-shared@0.0.46 to publish (since I bumped 0.0.45→0.0.46), but actual was 0.0.47 (auto-bumped by the publish workflow on my behalf). **This is good** — the publish workflow enforces the invariant rather than relying on manual bump accuracy.

### Lesson 3 — pre-publish `npm pack --dry-run` is mandatory

`npm pack --dry-run` on the root of the peaks-loop monorepo (run AFTER `pnpm build`) confirms:
- Tarball name + version
- File count (1573 for 4.0.16)
- Internal `peaks-loop-shared` inlined as the right lockstep version
- Integrity shasum/sha512
- Dependency declarations

This is the only way to catch "I forgot to bump peaks-loop-shared" before pushing the tag.

### Lesson 4 — peer agent reports can be misleading; verify against ground truth

QA cycle 3 had 3 false positives (F6-1 "lint not in help", F6-6 "peaks code visible", "baseline modified"). The peer agent's automated report missed the actual fix. **Ground truth verification by main LLM** (running `peaks --help` + `git show --stat` + `git status`) saved the slice from being reverted.

Lesson: when a peer report says BLOCKED, always ground truth verify the most critical claims before acting.

### Lesson 5 — 5 pre-existing test timeouts are NOT blockers

`auto-compact-orchestrator.test.ts:270` + `session-binding-bridge-path-canonicalize.test.ts:117` + `statusline-cli-integration.test.ts:895` + 2 others (full-suite-only) were flagged as "blockers" by QA cycle 3. They are PRE-EXISTING (documented in cycle 1 + 2 reports). Future slice: `2026-08-06-fix-pre-existing-test-timeouts` should fix them as a separate concern.

## Decision log (7 binding decisions, all honored)

| # | Decision | Verdict |
|---|---|---|
| D1 | 与 4.0.16 同 release | ✅ honored |
| D2 | 成本不限，1 slice 不分拆 | ✅ honored (2 feature + 1 test + 1 fix) |
| D3 | lint 给 LLM 用 | ✅ honored (redLine envelope + lint-redline-summary.md) |
| D4 | 增量优先 | ✅ honored (diffOnly: true default + Test 1 locks) |
| D5 | 不主动碰存量 | ✅ honored (baseline waiver + diffOnly filter) |
| D6 | baseline 按项目生成 | ✅ honored (Section 7 + SKILL.md Gate B5) |
| D7 | 下游不另起 slice | ✅ honored (`npm update peaks-loop` propagates) |

## 3 QA cycle history

| Cycle | Verdict | Notes |
|---|---|---|
| 1 | BLOCKED on B1 | RD changed default subcommand (detect-eslint → check); test didn't follow |
| 1-repair | ✅ | 4-line test-only fix in `61cbe9e1` |
| 2 | verdict-issued | 7/7 AC PASS, F6 found (CLI surface hidden) |
| 2-repair | ✅ | Single-line un-hide in `54adb30a` |
| 3 | BLOCKED (false positive) | 5 pre-existing timeouts elevated to blockers; F6 ground truth verified PASS |
| **Manual override** | ✅ | User decision A: trust F6 ground truth, ship 4.0.16 |

## Out-of-scope follow-ups

- **5 pre-existing test timeouts** (auto-compact-orchestrator.test.ts:270 + 4 others) — open `2026-08-06-fix-pre-existing-test-timeouts` slice
- **`peaks code` parent stays hidden** per v2.13.0 design intent (F7 candidate)
- **downstream-migration slice** for 1-click upgrade path (D7 deferred)
- **OCR 1.8.9 Delegation Mode** tested but not yet integrated into a real workflow

## Audit trail (final)

All artifacts under `.peaks/_runtime/2026-08-06-session-cacde8/`:
- `prd/requests/002-2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild.md` (PRD-002)
- `prd/requests/003-2026-08-06-eslint-strict-metrics.md` (PRD-002b)
- `rd/requests/002-...-dispatch-prompt.txt` + `003-...-dispatch-prompt.txt` + `003-rd-repair-...txt` + `003-rd-repair-f6-...txt`
- `qa/requests/002-...-dispatch-prompt.txt` + `003-...-dispatch-prompt.txt` + `003-qa-cycle2-...txt` + `003-qa-cycle3-...txt`
- `qa/test-cases/2026-08-06-eslint-strict-metrics.md`
- `qa/test-reports/2026-08-06-eslint-strict-metrics.md`
- `qa/security-findings-2026-08-06-eslint-strict-metrics.md`
- `qa/performance-findings-2026-08-06-eslint-strict-metrics.md`
- `sc/commit-boundaries/2026-08-06-eslint-strict-metrics.md`
- `txt/handoff.md` (final handoff capsule)

Memory sediment under `.peaks/memory/`:
- `2026-08-06-eslint-jsts-gate-and-ocr-multilang-rebuild-sediment.md` (PRD-002 134 lines)
- `2026-08-06-incremental-first-no-touch-stockcode-rule.md` (binding red line)
- `2026-08-06-4016-lint-strict-prd-todo.md` (PRD-002b to-do)
- `2026-08-06-prd002b-qa-cycle3-blocked-on-pre-existing-flakes.md` (cycle 3 root cause)
- `2026-08-06-4016-publish-closure.md` (this file)

## Final verdict

**4.0.16 ship 闭环 ✅**. 11 commits. 8 NEW CLI capabilities. 26 files. +1509/-960 LOC. User global install 验证 PASS. SquabbyZ sole-author. No Co-Authored-By trailers. peaks-loop 4.0.16 is live on npm.
