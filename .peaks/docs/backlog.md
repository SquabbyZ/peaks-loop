# peaks-loop Backlog

> Created 2026-09-19 from the Phase A defect-closure session (16 commits, `dc44116b..ae46e118`, released as 4.0.54).
> Everything here was **found and verified** during that session but **deliberately not fixed** — either out of the
> slice's scope, or because it needs a decision rather than an implementation.
>
> **How to read an item.** Each one names where it lives, what was actually measured, and why it was left. Nothing
> here is a guess: if an item says "measured", a command was run. If it says "not measured", that is stated too —
> the session's single most common defect shape was a claim whose evidence was never gathered, so the absence of a
> measurement is written down rather than hidden.

---

## 0. The shape (why these exist)

The session's working finding, stated once so the items below read as instances of it rather than as a list:

> **A cheap approximation replaced a real property, and then the approximation was never checked again.**

Every item below is one instance. The corollary that decided how each was handled:

> **"It can fail" and "it misses nothing" are two different claims, and verification is usually pointed at the first.**

---

## 1. Needs a decision, not an implementation

### 1.1 `docs/**` — 165 dangling citations, genre undecided

- **Where**: `docs/superpowers/{plans,specs}/**` (14 files) plus the repo-root `docs/`
- **Measured**: adding `docs/` to the citation guard's corpus reports **165 findings across 11 files**. Of 71 distinct
  cited paths, **62 never existed** (planned-but-never-built: `packages/runtime/**`, pre-`skills/` `.claude/skills/**`,
  `2026-MM-DD-*` fill-ins) and **9 did exist and were deleted** — those 9 correspond 1:1 to the 9 diagnosis findings
  D1 called genuine.
- **Decided**: `docs/superpowers/**` is **not in the guard's genre** (plan prose is intent, not obligation). Recorded
  in the guard's `CORPUS_ENTRIES` comment.
- **Still open**: the **9 genuinely dangling** citations are not dispositioned. Either fix them, or state explicitly
  that historical plan documents are exempt from citation integrity.
- **Scale note**: 165 is the same order as 4.0.51's 178/64 when `skills/**` was added — which is why it was not
  widened in-session.

### 1.2 `.peaks/memory/` — 83 stale pointers across 42 files

- **Measured**: of 1584 backticked repo-anchored paths in `.peaks/memory/`, **608 do not resolve**. Of those, **83
  point at a file that still exists elsewhere** (moved, not deleted) — the genuinely stale class. The rest are
  ephemeral `.peaks/_runtime/` artifacts or files legitimately deleted since.
- **Fixed in-session**: 5 pointers across 3 files (the ones the doc migration broke).
- **Decided by the user**: stale historical sediment should be **fixed or discarded**.
- **Still open**: the remaining 83. They include the `skills/peaks-rd/` → `skills/bee/peaks-rd/` move and the
  `packages/peaks-loop-mut/` extraction.
- **Note**: `.peaks/memory/` is **not** in the citation guard's corpus, so nothing will flag these automatically.

### 1.3 `test-style-contract.md` moved — downstream unverified

- **Change**: `docs/test-style-contract.md` → `contracts/test-style-contract.md` (4.0.54). It ships in the npm
  tarball, so the consumer-visible path changed to
  `node_modules/peaks-loop/contracts/test-style-contract.md`.
- **Measured**: no runtime reader in `src/`/`scripts/`/`packages/`; both `npm pack` and `pnpm pack` include it.
- **Still open**: **no downstream consumer was checked.** If any project reads the old path, it breaks silently.
- **Why it moved**: it is a published contract, and `.peaks/` reads as private tool state; `contracts/` reads public.

---

## 2. Real defects, verified, not fixed

### 2.1 `--from-dag` validates no role

- **Where**: `src/cli/commands/dispatch-commands.ts:196` returns **before** `validateRole` at `:199` — its only call
  site. The path's only check is `supportsRole: role => role.length > 0` (`sub-agent-dispatcher.ts:169`).
- **Consequence**: the deprecated-reviewer policy F2 wired into the warm path is bypassed entirely by `--from-dag`.
  Same validator, one of two paths missing it.

### 2.2 `reviewer-dispatch-policy` — 11 of 13 exports still unreferenced

