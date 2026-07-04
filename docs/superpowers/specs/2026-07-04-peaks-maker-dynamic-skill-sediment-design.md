# Peaks-Maker: Dynamic Skill Sediment Pool for 24h Long-Task Orchestration

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-04
**Author:** SquabbyZ (via peaks-solo brainstorm session 2026-07-04)
**Affects:** peaks-cli, peaks-solo, peaks-sop, all existing `peaks-*` skills, `~/.peaks/skills/`, `tests/unit/workspace/` + `tests/unit/cli/`
**Target version:** 4.0.0 (major; introduces the sediment pool and `peaks-maker`)
**Pre-release milestone:** peaks-loop **3.x** current line is cut and shipped first as a bug-fix-only release (per user directive 2026-07-04: "先把当前的版本创建个 release 方便后续 bug 修复"). 3.x receives only bug-fix commits; no spec-coupled changes. 4.0.0 lands the sediment pool on top of an already-frozen 3.x baseline.

---

## 0. Project tenet — Human-NL-Choice-Only

Per user directive 2026-07-04: **人参与决策只有两种:选择 / 自然语言描述** — 此条覆盖 spec 内所有 user-facing 措辞、所有后续设计与修复、本设计之外的所有 4.x slice。Significance: peaks-loop 是现有 AI runtime (Claude Code / Codex / Copilot / …) 之上的增强层,用户对 peaks 的全部参与归约到下列两种原型动作之一;**其他形式皆为越界**:

| 原型动作 | 例子 | 由谁引导 |
|---|---|---|
| **选择** (pick one / prefer A or B) | "你想要 A 还是 B?", "完成还是再迭代?", "晋升这只 bee 吗?" | LLM 提选项(用 `AskUserQuestion`),用户在自然语言对话中回答 |
| **自然语言描述** (describe intent) | "把这次抓 arxiv 的流程沉淀下来", "我下次想直接复用这只 bee" | 用户主动发起,LLM **按意图(intent)** 解析后驱动 CLI —— **不是关键字匹配**;同一句话无论怎么措辞("下次我想直接用这条"、"复用作法不变")都能被解析到底层一致的意图上 |

> **意图识别的边界**:peaks-maker 不能要求用户用「官方动词表」里的字(不能暗示"必须说'沉淀'才能开始"="'reuse'才认可复刻")。如果 LLM 跑得不对,问题在 LLM 而不是用户用语。
>
> **凡 user-typing 都不在 user 表达范围**: 用户不敲 CLI flag、不敲命令、不手写 JSON、不手写 SKILL.md、不手填表单。所有这些动作的**主体都是 LLM**。具体执行约束详见 §2.1 #4 + §4.1.0 + §9 (Red Line #4.1)。

This tenet is referenced from §2 (Goals) and §9 (Red Lines) — *changes to it require user re-confirmation, not unilateral revision*.

#### 0.0 Desktop client is a UI accelerator, not a new verb surface

Per user clarification 2026-07-04: **currently there is no client.** Until one ships, the user's **every** interaction with peaks-loop is one of the two forms above — `AskUserQuestion` pick or free-form natural language. This includes:

