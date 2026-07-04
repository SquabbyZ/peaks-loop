---
name: peaks-loop-local-skillhub
description: peaks-loop 的本地 SkillHub 存储 = 一等公民 store,持保留的完整 skill 副本,带版本号;为未来线上公共 SkillHub 留 on-ramp
metadata:
  type: project
  createdAt: 2026-07-04
  source: brainstorm session for `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` (user note chain)
---

# peaks-loop = 本地 SkillHub + 未来线上公共 SkillHub

> **Why:** 用户 2026-07-04 经过一连串澄清后给出的最终定义:SQLite 不是"disposition log",而是"用户同意保留的完整 skill 包 + 版本号 + 可分享/微调"——也就是"本地 skillhub 存储"。这条直接把 4.x sediment-pool 的产品形态从"沉淀池"升级为"沉淀池 + 版本化库"。
>
> **How to apply:** 任何关于 SQLite / state.db / dispose / retain 的设计、命名、CLI verb,必须围绕"本地 SkillHub 一等公民 store"展开,不是围绕"disposition log"。早期把 SQLite 描述为 disposition log 的草稿已废弃,本条是正解。

## 1. 关键定义(不要混淆)

| 旧措辞(已废弃) | 新措辞(正解) |
|---|---|
| "disposition log" / "dispose-confirmation history" | **local SkillHub store** |
| `bee_disposition` 表 | **`bee_release` 表**(每行 = 一份带版本号的完整 skill 包) |
| "retain" = 写一行 audit | **"retain" = 写入一份 `bee_release` 行,内含 manifest + SKILL.md + segments + scripts;`latest_version` 推进** |
| "destroy" = 不写一行 audit | **"destroy" = 不写 SkillHub,scratch 直接清** |
| user 拷给别人 = "拷贝文件" | **user 拷给别人 = 走 `peaks skill sediment export` (产 tar.gz) + `peaks skill sediment import`** |
| 一张大 JSON BLOB | **6 张关系表 + content-addressed `blobs/` sidecar** |

## 2. Schema — Decomposed, NOT big-JSON-blob

Per user 2026-07-04 final note: **SQLite 不能是伪装的大 JSON 文件**——会臃肿、难迁移、难管理。Schema 必须**分解**成多张关系表,只在必要处放小 JSON 数组(segments 名字表、side-effects 列表等),二进制/大文件走 `blobs/` sidecar。

```sql
-- 6 张表(主表 + 元数据 + 关系 + 文件 + 变更)
CREATE TABLE bee_release     (id, bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog);
CREATE TABLE bee_release_pointer (bee_name → latest_version);
CREATE TABLE bee_manifest    (release_id, schema_version, description, segments_json [names only], entrypoint_preamble, promotion, min_cycles, requires_human, requires_smoke, retire_on_misses);
CREATE TABLE bee_segment_ref (release_id, segment_name, inputs_json, outputs_json, side_effects);
CREATE TABLE bee_file        (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path);
CREATE TABLE bee_change      (release_id, change_kind, target_kind, target_name, detail);

-- 文件 sidecar
~/.peaks/skills/blobs/<sha[0:2]>/<sha256>    -- content-addressed
```

**为什么分解,不是大 JSON**:
- **查询**:`WHERE description LIKE '%arxiv%'` 在 BLOB 上要 `json_extract()`;在普通列上直接走索引。
- **diff**:v0.1.0 → v0.1.1 用 `SELECT * FROM bee_file WHERE release_id IN (?,?)` 一行 JOIN 即可;大 JSON 必须跑 `diff json_a json_b` 输出噪声。
- **大小**:一个 5-segment × 3-file × 50KB 的 bee = 750KB;大 JSON 模式 = 750KB × N 版本 = 100MB+;分解模式 = 750KB blob(去重) + 几张几 KB 的表。
- **可移植性**:`state.db`(关系查询) + `blobs/`(内容) 两部分可独立 export/import。
- **变更追溯**:`bee_change` 一行一改,`v0.1.0 → v0.2.0 改了哪些文件` 一句 SQL 答出。

**CLI verb** 新增 `release-diff` (v→v 集合 diff) + `gc-blobs` (清理孤儿 SHA,默认 dry-run)。

**为什么用 SQLite 而不是 JSON 文件**:
- 版本化 + append-only 天然适配 SQL;JSON 文件要 N 个 `v0.1.0/`, `v0.2.0/` 文件夹,难 query 难打包。
- 未来线上 public SkillHub 上传 = 直接 `state.db` + bivalent export,**schema 兼容,不需要迁移**。
- 单文件 `tar` 是最便携的"分享给队友"包;接收方 `peaks skill sediment import <bundle>`。

## 3. 版本语义(npm-like)

| 事件 | 版本变化 |
|---|---|
| 首次 retain | `0.1.0` |
| `refine-bee`(in-place 微调) | **patch bump** (`0.1.0 → 0.1.1`) |
| `clone-bee`(整体复制) | 子 = `0.1.0`,`parent_version` 指向源的最新版 |
| `major` bump | 必须 user 显式确认;LLM 不可单独决定 |

CLI verb: `peaks skill sediment dispose <bee> --decision retain --version <v>`。LLM 不能自己挑版本;**必须 user 确认**。

## 4. 商业延展:线上 public SkillHub

Per user 2026-07-04 final message: 未来要扩展到**线上公共 SkillHub**,有商业价值。本地 store 是 on-ramp,不是终态。

- 未来 verb: `peaks skill sediment publish <bee> --version <v>`(出本 slice 后另开 PRD)
- API 形态:定义在 peaks-cli 层,不绑特定 vendor;可自托管 / 可走公共 registry
- schema 兼容:本地 `bee_release` 的每行可直接打包上传,无需迁移

## 5. 越界清单(任何命中都重写)

- × 把 SQLite 描述为 "disposition log" / "audit table"——本条正解是 SkillHub store
- × 让 LLM 决定版本号(必须 user 拍板)
- × 让 system-bee 进 SkillHub(`source='user'` 是硬约束)
- × 让 user 写 SQL(`peaks skill sediment …` 是唯一入口)
- × 用 JSON 文件夹代替 SQLite 版本化
- × 在 peaks-loop 升级时改写 `state.db`(只 VACUUM)
- × 把 bee 整段 manifest / segments 塞进一个 JSON BLOB 字段——必须**分解**到多张关系表 + content-addressed blobs/

## 6. 关联

- `docs/superpowers/specs/2026-07-04-peaks-maker-dynamic-skill-sediment-design.md` — §3.3.1 (schema) + §3.3.2 (version) + §3.3.3 (store 一等公民) + §3.3.4 (public extension) + §0.1 (项目宗旨) + §4.2 (CLI 5 个新 verb) + §6 (5 个新 error code) + §9 Red Line #9 + §10 Open questions + §11 Decision log
- [[human-nl-choice-only-tenet]] — 优先级: 本条次于 human-nl-choice-only
- [[peaks-loop-is-enhancement-not-new-cli]] — 商业延展不破"增强层,不造新 AI CLI"红线(公共 SkillHub 是数据层,不是 shell 层)
- [[4x-sediment-pool-reserves-desktop-client-entry-points]] — 桌面客户端读 `state.db` 是本条设计的核心场景之一
