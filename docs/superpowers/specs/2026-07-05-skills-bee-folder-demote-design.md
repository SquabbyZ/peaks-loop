# Skills → `skills/bee/` Folder Demote — Design

**Status:** Draft (post-brainstorming, pre-writing-plans)
**Date:** 2026-07-05
**Author:** SquabbyZ (via peaks-code brainstorm 2026-07-05)
**Affects:** `skills/peaks-{prd,rd,qa,ui,sc,txt,perf-audit,security-audit,reviewer}/` (9 dirs)
**Target version:** 4.1.0 (same release as the rename)

## 0. 动机(Motivation)

User 在 2026-07-05 rename 出版后查 `skills/` 目录,发现 19 个 skill 同层摆放,问"peaks-rd 等还在,不是下沉到 bee 层了吗"。这暴露了 spec §1.4 的设计语义与物理结构不一致:

- **Spec §1.4 描述**:6 个 role skill 通过 `metadata.visibility: internal` + `userInvocable: false` **语义下沉**到 bee 层
- **物理现实**:6 个 role skill 仍与 13 个 public skill 同层放在 `skills/` 顶层
- **结果**:User 在 `ls skills/` 时看到 19 个 skill 同层,无法凭直觉区分 user-facing 与 internal

`peaks-perf-audit` / `peaks-security-audit` / `peaks-reviewer` 也属于 internal(没有 user-facing trigger),一并下沉以保持分层语义自洽。

## 1. 范围(Scope)

### 1.1 In-Scope

| 对象 | 改动 |
|---|---|
| `skills/bee/peaks-prd/` | `git mv skills/peaks-prd skills/bee/peaks-prd` |
| `skills/bee/peaks-rd/` | `git mv skills/peaks-rd skills/bee/peaks-rd` |
| `skills/bee/peaks-qa/` | `git mv skills/peaks-qa skills/bee/peaks-qa` |
| `skills/bee/peaks-ui/` | `git mv skills/peaks-ui skills/bee/peaks-ui` |
| `skills/bee/peaks-sc/` | `git mv skills/peaks-sc skills/bee/peaks-sc` |
| `skills/bee/peaks-txt/` | `git mv skills/peaks-txt skills/bee/peaks-txt` |
| `skills/bee/peaks-perf-audit/` | `git mv skills/peaks-perf-audit skills/bee/peaks-perf-audit` |
| `skills/bee/peaks-security-audit/` | `git mv skills/peaks-security-audit skills/bee/peaks-security-audit` |
| `skills/bee/peaks-reviewer/` | `git mv skills/peaks-reviewer skills/bee/peaks-reviewer` |
| `.claude-plugin/marketplace.json` | 9 个条目的 `source` 路径同步改为 `./bee/peaks-X` |
| `peaks skill visibility` CLI | 自动通过 marketplace 重新加载 — 不需改代码 |
| 仓库引用扫描 | `grep -rln "skills/peaks-{prd,rd,qa,ui,sc,txt,perf-audit,security-audit,reviewer}"` 全部更新路径 |
| 消费项目实测 | ice-cola smoke test 确认 visibility 输出不变 + sub-agent dispatch 仍工作 |

### 1.2 Out-of-Scope

- **不动 `skills/{peaks-code,peaks-resume,peaks-status,peaks-test}/`** —— user-facing 顶层
- **不动 `skills/{peaks-audit,peaks-doctor,peaks-final-review,peaks-ide,peaks-slice-decompose,peaks-sop}/`** —— 这 6 个是 user-facing helper(有 `/<name>` trigger)
- **不动 skill id** —— 6 个 role skill 的 `name:` 字段不变,只改物理路径
- **不动 frontmatter visibility 标记** —— Task 1 已加 `metadata.visibility: internal`,这次只改物理位置
- **不动 pool 路径** —— `~/.peaks/skills/.system/bees/peaks-code/manifest.json` 路径与本任务无关(那是 pool 运行时)

## 2. 设计(Design)

### 2.1 最终目录结构