- downloading a stored skill from the local SkillHub (`peaks skill sediment export` — invoked by the LLM on the user's NL)
- importing a bundle from a teammate (`peaks skill sediment import` — invoked by the LLM)
- refining a bee (`peaks skill sediment refine-bee` — invoked by the LLM)
- cloning (`peaks skill sediment clone-bee` — invoked by the LLM)
- retaining / disposing a release (`peaks skill sediment dispose` — invoked by the LLM after the user picks destroy vs retain)
- promoting, retiring, listing, searching — every verb the LLM runs on the user's behalf

When a future desktop client exists, it is a **UI accelerator** — buttons, drag-and-drop, file pickers, list view, search box — that may *shortcut* the same NL intent. But the underlying rule does not change: the user never types a CLI verb or hand-authors data, even on the desktop. The desktop's shortcuts are conveniences over the same `peaks skill sediment …` surface; they do **not** introduce a new verb surface that bypasses the LLM coordination model. (See `.peaks/memory/two-forms-only-rule.md`.)

### 0.1 Bee 处置(disposition)必须经用户确认

Per user directive 2026-07-04: 用户生成的 bee,销毁前必须用自然语言问用户「销毁 / 保留」(destructive=true);只有用户选了「保留」之后,完整的 skill(manifest + SKILL.md + bound segments + scripts)才作为**一份带版本号的 release**写入本地 SkillHub(`~/.peaks/skills/.state.db`,schema 见 §3.3.1)。系统生成的 bee 用完默认销毁,不询问;**系统 bee 不进 SkillHub**。详见 §3.3 lifecycle 表 + §3.3.1 (local SkillHub schema) + §3.3.2 (version 语义) + §3.3.3 (local SkillHub 是一等公民 store) + §3.3.4 (未来线上 public SkillHub 商业延展) + §4.2 `peaks skill sediment dispose` 入口 + §6 error 表新增行 + §9 Red Line #9。

---

## 1. Problem statement

---

## 1. Problem statement

### 1.1 Symptom

peaks-loop is built as a 24h AI programmer orchestrator, but its skill surface has two compounding limitations that block every realistic long-task use case outside software engineering:

1. **Skill set is code-centric.** The 18 built-in skills (peaks-prd, peaks-rd, peaks-qa, …) all assume "project = code repo". A product manager asking "pull today's trending GitHub repos by star velocity", or a medical researcher asking "fetch today's new arxiv papers in oncology", finds no entry — peaks-solo is the only orchestrator and it is hard-coded to the coding domain.
2. **Skills are always-on, file-scoped, and grow the active context.** Every skill installs into the Claude Code skills directory at package time, ships with the npm package, persists for the lifetime of the install, and lands in the LLM's context every time a session starts — including scenarios where the skill is irrelevant. The user's daily practical workaround ("don't load every skill; manually re-symlink what's needed") contradicts peaks-loop's "user operates at zero CLI cost" principle.

Both symptoms collapse into one root cause: **peaks-loop has no concept of a sediment pool — a place where skills accumulate over time, are available on every project on the machine, and load into the LLM only when needed, then release back to the pool on completion.**

### 1.2 Root cause (architectural, not behavioral)

The current peaks-cli has three boundaries that look like a skill system but are not:

| Today | What it lacks |
|---|---|
| `skills/peaks-*/SKILL.md` shipped as npm package | No on-machine user-side sediment layer where new scenarios accumulate cross-project. |
| `~/.peaks/` workspace | Owns SOPs, sessions, runtime artifacts — but never owns skills. |
| `peaks-solo` orchestrator | Hard-coded to the coding domain; no "spawn a bee" notion. |

Without a sediment pool, every new scenario (trending-repo watcher, arxiv daily digest, fork-vs-upstream PR routing, unit-test coverage to 100%, …) either (a) gets baked into the npm package as a one-off (linear growth, version-coupled, hard to retire), or (b) doesn't get built at all because no clean home exists. The user's existing frustration ("with peaks-loop, the diffy PR landed upstream, the hermes-agent PR landed on my fork — same expected outcome, different result, no sediment available") is the canonical symptom.

### 1.3 Why "just register more skills"

Three reasons why bolting more skills onto the npm package fails to fix the problem:

- **Growth curve is uncontrolled.** Every new scenario = a new npm release. Today the user must wait for a peaks-loop release to get a `peaks-product` or `peaks-medical` skill — a fundamentally hostile experience for non-coding roles.
- **Context pollution is fundamental.** Claude Code (and every comparable AI CLI) loads every installed skill's name + description into context at session start. As the package grows, baseline context grows, regardless of which skill is actually used. This is the "skill 即使用不上也占上下文" pain the user named explicitly.
- **Cross-runtime / cross-project portability is missing.** Skills live inside the npm package; the user can't carry "my daily arxiv watcher" from one project to another, can't share it with a teammate, and can't promote something they hand-rolled to a higher-fidelity version without going through a full peaks-loop release.

---

## 2. Goals & non-goals

### 2.1 Goals (in priority order)

1. **A sediment pool that is the only home for all scenario-driven skills.** System-bundled skills and user/LLM-sedimented skills live in the same pool, governed by the same schema and lifecycle.
2. **Skills are loaded into the active AI CLI on demand, then released.** The active scratch materialization is short-lived (lifecycle of the user's request); the pool itself is append-only. The active AI CLI's "skills installed" set returns to baseline when the request ends — no baseline-context drift.
3. **Vendor-neutral contract.** The sediment pool speaks a vendor-neutral skill envelope; an adapter layer (`peaks skill adapter <claude|codex|copilot|...>`) translates the envelope into each runtime's native skill format. The user/operator is never required to choose a vendor at sediment time.
4. **Zero-CLI-cost human sedimentation.** Per user clarification 2026-07-04: the user adds a sediment by **describing it in natural language** to the LLM ("把这次抓 arxiv 的流程沉淀下来", "I want to reuse this next time"); peaks-maker skill, always-loaded, translates the user's words and runs `peaks skill sediment add-segment …` / `add-bee …` on the user's behalf. **The user never types `peaks <anything>` directly** — the user and the LLM share one CLI surface, but the **subject** of every CLI invocation is the LLM. The new bee becomes available across every project on the machine and every supported runtime that the user activates in a session, once peaks-maker finishes the sediment. (See §4.1.0 for the canonical statement.)
5. **LLM-claimed sediment is gated by a promotion ladder, never auto-promoted.** Anything the LLM adds lands in `candidate`; only after the promotion ladder passes (cycle ≥ 1 + smoke test present + explicit human approval OR ≥ N cycles without incident) does it become `stable`. This is the key correctness device: it lets the LLM propose freely without polluting the active bee inventory.
6. **peaks-solo is demoted to "one bee among many, system-stable, code-domain".** It is no longer the only orchestrator. A new top-level orchestrator concept (peaks-orchard, embodied by `peaks-cli`) picks a bee based on scenario and materializes it. Solo remains the default bee for coding scenarios and continues to receive version-coupled updates via npm — but it is no longer privileged in the design.

### 2.2 Non-goals (out of scope for this design)

- Migrating the existing `peaks-sop` behavior. peaks-sop retains its engine role (phases + gates); its authoring flow is preserved. It is not being repurposed as the orchestrator.
- Auto-healing / self-repair of `.system/`. A "soft protection" stance is chosen (CLI guard + SKILL.md Boundaries + vitest guard). Auto-restore on corruption is a separate slice.
- HTTP-based remote sediment sharing. This design is local-only (`~/.peaks/skills/`). Multi-machine sync is a future slice.
- A UI for browsing or editing the pool. The CLI is the only interface in this slice.
- Replacing peaks-solo's PRD/RD/QA/TXT choreography. peaks-solo retains its internal pipeline — `peaks-maker` adds a new layer on top, not a replacement.

---

## 3. Architecture (4 layers)

```
LLM Runtime (Claude Code / Cursor / Codex / Copilot / …)
   │ invokes skills via the runtime's native tool
   ▼
────────────────────────────────────────────────────────
[1] Scratch layer  (ephemeral, last the lifetime of one request)
   <provider-specific scratch dir>/
     peaks-bee-<name>.peaks-generated/
        SKILL.md + references/ + scripts/   ← adapter.materialize()
   ─ released on: request complete / context red-line / explicit retire
────────────────────────────────────────────────────────
[2] Sediment pool  (append-only, cross-project, machine-wide)
   ~/.peaks/skills/
     .system/                                ← system-bundled, protected dir
       bees/
         peaks-solo/                  (code-domain, preserved-as-alias, system-stable)
         peaks-prd/                   (also `bee-<name>`-style aliases welcome for new entries)
         peaks-rd/                    ↓ see §4.1.1 for the alias rule
         peaks-qa/ ...
         peaks-ui/
         peaks-sc/
         peaks-txt/
         peaks-reviewer/
       skills/{peaks-sop, peaks-audit, peaks-doctor, peaks-final-review,
               peaks-ide, peaks-perf-audit, peaks-security-audit,
               peaks-slice-decompose, peaks-solo-resume,
               peaks-solo-status, peaks-solo-test}/
     bees/                                   ← user/LLM sedimented
       bee-<name>/
     segments/                               ← reusable fragments
       <seg-name>/
     index.json                              ← bee → segments[] mapping
────────────────────────────────────────────────────────
[3] peaks-maker (the sediment gatekeeper skill, always-installed)
   CLI surface:
     peaks skill sediment add-segment / add-bee
     peaks skill sediment promote / retire
     peaks skill sediment list / show / search / recent
   Strong guarantee: peak-maker never writes code; it only nudges the
   user + drives the CLI. The user never hand-authors JSON.
────────────────────────────────────────────────────────
[4] peaks-cli as orchard (top-level orchestrator, unchanged shell)
   Reads index.json → chooses bee → calls adapter.materialize() →
   adapter.publish() → adapter.activate() → (later) cleanup()
   The orchestrator has no domain knowledge; it only dispatches.
────────────────────────────────────────────────────────
```

### 3.1 Semantic flatness, physical protection

The user's directive: "the system's bees and the user's bees are siblings — no privileged tier — but the system half of the pool is physically protected so a stray `rm` from the LLM, a broken cleanup script, or a careless user cannot break peaks-loop's internal capabilities."

Concretely:

- **Same manifest schema** for both halves (`schemaVersion: "peaks.bee/1"`, `source: "system" | "user"`, `promotion_status` ∈ `{candidate, stable, retired}`).
- **Different physical path** (`./.system/bees/` vs `./bees/`) — dot-prefix on `.system/` raises the cost of accidental damage.
- **Different write authority** — `peaks skill sediment add-bee --path .system/foo` is hard-rejected by the CLI; only the npm-package publish flow and explicit `--allow-system-write` maintenance subcommand land entries under `.system/`.
- **Single flat `index.json`** — no `system_index` vs `user_index`; the orchestrator reads one file and treats all entries identically, modulo `source` and `promotion_status`.

### 3.2 Vendor-neutral contract (the adapter)

The sediment pool holds a vendor-neutral **skill envelope**:

```ts
interface BeeManifest {
  schemaVersion: "peaks.bee/1";
  name: string;                  // "bee-arxiv-daily-watcher"
  source: "system" | "user";     // provenance (single field, no path privilege)
  promotion_status: "candidate" | "stable" | "retired";
  description: string;           // ≤ 200 chars, first-match trigger
  segments: SegmentRef[];        // one bee = one manifest, N segments
  entrypoint: SkillEnvelope;     // preamble + refs handed to LLM at activate
  promotion: PromotionGate;      // candidate → stable conditions
  createdBy: "human" | "llm";
  lastTouchedAt: string;         // ISO 8601
}

interface SegmentRef {
  name: string;
  inputs: Param[];
  outputs: Param[];
  sideEffects: string[];         // ["fs:write", "net:fetch", "cmd:git", ...]
}

interface SkillEnvelope {
  preamble: string;              // opening text for the LLM
  refs: { path: string; kind: "file" | "dir" | "script" }[];
}

interface PromotionGate {
  minCycles: number;             // default 1
  requiresHumanApproval: boolean;// default true
  requiresSmokeTest: boolean;    // default true
  retireOnMissesInRow: number;   // optional auto-retire threshold
}

// Written to ~/.peaks/skills/index.json (atomic write, single source of truth):
interface IndexFile {
  schemaVersion: "peaks.pool/1";
  generatedAt: string;           // ISO 8601
  entries: Array<{
    name: string;                // bee name or "segment:<seg-name>"
    kind: "bee" | "segment";
    path: string;                // relative to ~/.peaks/skills/
    source: "system" | "user";
    promotion_status: "candidate" | "stable" | "retired" | "system-stable";
    segments?: string[];         // bee-only: names of segments it binds
  }>;
}
```

The adapter layer converts one envelope into the runtime's native skill format. Default adapters ship: `claude` (uses `~/.claude/skills/`), `codex` and `copilot` are stubs in this slice, expanded in later slices. `auto` mode runs `peaks skill adapter detect` and picks one.

### 3.3 Lifecycle (one bee, end to end)

| Phase | What runs | Touched layer |
|---|---|---|
| Idle | user has not asked for the bee | only [2] (pool) |
| Spawn | orch detects scenario → reads `index.json` → calls `adapter.activate(beeName)` | [4] + [2] |
| Materialize | orch composes one scratch dir under `<provider-scratch>/peaks-bee-<name>.peaks-generated/` from the bee + its segments | [1] |
| Activate | adapter publishes to the runtime; runtime loads the skill | [1] |
| Use | runtime invokes the bee for the user's task | [1] |
| Persist | after Use, `bees/bee-x/run-state.json` snapshots last cycle outcome (success/incident/cycle count) — this is the input `minCycles` reads | [2] (append-only) |
| Dispose (system bee) | request ends / context red-line → adapter cleans scratch unconditionally. **Default and only path for `source: system`.** | [1] only |
| Dispose (user bee) | request ends / context red-line → adapter **pauses and asks user in NL**: "destroy the scratch materialization, or retain it (so you can ship this bee to a teammate)?" — `AskUserQuestion` pick. The user is the only actor who can move forward. **Default `destroy` after the request ends**, but only as the most recent confirmed choice; never silently. | [1] only |

Hard guarantee: **the pool is never written to during the Spawn→Dispose phases**, only Read. Writes only happen via `peaks skill sediment …` (peaks-maker, layer [3]). The dispatch path never modifies the source bee directory; only the scratch materialization is touched.

### 3.3.1 Local SkillHub store — `~/.peaks/skills/.state.db`

Per user directive 2026-07-04 (refined scope after a clarifying exchange): **SQLite is the local SkillHub store.** When a user-bee's `dispose` flow returns `decision=retain`, the **full skill package** (bee manifest, SKILL.md, bound segments, references, scripts) is snapshotted into the local SkillHub as a versioned release. The pool JSON manifests continue to be the live, dispatched source — the SkillHub is a parallel read-optimized store of **retained historical versions** that:

- the user can ship to a teammate (`tar` the SkillHub export bundle, or push to a future online SkillHub)
- the user can refine against ("微调", "整体复制微调")
- a future desktop client and a future **online public SkillHub** (see §3.3.4) read from

**This is not a disposition log** — earlier drafts framed it that way; the corrected model is: a per-version immutable archive keyed by `(bee_name, version)`. Append-only by design; the live pool + scratch path remain the only mutable surfaces.

**Anti-pattern rejected (per user clarification 2026-07-04):** the schema must NOT collapse into "a SQLite with one big `manifest_json BLOB` per row". That would be a JSON file in disguise — bloated, unsearchable, hard to migrate, hard to diff between versions. The schema below is **decomposed** — manifest fields, segments, files, references are first-class tables, joined by foreign keys. Only small, fully decomposable metadata lives in the relational tables; files that genuinely must be stored as a unit (binary scripts, large reference docs) live in a sibling `blobs/` directory and are referenced by hash from SQLite.

```sql
-- ~/.peaks/skills/.state.db
-- Local SkillHub: a versioned, append-only archive of retained user-bee snapshots.
-- Schema is decomposed (no big-JSON-blob anti-pattern).

-- A. The release itself (small, queryable)
CREATE TABLE bee_release (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  bee_name        TEXT NOT NULL,                 -- "bee-arxiv-daily-watcher"
  version         TEXT NOT NULL,                 -- semver: "0.1.0", "0.2.1", "1.0.0"
  source          TEXT NOT NULL CHECK (source IN ('user')),
  archived_at     TEXT NOT NULL,                 -- ISO 8601
  archived_by     TEXT NOT NULL,                 -- 'user' or 'llm'
  user_intent_raw TEXT,                          -- the user's NL that produced the retain decision
  description     TEXT,                          -- human-readable summary line
  parent_version  TEXT,                          -- for clone-bee / refine-bee
  changelog       TEXT,                          -- auto-generated; user may edit
  UNIQUE(bee_name, version)
);

-- B. Latest-version pointer per bee
CREATE TABLE bee_release_pointer (
  bee_name        TEXT PRIMARY KEY,
  latest_version  TEXT NOT NULL,
  released_at     TEXT NOT NULL
);

-- C. Manifest fields as first-class columns (NO json blob of the whole manifest)
CREATE TABLE bee_manifest (
  release_id        INTEGER PRIMARY KEY REFERENCES bee_release(id) ON DELETE CASCADE,
  schema_version    TEXT NOT NULL,               -- "peaks.bee/1"
  description       TEXT NOT NULL,
  segments_json     TEXT NOT NULL,               -- segment NAMES ONLY (a small JSON array of strings)
  entrypoint_preamble TEXT,                      -- skill preamble
  promotion         TEXT NOT NULL,               -- captured at retain time
  min_cycles        INTEGER,
  requires_human    INTEGER NOT NULL,            -- 0/1
  requires_smoke    INTEGER NOT NULL,            -- 0/1
  retire_on_misses  INTEGER
);

-- D. Segments bound to this release (one row per segment; small, queryable)
CREATE TABLE bee_segment_ref (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  segment_name    TEXT NOT NULL,                 -- e.g. "arxiv-fetch"
  inputs_json     TEXT,                          -- small JSON array of Param descriptors
  outputs_json    TEXT,                          -- small JSON array of Param descriptors
  side_effects    TEXT,                          -- comma-separated; e.g. "net:fetch,fs:write"
  UNIQUE(release_id, segment_name)
);

-- E. Files attached to this release (manifest is small, but SKILL.md, scripts, references can be large)
CREATE TABLE bee_file (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  owner_kind      TEXT NOT NULL CHECK (owner_kind IN ('bee','segment')),
  owner_name      TEXT NOT NULL,                 -- bee_name or segment_name
  path            TEXT NOT NULL,                 -- logical path inside the bee, e.g. "SKILL.md", "references/sop.md", "scripts/fetch.sh"
  kind            TEXT NOT NULL CHECK (kind IN ('markdown','script','reference','binary','other')),
  size_bytes      INTEGER NOT NULL,
  sha256          TEXT NOT NULL,                 -- content-addressed
  blob_path       TEXT NOT NULL,                 -- relative to ~/.peaks/skills/blobs/<sha256[0:2]>/<sha256>
  UNIQUE(release_id, owner_kind, owner_name, path)
);

CREATE INDEX idx_bee_release_name_archived_at
  ON bee_release(bee_name, archived_at DESC);
CREATE INDEX idx_bee_segment_ref_release
  ON bee_segment_ref(release_id);
CREATE INDEX idx_bee_file_release_owner
  ON bee_file(release_id, owner_kind, owner_name);

-- F. Diff-friendly changelog source-of-truth (one row per change, queryable for v→v diff)
CREATE TABLE bee_change (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  release_id      INTEGER NOT NULL REFERENCES bee_release(id) ON DELETE CASCADE,
  change_kind     TEXT NOT NULL,                 -- 'added' | 'removed' | 'modified' | 'meta'
  target_kind     TEXT NOT NULL,                 -- 'bee' | 'segment' | 'file'
  target_name     TEXT NOT NULL,
  detail          TEXT                           -- human-readable; written by peaks-maker from user NL
);
```

**Why decomposed, not big-JSON:**
- **Migration**: each table can be `ALTER`'d / indexed / partially exported. A "big-JSON-blob" SQLite is unsearchable — `WHERE description LIKE '%arxiv%'` doesn't work on a `manifest_json BLOB` without `json_extract()` gymnastics.
- **Diff**: v0.1.0 → v0.1.1 = `SELECT * FROM bee_file WHERE release_id IN (?,?)` → simple set diff. Big-JSON requires `diff json_a json_b` and produces noise.
- **Size**: a single bee with 5 segments × 3 files × 50KB = 750KB. If the whole package were a single `manifest_json + skill_md + segments_json` row, a 750KB row per version × N versions = 100MB+ for modest usage. Decomposed: 750KB blob-stored once per unique SHA256, referenced by FK; N versions of the same file dedupe for free.
- **Portability**: the export is a `state.db` (queries) + `blobs/` (content-addressed files). Either piece is independently importable. Big-JSON forces a single atomic block per release.
- **Versioning hygiene**: every change row in `bee_change` is its own line — you can answer "what files were modified between v0.1.0 and v0.2.0" in one query.

**Lifecycle interaction with §3.3 dispose:**

| `dispose --decision` | Effect on SkillHub |
|---|---|
| `destroy` | scratch materialization removed; **no SkillHub write**; no history record beyond a no-op audit row in CLI logs. |
| `retain` | scratch materialization's content decomposed into `bee_release + bee_manifest + bee_segment_ref + bee_file + bee_change` rows; `latest_version` advanced. The full content is recoverable: `SELECT * FROM bee_file WHERE release_id = ?` joined to `blobs/<sha[0:2]>/<sha256>` reconstructs the exact package. Scratch still removed at cleanup. |

**Blob storage sidecar:**

```
~/.peaks/skills/
  state.db                              -- relational store (this spec)
  blobs/
    ab/
      abc123...                         -- content-addressed; one file per unique SHA256
    f9/
      f9d8e7...
```

`blobs/<sha[0:2]>/<sha256>` is **content-addressed** — multiple releases sharing the same file (because `refine-bee` changed nothing) dedupe automatically. `VACUUM` on `state.db` does **not** touch `blobs/`; a separate `peaks skill sediment gc-blobs [--dry-run]` is the only thing that prunes `blobs/`, and only for SHAs no longer referenced.

**Why SQLite for this store:**
- Append-only + versioned = natural fit for a single-file SQL store; JSON file would mean a directory of `v0.1.0/`, `v0.2.0/`, `v1.0.0/` folders — hard to query, hard to ship as one bundle.
- A future online SkillHub can import the same SQLite file (or its bivalent export) and the schema is forward-compatible.
- `tar` of `state.db` + `blobs/` + `bees/<name>/` (current state) is the portable "ship to a teammate" bundle; the recipient runs `peaks skill sediment import` (see §4.2 CLI).

**Out of scope for this slice** (deliberately kept as JSON, not SQLite):
- Live pool manifests (`manifest.json`, `index.json`). These are the dispatch source of truth; SQLite is a parallel historical archive.
- Run-state snapshots. `bees/bee-x/run-state.json` continues to live as a small atomic-rewritten file.

**Boundaries:**
- The user cannot type SQL. The LLM never runs `sqlite3` directly; it always goes through the fixed `peaks skill sediment …` surface (see §4.2 for the new verbs: `dispose`, `export`, `import`, `releases`, `release-show`, `gc-blobs`).
- `state.db` lives at `~/.peaks/skills/.state.db`, **not under `.system/`**. Peaks-loop version upgrade never rewrites it; only `VACUUM` after a destructive clean is permitted.
- `blobs/` is content-addressed and is the **only** sidecar to `state.db`. Both are siblings of `~/.peaks/skills/.system/` and `~/.peaks/skills/bees/`.
- **Only `source=user` bees are archived.** System-bee's scratch is always destroyed on cleanup; system-bee versions live in the npm package, not the SkillHub.

### 3.3.2 Version semantics (npm-like)

Each retained bee has a semver-style version string, decided by the LLM (suggested default) and the user (final pick) at retain time. Rules:

- Initial retain: `0.1.0`.
- `refine-bee` (in-place patch): **patch bump** (e.g. `0.1.0 → 0.1.1`) and a new `bee_release` row is written on the next `retain` of the refined scratch.
- `clone-bee` (fork): the **clone** starts at `0.1.0` with `parent_version` set to the source's latest; the source is unaffected.
- `major` bump is reserved for schema-breaking changes to the bee (e.g. a segment is removed); peaks-maker asks the user in NL to confirm before letting the LLM choose major.

The CLI never invents version numbers without user confirmation. Default = patch bump; user can override via `peaks skill sediment dispose <bee> --decision retain --version <explicit>` (this is the only LLM-typed-on-user's-behalf CLI verb that mentions version at all).

### 3.3.3 Local SkillHub is a first-class store

| Surface | Read API | Write API |
|---|---|---|
| Live dispatch (the pool) | `index.json` | `peaks skill sediment add-/refine-/clone-` |
| Local SkillHub (history) | `state.db` (`bee_release`) | `peaks skill sediment dispose --decision retain` |
| Future online public SkillHub (out of scope, see §3.3.4) | HTTP | `peaks skill sediment publish` (future verb) |

The user's mental model: **the pool is the working copy; the SkillHub is the versioned library.** Dispatch reads the pool; the user ships from the SkillHub.

### 3.3.4 Future extension — online public SkillHub (commercial)

Per user note 2026-07-04: a future online public SkillHub is a deliberate product line, not a side effect. The local SkillHub is designed to be the on-ramp:

- The same `bee_release` row can be packaged as a bivalent export (one tarball, one JSON pointer, one `.signature`) and uploaded.
- `peaks skill sediment publish` (future verb, out of this slice) uploads to a hosted SkillHub; commercial licensing / discoverability is a separate future PRD.
- Vendor neutrality: the upload API is defined in peaks-cli, not bound to a specific vendor. A team can self-host or use the public registry.

This slice ships the **local** half. The public half is a separate PRD; the schema is intentionally compatible (see `bee_release.manifest_json` and the per-version row layout) so the future upload command does not require a schema migration.

---

## 4. Components & responsibilities

### 4.1 peaks-cli as orchard (existing, lightly extended)

- New subcommands: `peaks skill adapter <list|detect|resolve|set-active>`. These are **not user-typed commands** — they are LLM-typed commands on the user's behalf. See "Zero-CLI-cost human sedimentation" below.
- **Upgrade isolation (per user directive 2026-07-04):** `npm install peaks-loop@x.y.z` (or any update path) only ever touches `.system/` in the user's pool. The upgrade flow:
  1. Read `index.json` and snapshot every entry whose `source: user`.
  2. Replace only entries under `.system/` (add new, update existing system entries, retire retired system entries).
  3. Re-emit a fresh `index.json` that **preserves every user entry byte-identical**, only the `system:` half changes.
  4. Self-check at startup: `peaks skill sediment rebuild-index` confirms the diff is exactly the system half; if any user half differs, abort the upgrade and emit `UPGRADE_POLLUTED` (also enforced by vitest guard, pattern: see existing `tests/unit/workspace/top-level-change-id-guard.test.ts`).
- Per `peaks-loop-is-enhancement-not-new-cli` (memory 2026-07-04): peaks-cli never claims the shell prompt, never injects a system prompt, never invents a competing REPL. It is the orchestrator that the user invokes through whichever runtime they already use.
- No domain knowledge added. Domain knowledge lives entirely in bees.

#### 4.1.0 Zero-CLI-cost human sedimentation (correct interpretation)

Per user clarification 2026-07-04: "零 CLI 成本的人类沉积, 是指用户让 LLM 去做, 而不是说不创造新的 cli 去和 LLM 共用一个 cli 命令".

Concretely:

- **The user never types `peaks <anything>`.** The user types natural-language requests inside their existing AI CLI session ("把这次抓 arxiv 的流程沉淀下来", "我下次想直接复用这只 bee").
- **The user and the LLM share one CLI surface** — `peaks skill sediment …` etc. — but the **subject (who runs the command) is always the LLM, never the user.**
- peaks-maker is an always-loaded skill; when the user expresses a sediment intent, peaks-maker reads the user's words, runs `peaks skill sediment add-segment / add-bee` with the user's prior confirmation, and reports back. The user only ever confirms in natural language.
- **Natural-language routing is intent-based, not keyword-based.** peaks-maker parses the user's intent ("调一下"/"改改"/"修修" all map to `refine-bee`); no required-verb list, no stop-word filter that excludes paraphrases. (See §0 also.)
- This is the meaning of "user operates peaks at zero CLI cost" — not that peaks hides a CLI from the user, but that the user has no cli verb to learn. The CLI is the LLM's tool, not the user's.
- **No new facade command `peaks run <bee>` exists.** The user invokes a bee by saying "run bee-x", which the LLM acts on via the runtime's skill-activation path (scratch materialization + adapter.publish). Hence the **retired command**: `peaks run` is deleted from this spec; any later appearance of `peaks run` is a regression to flag.

### 4.1.1 peaks-solo as preserved alias (existing skill, unchanged UX)

The pool introduces bees by `bee-*` name; peaks-solo's name is grandfathered. To preserve muscle memory for existing users ("type peaks-solo = start PRD/bug-analysis/coding workflow"), peaks-solo is **not split** and **not renamed**. The pool registry carries a single system-stable entry under its existing name:

```
~/.peaks/skills/.system/bees/peaks-solo/
   manifest.json   # source: system, promotion_status: system-stable
                   # description: "code-domain orchestrator (PRD/bug/coding)"
                   # segments: [...solo's existing sub-agents...]
```

The orchestration entry point preserves the existing `<skill name> skill presence:set peaks-solo …` command path — but note: per §4.1.0, that command is **LLM-typed on the user's behalf**, not user-typed. A user who says "start a coding task" triggers the LLM to dispatch peaks-solo. Nothing in the existing runbook changes. Discovery of new bees happens through peaks-maker (described in NL by the user) — never through a new `peaks run <bee-name>` CLI verb.

Rationale: peaks-solo is the longest-running installed skill across all users; its name is cemented as the "code-domain" entry point. Renaming or splitting would force every existing user to relearn. We honor the user's explicit request: "保留 peaks-solo 这个技能".

### 4.2 peaks-maker (new skill, always-installed)

- **Responsibilities:** gatewrite access to the pool, drive `peaks skill sediment …` **on the user's behalf** (the LLM runs the CLI, not the user — see §4.1.0 Zero-CLI-cost), never hand-author JSON, refuse paths under `.system/`, refuse `promote` if `PromotionGate` not satisfied. **NL-disambiguation: every interactive prompt is an intent parser, not a keyword matcher.** When the user describes intent ("调一下", "改改", "把这一步的报错行解析得宽一点"), peaks-maker routes to `refine-bee` / `edit-bee` / whatever concrete CLI; the LLM cannot require the user to use a specific verb.
- **CLI surface (concrete):**
  ```bash
  # --auto means: peaks-maker suggests the segment skeleton (name + describe + inputs/outputs
  # placeholders) from the LLM's recollection of the last workflow, but the user can edit
  # before --apply. Without --auto the CLI prompts interactively.
  peaks skill sediment add-segment <name> --describe "<one-line>" [--auto] [--apply]
  peaks skill sediment add-bee      <name> --segment <seg>... [--description "..."] [--apply]
  peaks skill sediment refine-bee   <name> --patch "<change-description>" [--apply]
  peaks skill sediment clone-bee    <name> --as <new-name> [--apply]
  peaks skill sediment promote      <name>                       # requires gate pass + --apply
  peaks skill sediment retire       <name>                       [--reason "<why>"]
  peaks skill sediment dispose      <name> --decision destroy|retain [--version <v>]  # retain → write bee_release + blobs per §3.3.1
  peaks skill sediment releases     <bee-name>                   # list versioned SkillHub releases
  peaks skill sediment release-show <bee-name> --version <v>     # show one release row + contents
  peaks skill sediment release-diff <bee-name> --from <v1> --to <v2>  # set diff using bee_file rows
  peaks skill sediment export       <bee-name> --version <v>     # produce a portable tar.gz bundle (state.db slice + blobs/)
  peaks skill sediment import       <bundle-path>               # bring a teammate's tar.gz in
  peaks skill sediment gc-blobs     [--dry-run]                 # prune blobs/ of unreferenced SHAs
  peaks skill sediment list         [--status candidate|stable|retired]
  peaks skill sediment show         <name>
  peaks skill sediment search       "<query>"                    # recall-friendly: list/search/recent
  peaks skill sediment recent       [--since 7d]
  peaks skill sediment rebuild-index                            # self-heal index.json after drift
  ```
  - **`refine-bee`** = partial patch. The LLM describes what to change in NL; the CLI diffs and patches. It refuses to alter `.system/*`. The original bee's promotion_status is preserved.
  - **`clone-bee`** = full copy. Creates `<new-name>/` with the same `manifest.json` + `SKILL.md` + bound segments. The clone starts at `promotion_status: candidate` regardless of the source's status (clones don't inherit maturity). Used both for "整体复制微调" and for shipping a bee to a teammate (the user `tar` the resulting folder and sends it; transport is out of scope here).
  - **Disambiguation on Refine vs Clone**: peaks-maker always asks in NL when ambiguous ("do you want to tweak this bee in place, or fork a new variant?"). The answer is asked as a pick (`AskUserQuestion`); never a verb-match.
  - **Disambiguation on Dispose**: per §3.3 lifecycle, when a `source: user` bee's scratch is about to be cleaned, peaks-maker **must** NL-ask the user to confirm destroy vs retain before the adapter cleans. The user's choice is recorded in `bees/bee-x/run-state.json` for a TTL window (default 7 days), so identical next-time dispatches reuse the choice.
- **Boundaries:** Does not write code. Does not modify peak-loop source. Does not auto-promote. Does not delete `.system/*`. Does not bypass the adapter layer. Does not preserve user-bee scratch without user confirmation. Does not invent CLI verbs on the user's behalf — only runs the fixed `peaks skill sediment …` surface above.

### 4.3 Adapter layer (new)

- Three named adapter modules behind `peaks skill adapter <name>`:
  - `claude` (complete) — resolves `~/.claude/skills/` as scratch dir, uses the Claude Code skill protocol: `name` + `description` YAML frontmatter, optional `references/` and script auxiliaries (see https://code.claude.com/docs/zh-CN/skills#skills-claude). The adapter materializes this exact on disk; peaks-loop never invents Claude-side fields.
  - `codex` (stub) — placeholder that errors with `ADAPTER_NOT_IMPLEMENTED`, drives future slice.
  - `copilot` (stub) — same shape, placeholder.
- `auto` adapter runs `peaks skill adapter detect`, which asks each adapter's `detect()` probe and picks the first affirmative match.

### 4.4 Sediment pool schema (described above in §3.2)

### 4.5 Promotion gate (the LLM-correctness device)

Default gate for any user/LLM-added bee:

```json
{
  "minCycles": 1,
  "requiresHumanApproval": true,
  "requiresSmokeTest": true,
  "retireOnMissesInRow": 3
}
```

Promotion flow:

1. `peaks skill sediment promote <bee>` is the only way to flip `candidate → stable`.
2. CLI computes: did the bee complete `minCycles` full request lifecycles without an incident? does the bee have a smoke test under `segments/<seg>/scripts/smoke.*` or `segments/<seg>/SKILL.md` referencing a test? has the user typed an explicit `yes` confirmation in this CLI invocation?
3. Only when all three pass does `promotion_status` flip. System bees ignore this gate (their `promotion_status = system-stable`, controlled by npm publish, never by the CLI). The "user typed an explicit yes" sub-condition is satisfied **in natural language** ("好的, 晋升" from the user, not via typing a CLI flag) — the LLM observes the user's words and supplies `--apply` on the user's behalf (see §4.1.0).

### 4.6 The diffy/hermes-agent reference scenario (concrete)

The user's original motivating scenario: peaks picks an issue, fixes it, routes the PR upstream vs fork based on contribution rules.

Today:

- diffy → upstream (correct, by accident)
- hermes-agent → user's fork (wrong, no rule encoded)

With sediment pool in place:

- A `bee-cross-repo-pr-router` bee gets added at `~/.peaks/skills/bees/bee-cross-repo-pr-router/` on first observation of the divergence. It composes two segments: `upstream-pr-detect` and `fork-pr-detect`. Both segments ship as reusable fragments at `~/.peaks/skills/segments/{upstream-pr-detect,fork-pr-detect}/`.
- The bee's manifest captures the routing rule in code: "if repo's CONTRIBUTING.md allows external PRs → upstream; otherwise → user's fork".
- `index.json` records the binding: `bee-cross-repo-pr-router → [upstream-pr-detect, fork-pr-detect]`.
- The next time peaks-loop encounters either repo, the bee is offered as a stable candidate, and once promoted, it loads on demand — no manual re-training, no peaks-loop release.

---

## 5. Data flow

### 5.1 Add-bee flow (the sediment write path)

```
user: "peaks skill sediment add-bee bee-x --segment foo --segment bar"
  │
  ▼
peaks-cli (orchid) ── routes to peaks-maker skill
peaks-maker skill ── asks user confirm (AskUserQuestion) — single short question
peaks-cli: peaks skill sediment add-bee bee-x --segment foo --segment bar --apply
  │
  ▼
validate (bee name doesn't collide under .system/bees/ or bees/)
manifest write to ~/.peaks/skills/bees/bee-x/manifest.json
  │
  ▼
SKILL.md scaffold at ~/.peaks/skills/bees/bee-x/SKILL.md
references/ symlinks (read-only) into segment refs
  │
  ▼
index.json regenerated (atomic write)
```

### 5.2 Run-bee flow (the dispatch path)

```
user (in natural language): "run bee-x for me"
  │
  ▼  LLM (acting on user's behalf)
peaks-cli reads index.json → matches bee-x → checks promotion_status
  │
  ▼
adapter.resolveScratchDir(provider=auto)
  │
  ▼
orch.materialize(bee-x) → reads bee-x/manifest.json + bee-x/SKILL.md + segments/{foo,bar}/SKILL.md
  │
  ▼
compose single envelope:
  ## preamble
  ## bee-x/SKILL.md (verbatim)
  ## segments/{foo,bar}/SKILL.md (each header in its own section)
  ## references/ (link, not copy)
  │
  ▼
adapter.publish(scratchDir, envelope)  →  runtime-native skill folder
  │
  ▼
adapter.activate(scratchDir)            →  skill loads in runtime
  │
  ▼
runtime invokes skill
  │
  ▼
on task end / red-line: adapter.cleanup(scratchDir)   ← scratch only
```

---

## 6. Error handling & failure modes

| Failure | Behavior |
|---|---|
| Manifest lint failure during `add-segment` / `add-bee` | CLI returns `MANIFEST_INVALID` with the offending field. peaks-maker re-runs the user interview, never patches in the user's mouth. |
| Adapter not implemented for active runtime (`codex` / `copilot`) | CLI returns `ADAPTER_NOT_IMPLEMENTED` with a clear "supported runtimes: claude". User is informed in natural language ("当前 runtime 不在支持列表里;请在支持的 runtime (claude) 里重试,或新增 adapter 需求"); the user responds in NL, the LLM runs `peaks skill adapter set-active claude` on the user's behalf. |
| Active runtime does not own its scratch dir (read-only FS, sandbox) | Adapter returns `SCRATCH_UNAVAILABLE`; orchestrator falls back to a per-process tempdir under `os.tmpdir()/peaks-bee-<name>-<pid>`. |
| Promotion gate fails | CLI returns `PROMOTION_GATE_FAILED` listing failed subconditions in natural language ("差 N 次成功循环 / 缺 smoke test / 缺人工 yes"). Bee remains `candidate`. User responds in NL with intent to retry or abandon; the LLM runs `peaks skill sediment promote …` after conditions are satisfied. |
| Rediscovered duplicated bee (same name across user + system) | CLI rejects the new `add-bee` with `BEE_NAME_COLLIDES`. User is informed in NL ("bee-x 与已有 bee 冲突"); user picks a path via `AskUserQuestion` or describes intent in NL; the LLM acts on the user's behalf. |
| Scratch materialization contains stale segment refs (segment retired) | CLI returns `STALE_SEGMENT_REF`; orchestrator cannot activate the bee. User is informed in NL ("bee-x 引用了已退役的 segment-y"); user describes how to repair, the LLM edits the manifest. |
| Index drift (manifest exists but not indexed, or vice versa) | `peaks skill sediment rebuild-index` rebuilds deterministically; runs at peaks-cli startup as a self-check. |
| Red-line cleanup arrives mid-task | Adapter cleans only scratch; bee's progress is preserved in `bees/bee-x/run-state.json`. On next activation orch resumes; this is the LLM-natural-stop defense (concept borrowed from peaks-loop-job, see `.peaks/memory/2026-07-03-v3-1-0-job-trigger-miss.md`). |
| `dispose --decision destroy` on a `source=system` bee | CLI rejects with `DISPOSE_SYSTEM_REFUSED`; system-bee scratch is destroyed unconditionally and silently. The user is informed in NL. |
| `dispose --decision retain` with a version that already exists for this bee | CLI rejects with `VERSION_CONFLICT`; peaks-maker asks the user in NL to bump the version explicitly. The user may accept the LLM-suggested bump or override. |
| `dispose --decision retain` on a bee whose source is system | CLI rejects with `RETAIN_SYSTEM_REFUSED`; system bees do not enter the local SkillHub. User is informed in NL. |
| `export` for a version that does not exist | CLI returns `VERSION_NOT_FOUND`; user is informed in NL. |
| `import` of a bundle whose `bee_name` collides with an existing system bee | CLI rejects with `IMPORT_NAME_COLLIDES`; the user is asked in NL to `as <new-name>` on import. |
| `gc-blobs` would remove a SHA still referenced by any release | CLI refuses with `GCOBLOBS_HAS_REFS`; the user is asked in NL to confirm `--force` (still allowed; the user is the one who understands the implication). |
| `retain` would create a `bee_release` row whose every `bee_file` SHA already exists in blobs/ (no new content) | This is the **deduped** path — perfectly valid, no error; the new version is recorded but no new blob is written. (`--no-dedup` flag exists for forcing a fresh copy, off by default.) |

---

## 7. Testing strategy

- **Schema unit tests** — JSON Schema validation for `BeeManifest`, `SegmentRef`, `SkillEnvelope`, `PromotionGate`. Lives under `tests/unit/sediment/`.
- **CLI command tests** — `tests/unit/cli/sediment.test.ts`, runs every subcommand against a sandboxed `~/.peaks/skills/`.
- **Adapter contract tests** — `tests/unit/cli/adapter.test.ts`. `claude` adapter is fully exercised; `codex` / `copilot` adapters assert `ADAPTER_NOT_IMPLEMENTED` until later slices.
- **Soft-protection vitest guard** — `tests/unit/sediment/system-dir-guard.test.ts` covers: (a) `add-bee --path .system/...` rejected, (b) `retire bee` is refused when `source=system`, (c) any path-traversal attempt to write `.system/` is refused. (Pattern: see existing `tests/unit/workspace/top-level-change-id-guard.test.ts`.)
- **Index integrity** — `tests/unit/sediment/index-integrity.test.ts` verifies determinism on `rebuild-index` against a hand-crafted dirty `index.json`.
- **Round-trip dogfood** — A script under `scripts/dogfood-sediment-cycle.sh` exercises: add segment → add bee → promote → run → dispose --decision retain → release-list → export → import. This is the closest thing to a real-world smoke test.
- **Operator manual** — `docs/operator-manual/sediment-pool.md` describes: how to add a bee, how to promote, how to read index.json, how to retire, how to retain a release, how to export / import a bundle.
- **SQLite round-trip** — A new test under `tests/unit/sediment/skillhub-store.test.ts` asserts (a) retain creates exactly one `bee_release` row, (b) `latest_version` advances, (c) `export` + `import` round-trips byte-identical manifest + SKILL.md + segments, (d) the `state.db` survives a synthetic peaks-loop upgrade (re-read + VACUUM only, no rewrite), (e) `source=system` is refused at retain-time, (f) `release-diff` between two versions returns the correct file set diff, (g) `gc-blobs` removes only unreferenced SHAs, (h) **the schema is NOT a big-JSON-blob anti-pattern**: assert that the largest single `TEXT` column is < 16KB on a 50-segment / 200-file synthetic release, and that the relational tables (`bee_manifest`, `bee_segment_ref`, `bee_file`, `bee_change`) are populated independently.

Coverage target: ≥ 95% on new files in `src/cli/sediment/`, `src/sediment/`, and `src/adapters/`.

---

## 8. Migration & rollout

The migration is the riskiest part of this slice. Four phases:

1. **Phase 1 (this slice):** Ship the new pool directory, the CLI surface, the adapter for `claude`, soft-protection guard. **No existing skill moves.** peaks-solo and friends stay in `skills/peaks-*/` exactly as today.
2. **Phase 2 (next slice):** Move the system bees (`peaks-prd`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`, `peaks-reviewer`, `peaks-solo`) into `~/.peaks/skills/.system/bees/`. The npm package's `skills/` directory becomes a thin bootstrap that copies these into the pool on `peaks-cli install` and upgrades.
3. **Phase 3 (next slice):** A user-LLM-visible demo end-to-end: `peaks skill sediment add-bee bee-arxiv-daily-watcher` from a fresh install. Captured in `docs/operator-manual/sediment-pool.md`.
4. **Phase 4 (separate slice):** Wire the 7 → 18 system-bundled skills migration through `openspec/changes/<id>/` for review.

We deliberately ship Phase 1 first to keep the diff small. Phases 2–4 each get their own peaks-solo orchestrated slice.

---

## 9. Red Lines (do not cross without explicit override)

1. **Never hard-code a vendor inside `peaks-maker` or the sediment schema.** All vendor-specific translation lives in the adapter layer.
2. **Never write to `.system/` from `peaks skill sediment …`.** System-side writes are an npm-publish concern, full stop.
3. **Never auto-promote a candidate.** `promote` is the only pathway from `candidate → stable`, and it always requires either explicit human confirmation or ≥ `minCycles` successful runs with the gate satisfied.
4. **Never store scratch materializations outside an adapter-mapped dir.** Scratch paths live in the adapter, period.
5. **Never invent new schema fields silently.** Any new field is a JSON Schema bump (`peaks.bee/1` → `peaks.bee/2`) and an `openspec/changes/<id>/` change proposal.
6. **Never break the existing peaks-solo runbook.** Solo remains a `system-stable` bee, served by the same CLI it is today.
7. **Never let LLM drift dictate the orchestrator.** Orchestration is `peaks-cli`'s job; the LLM is the consumer of the orchestrator, not the other way around.
8. **[META] Never violate the Human-NL-Choice-Only tenet (§0).** No user-facing message, gate, error, or AskUserQuestion may require the user to (a) type a CLI verb, (b) hand-author JSON / SKILL.md / manifest, (c) hand-fill a form field outside `AskUserQuestion` multi-choice, or (d) provide input that the LLM can read from natural language directly. User participation is allowed in only two prototypes: a natural-language multi-choice pick, or a free-form natural-language description. Changes to this tenet require explicit user re-confirmation (logged in §11).
9. **`~/.peaks/skills/.state.db` is the local SkillHub store (per §3.3.1).** It contains the versioned `bee_release` rows of retained user-bee snapshots. Only `source=user` bees are archived; system-bee versions live in the npm package, not here. Peaks-loop version upgrade never rewrites `state.db`; it may `VACUUM` after destructive clean. LLM never opens `state.db` directly — only via `peaks skill sediment dispose / releases / release-show / export / import …`. Schema is forward-compatible with the future online public SkillHub (§3.3.4) so no migration is required when that ships.
10. **[META] Two-Forms-Only is a global rule (§0.0).** Until a desktop client ships, the user's every action — including download / import / refine / clone / export / retain / dispose / promote / retire — is one of two forms: an `AskUserQuestion` pick, or a free-form natural-language description. The LLM runs the underlying CLI; the user never types `peaks <anything>`. When a desktop client eventually exists, it is a UI accelerator over the same verb surface; it does not introduce a new verb surface that bypasses LLM coordination. Changes require explicit user re-confirmation.

---

## 10. Open questions (for future slices)

- **Auto-healing `.system/`.** Soft protection is the chosen posture for this slice. Auto-restore on corruption is deferred.
- **Multi-machine sediment sync.** Local-only for now.
- **Adapter for runtime discoverability metadata.** Beyond loading, should adapters expose "what skills are currently active in the runtime" back to orch?
- **Promotion gate analytics.** Do we want a small dashboard showing candidate → stable flows? Future UI slice.
- **Sediment inheritance across accounts.** When the user has multiple machines, is `.system/` shared identically with `bees/`? Out of scope here.

- **SQLite scope is dispose-confirmation only** — user clarified 2026-07-04: "为保留存 SQLite". `state.db` is single-purpose; manifests stay in JSON; run-state stays in `run-state.json`. Future slices may grow the SQLite surface if a concrete need arises.
- **Local SkillHub store replaces the original "disposition log" framing** — user clarified 2026-07-04: SQLite stores the full retained skill package (manifest + SKILL.md + segments + scripts), keyed by `(bee_name, version)`. A user agreeing to retain produces a **versioned release**, not a log entry.
- **Versions are semver-like, defaulting to `0.1.0`** — peaks-maker suggests the bump; user confirms. `refine-bee` → patch bump; `clone-bee` → child starts at `0.1.0` with `parent_version`. `major` requires user confirmation.
- **Public online SkillHub is a separate future PRD** — user flagged 2026-07-04 as commercial extension. The local store is the on-ramp; the same `bee_release` row + a future bivalent export is the upload unit. Schema is forward-compatible so no migration is required when the public half ships.
- **SQLite schema is decomposed, not big-JSON-blob** — user explicitly required 2026-07-04: SQLite must not degenerate into "a JSON file in disguise". `bee_release` is small + queryable; `bee_manifest` is first-class columns; `bee_segment_ref` and `bee_file` are relational; large/binary content lives in content-addressed `blobs/` sidecar. `bee_change` rows give v→v diffs. The export = `state.db` + `blobs/`; either piece is independently portable.
- **Two-Forms-Only is the global user-interaction model** — user confirmed 2026-07-04: no client today, every action is `AskUserQuestion` pick or NL description, including download/import/refine/clone/export/retain/dispose/promote/retire; the future desktop is a UI accelerator, not a new verb surface. Lifted to project-level rule in `CLAUDE.md`. See §0.0 and Red Line #10.

---

## 11. Decision log (the backreferences that justify this design)

- **Soft protection chosen over medium/hard** — user confirmed 2026-07-04: "软保护：CLI + SKILL Boundaries + vitest 守".
- **`.system/` hidden dir for physical isolation** — user confirmed 2026-07-04: "用不同的目录进行物理空间划分 + 隐藏文件夹的形式命名防止误删".
- **Semantic flatness** — user confirmed 2026-07-04: "级别上是平级的没有主次之分".
- **Vendor neutrality** — user confirmed 2026-07-04: "不要硬编码 claude，也要适配不同厂商的 AI CLI".
- **Vendor-neutral precedent** — `.peaks/memory/slim-ideadapter-shape-is-the-contract.md` + `.peaks/memory/ide-adapter-resource-profile-framework.md`. This slice pushes the same principle upward to the skill layer.
- **Pool-only-on-write, scratch-only-on-read** — follows the same separation of concerns in `.peaks/memory/active-skill-cli-routing.md`.
- **Promote gate modeled after peaks-sop `lint → check → register`** — `.peaks/memory/custom-sop-and-gate-metering.md`.
- **LLM-natural-stop defense via on-disk run-state** — `.peaks/memory/2026-07-03-v3-1-0-job-trigger-miss.md`.
