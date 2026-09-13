---
name: codegraph-default-excludes-hide-real-source
description: codegraph 上游默认 exclude 按目录名匹配，静默吞掉本项目 26 个真实源文件；修法在未被 git 跟踪的 .codegraph/config.json，会被 init/升级打回
metadata:
  type: project
  node_type: memory
  originSessionId: bd89a11a-b66d-443c-b8b7-e9aa813190c2
  modified: 2026-09-12T04:19:55.506Z
---

# codegraph 默认 exclude 静默吞掉真实源文件（2026-09-12）

## 事实

`.codegraph/config.json`（**未被 git 跟踪**，仓库级 .gitignore 忽略整个 `.codegraph/`）的 `exclude` 是上游默认模板（99 条），按**目录名**匹配。它在本仓库误伤 5 条：

| 规则 | 本仓库里被吞掉的真实源码 |
|---|---|
| `**/artifacts/**` | `src/services/artifacts/*.ts` — 8 个核心 service |
| `**/release/**` | `src/services/release/*.ts` — 2 个 |
| `**/vendor/**` | `packages/peaks-loop-internal-runtime/src/vendor/*.ts` — 6 个 adapter |
| `**/bin/**` | `bin/peaks.js`、`bin/peaks-cron-scheduler.js` — CLI 入口 |
| `**/publish/**` | `tests/unit/publish/*.test.ts` |

合计 **26 个 tracked TS/JS 文件**（`git ls-files` ⊖ 索引 = 26，全部由这 5 条解释）。

后果是静默的：`peaks codegraph status` 照报 `[OK] Index is up to date`，`affected` / `context` 只是查不到这些文件——不会报错。

## 修法（本次已做）

删掉那 5 条（保留 `**/target/release/**`、`**/Debug/**`、`**/Release/**`——那是真构建产物约定），再 `peaks codegraph index --force`。
结果：1,091 → **1,117** 文件，与 `git ls-files` 的 TS/JS 数**完全相等**（missing=0）。验证：`query createArtifactInitPlan` 能命中 `src/services/artifacts/artifact-service.ts:63` 且带 importer 边。

## Why

上游模板是"跨语言生态公约"（`vendor/` 属 PHP/Go、`release/` 属构建产物），但 peaks-loop 自己把这两个词用作了**源码目录名**。按名匹配的排除表遇到"词义被重载"就静默失效——不报错、不退化为警告，只是图上少了一块。

同理可推：任何按目录名做判断的第三方工具（排除表、扫描器、覆盖率收集）在本仓库都可能踩同样的词义重载。

## How to apply

1. **索引"OK"不等于索引"完整"。** 判断完整性要用集合差：`git ls-files`（按扩展名过滤）⊖ 索引内容。`status` 的 `up to date` 只说明图与上次扫描一致。
2. 改完 `.codegraph/config.json` 必须 `index --force`——**增量索引不会删陈旧条目**：本次首次 `--force` 就掉了 6 个此前残留的陈旧 file 条目（1,097→1,091）。反过来说，做集合差之前要先 force 重建，否则分不清"被排除"和"已陈旧"。
3. **这个修复是易失的**：config 未被跟踪，且 `peaks codegraph init` 会按上游模板重写它 → 换机器、重跑 init 或升级都可能打回。复发症状就是文件数莫名回落到 1,09x。
4. 别把 `**/bin/**` 当垃圾：本仓库的 CLI 入口就在 `bin/`。

相关：[[codegraph-dangling-marker-autorefresh-fix]]（同样是"归谁管"与"能不能用"混淆导致的静默失效）。