```
skills/                                          # 顶层 = user-facing 入口
├── peaks-code/                                  # NEW (rename 后)
├── peaks-resume/                                # NEW (rename 后)
├── peaks-status/                                # NEW (rename 后)
├── peaks-test/                                  # NEW (rename 后)
├── peaks-audit/                                 # user-facing helper
├── peaks-doctor/                                # user-facing helper
├── peaks-final-review/                          # user-facing helper
├── peaks-ide/                                   # user-facing helper
├── peaks-slice-decompose/                       # user-facing helper
├── peaks-sop/                                   # user-facing helper
└── bee/                                         # NEW (LLM-internal 角色)
    ├── peaks-prd/
    ├── peaks-rd/
    ├── peaks-qa/
    ├── peaks-ui/
    ├── peaks-sc/
    ├── peaks-txt/
    ├── peaks-perf-audit/
    ├── peaks-security-audit/
    └── peaks-reviewer/
```

**新顶层 skill 数量**: 4 (rename) + 6 (helper) = **10 个 user-facing**
**bee 层**: 9 个 LLM-internal

### 2.2 Marketplace schema 改动

每个 internal skill 的 `source` 字段从 `./skills/peaks-X` 改为 `./skills/bee/peaks-X`。

```diff
   {
     "name": "peaks-prd",
     "userInvocable": false,
-    "source": "./skills/peaks-prd"
+    "source": "./skills/bee/peaks-prd"
   }
```

### 2.3 sub-agent dispatch 兼容性

`peaks sub-agent dispatch --role rd` 通过 `peaks sub-agent` CLI 解析 skill 路径。如果 CLI 用 marketplace.json 的 `source` 字段,移动后**自动适配**;如果硬编码 `./skills/${role}`,需修复一处。先查源码确认。

## 3. 验收(Acceptance)

- **AC-1:** `ls skills/` 顶层恰好 10 个目录(`peaks-code / peaks-resume / peaks-status / peaks-test / peaks-audit / peaks-doctor / peaks-final-review / peaks-ide / peaks-slice-decompose / peaks-sop`)
- **AC-2:** `ls skills/bee/` 恰好 9 个目录(6 role + 3 audit)
- **AC-3:** `peaks skill:visibility --list --json` 仍然输出 4 public + 6 internal + 6 helper + 9 bee(总 25? 不,总 = 4 + 6 + 9 = 19;helper 中 peaks-sop 是 public)
- **AC-4:** `peaks sub-agent dispatch --role rd --dry-run`(或类似)能解析到 `skills/bee/peaks-rd/SKILL.md`
- **AC-5:** 全量 vitest 0 new failure
- **AC-6:** `git grep "skills/peaks-{prd,rd,qa,ui,sc,txt,perf-audit,security-audit,reviewer}" -- ':!skills' ':!docs/superpowers'` 仅在历史 docs / .peaks/memory / .git/sdd 命中(白名单)
- **AC-7:** ice-cola consumer 项目 smoke test:visibility + presence + migrate 仍绿

## 4. 风险

| 风险 | 缓解 |
|---|---|
| `peaks sub-agent dispatch` 硬编码 `./skills/${role}` | 先 grep 查 CLI 源码,如有硬编码在 plan 里覆盖 |
| test fixture hardcode `skills/peaks-{prd,rd,...}` | grep-replace + 定向 vitest |
| `.peaks/_runtime/...` 旧会话引用旧路径 | 路径属于 session metadata,新会话自动用新路径;旧会话失效可接受 |
| pool manifest `.peaks/skills/.system/bees/peaks-code/` 路径 vs `skills/bee/` 路径名冲突 | 不同层次:pool 是运行时 cache,skills/bee/ 是 source repo;无冲突 |

## 5. 硬约束(继承 rename spec HC-1 ~ HC-8)

- **HC-1** 一次到位,单 atomic commit 包含 9 个 `git mv` + marketplace 改 + 引用扫描
- **HC-4** 禁假绿:每个 sub-agent 必须附 `peaks skill:visibility --list` + vitest 实测输出
- **HC-5** 禁偷懒:9 个 skill 全移,不跳
- **HC-6** 全量回归:vitest + ice-cola smoke
- **HC-7** ≥ 2 个独立 sub-task 用 fan-out
- **HC-8** user 不介入(已确认)

---

**Related designs / memory:**
- `docs/superpowers/specs/2026-07-05-peaks-code-to-peaks-code-rename-design.md` §1.4 (语义下沉,本 spec 把语义升级为物理)
- `docs/superpowers/plans/2026-07-05-peaks-code-to-peaks-code.md` Task 1 (visibility 标记)