- **Measured**: 13/13 exports had zero references across `src/`+`packages/`+`scripts/` (865 files scanned). F2 wired
  one call path; **11 remain unreferenced**, and **the 5→3 decision-table half is pinned by nothing** (the predicate
  half is covered by `reviewer-dispatch-policy.test.ts`, 6 cases, added `7191140f`).

### 2.3 Two vocabularies over one threshold table

- **Measured**: `peaks skill presence` (`core/skill-command.ts:57`) and `peaks code context-now`
  (`code-runtime-commands.ts`) **both** call `evaluateCompactTrigger` + `resolveAutoCompactProfile`, but publish
  **different vocabularies**: the former emits `trigger.kind` verbatim (`none|soft-warn|auto-fire|pre-compact|
  red-line`), the latter maps to `action` (`ok|soft-warn|auto-compact-now|red-line`). `auto-fire` has no `action`
  equivalent. H4 aligned the two on behaviour but **did not unify the vocabularies**.

### 2.4 `readReleaseState` trusts an unvalidated `currentStage`

- **Where**: `src/services/release/` — `readReleaseState` does not validate `currentStage`, and
  `rollbackRelease` and siblings do not pass through `isValidStageTransition`.
- **Consequence**: a state file with an unknown or retired stage (e.g. the dropped `hotfixed`) is read as-is.
  H2 hardened `isValidStageTransition` itself (`(VALID_TRANSITIONS[from] ?? [])`) but not these readers.

### 2.5 `metadataKey` check is unreachable for object input

- **Where**: `src/services/memory/project-memory-service/store/atomic-write.ts`
- **Measured**: `containsSensitiveConfigValue` **recurses into values**, so `{…body:{token:'x'}}` returns `true`;
  the branch is only unreachable for **string** input. `assertSafeMemory` is a **public export** (`index.ts:100`),
  so deleting the branch **would** weaken detection. Zero test coverage.
- **Corrected in-session**: the tech-doc's mechanism description was wrong and is now right; the branch itself stays.

### 2.6 A guard whose two dimensions have no assertions

- **Where**: `tests/unit/vitest-concurrency-guard.test.ts`
- **Measured**: the file's own header claims four dimensions; "cap within a sane bound" and "env override honored"
  have **zero assertions**. The negative arm was added in-session (it now catches the comment-out form), but those
  two dimensions are still empty.

### 2.7 Two bounded blind spots, deliberately not widened

- `const maxWorkers = 1` still passes `vitest-concurrency-guard` — the added assertion targets the ACTIVE line, not
  the value.
- The upstream tag sanitiser `sed 's/[-+].*//'` still passes `publish-tag-strict` — the operand assertion is bounded.
- Both recorded; neither widened, because widening needs a reason and a red case.

### 2.8 Residual reach gaps in the citation guard

- `docs/nonexistent.md:42:43` (`path:line:col`) is **silent** — now in the `LINE_SUFFIX` comment and pinned by m4.
- Ranges `path.ts:14-17` remain **invisible**; the single corpus instance (`coding-style.md:39`) names a file that
  **exists**, so it is a live citation behind the blind spot.
- Backticked bare filenames (no `tests/` prefix, no slash) remain invisible; closing it is a resolution-contract
  change, not a candidate widening.

### 2.9 Coverage of the guard audit itself

- **Measured**: of the corrected **46 stations**, only **22** have had mutation runs.
- Guards in `scripts/**` / CI jobs / `packages/*/tests/**` **were never enumerated** — all five enumeration
  strategies keyed on `tests/**/*.test.ts`.
- The concurrency guard file is **1292 lines** against an 800 cap (pre-existing, grown twice in-session).

---

## 3. File-size debt (800-line cap)

| File | Lines | Note |
|---|---|---|
| `src/cli/commands/code-runtime-commands.ts` | **799** | **one line from the cap** — the next addition needs a split |
| `src/cli/commands/dispatch-commands.ts` | 836 | over before the session; grew +3 |
| `tests/unit/standards/repo-citation-integrity.test.ts` | 1292 | over before the session; grew +80 |
| `src/services/artifacts/artifact-prerequisites.ts` | 768 | F2/H-series deliberately avoided touching it |

---

## 4. Smaller, recorded

- **`handoff-service.ts` is not routed to the `RuntimeRoot` seam** — inline `join('.peaks','_runtime',…)` string
  building. Rationale for not doing it (4.0.49) is recorded: wiring its relative form reintroduces a fragment
  round-trip carrier.
- **The structural seam's 95 unguarded slots across 48 files** — the compiler is the worklist; the property holds
  only where the seam is used.
- **`gateEvidence`'s field set is still unpinned** — `writing-handoff-frontmatter.md:65` remains true even though
  the field is now real end-to-end.
- **The 4.0.8 baseline is frozen** — `peaks baseline audit` reports `consistent` while pointing at a frozen row.
- **`RUNTIME_NPM_VERSION` (0.0.21) and the internal-runtime package version are out of sync** (since 4.0.43). Note
  `sync-version.mjs` writes `RUNTIME_VERSION` in the runtime package's `src/index.ts`, not this constant.
- **`peaks-ide` audit-log assistant** (4.0.53 AC-7) — deferred, still not implemented.
- **superpowers four clauses** — still zero test coverage.
- **`fanout-mandatory.md` wording** — unpinned by any AC, though its three factual claims are currently true.

---

## 5. Method notes (carried forward, not defects)

Three habits from this session that found things nothing else found. They are listed because each one produced a
finding that had survived every test, every CI run, and every prior review.

1. **Try to make it red, then try to make it miss.** A guard proven falsifiable is not yet a guard proven adequate.
   The `package.json#files` gap was found by a THIRD mutation, after two had already reddened the guard.
2. **Recover the deleted test from git before deciding what a module meant.** Twice (`f17aa377^`, and G15's
   `release-state.test.ts`) the author's original assertions contradicted the surviving prose, and in both cases the
   test was right. A module's intent dies with its tests; half of it is recoverable from history.
3. **When a claim cites a past incident, read the incident.** A fix was once declined by citing 4.0.48 — which
   records two slices overwriting the same rid-less `.peaks/_runtime/` artifact path, not two edits to a tracked
   test file. The citation looked rigorous and was never checked.

---

## 6. 开放项:`unidentified reformatter`（2026-09-19，四次）

**现象**：每次切片提交之后，会出现一批"不该脏"的文件，内容恰好是**上一片提交过的文件里
prettier 会重写的那些**，改动**纯格式化**、语义为零。四次发生，四次的受影响集合都符合这条规律。

**已用逐字判据证明四次**：取上一片提交时的 blob，过一遍 prettier（仓库配置），
与磁盘逐字节相等 ⇒ 纯格式化，无语义改动。判据是
`.tmp/reformat-check.mjs`（未提交的临时件）。

**为什么重要**：它污染每一次提交（把不属于本片的改动夹带进去），并**连续三次导致
子代理给出错误归因** —— 有的说"另一个 slice 的"，有的说"parent 的 prettier"。
一次"不是我的"如果没被核对，就会掩盖真实改动。这是本仓库反复出现的形状。

**已经排除的假设（每一条都实测过，不是推理）**：

| 假设 | 排除方式 |
|---|---|
| 编辑时钩子 | 用 Edit 工具插 118 字符长行 → **原样存活** |
| SessionStart 钩子 | 直接跑 `peaks session primer` → 状态前后一致 |
| PreToolUse ×3 | `gate-step-08`/`gate enforce` 由 RD 查；（本会话）`peaks code auto-compact` 实测 0→0 |
| 用户级钩子 | `~/.claude/settings.json` **无 hooks 键内容** |
| ECC 插件钩子 | 只有 `.cursor/` 下的，不在本会话生效 |
| `peaks sub-agent dispatch` | 干净树上跑 → 0→0 |
| lint-staged / git stash | `git stash list` 空；提交后立刻 `git status` 为空 |

**存活的最强假设**（解释力最好，但**未证实**）：某个 agent 在会话早期对
`git diff HEAD~1 --name-only` 的结果跑了一次范围化 `prettier --write`（当作 housekeeping），
**跑完才 `git status`**，于是看见的是自己刚造成的脏，并归因给别的进程。这能同时解释
"受影响集合 = 上一片提交的文件"与"三次都归错因"。

**要最终定位它**需要什么：在某一整片期间挂一个文件系统 watcher（例如
`node --watch` 或 `fs.watch` 记录 `tests/**`、`src/**` 的写入者），或给 `prettier`
装一个 wrapper 记录调用栈。**两者都需要跨一整个子代理会话**，是独立的一片工作。

**现行缓解（已生效四次）**：每次提交前跑那套逐字判据，把重排块**显式标注在提交信息里**，
而不是默默吸收。这至少保证"夹带"是可见的、可审计的。
