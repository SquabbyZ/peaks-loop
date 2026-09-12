---
name: codegraph-status-ok
description: 判断索引完整性要用集合差，codegraph status 的 [OK] 只说明图与上次扫描一致
metadata:
  type: module
  sourceArtifact: .peaks/_runtime/2026-09-12-session-e37ef0/txt/handoff.md
---

`@colbymchenry/codegraph` 的默认 `exclude` 含 5 条**按目录名**匹配的规则：`**/artifacts/**`、`**/release/**`、`**/vendor/**`、`**/bin/**`、`**/publish/**`。在本仓库它们挡掉了 **26 个 git-tracked 源文件**（真实源码目录恰好叫这些名字），而 `peaks codegraph status` 仍报 `[OK] up to date`。根因：`status` 比较的是"图 vs 上次扫描的输入"，而 `exclude` 规则在**两侧同样生效**，所以缺口对它是不可见的。**而且修复落在 `.codegraph/config.json`，该文件被 `.gitignore:8` 忽略、未被 git 跟踪** —— 任何 `init` / 包升级都会把修好的 94 条规则打回上游默认值，缺口随之复发。正确判据是集合差：`git ls-files`（tracked 源文件）⊖ 索引实际收录的文件集合，再对差集逐条给出命中的 `exclude` 规则。

**Why:** `status` 的 "up to date" 是**自洽性**断言，不是**完整性**断言。一个把输入和输出用同一套规则过滤掉的系统，永远能自证一致。

**How to apply:** 判断"索引是否完整"必须用两个独立来源求差（git 跟踪清单 ⊖ 索引清单），不要读 `status`。任何**未被 git 跟踪**的配置文件（`.codegraph/config.json` 是典型）上的修复都是**易失**的 —— 要么推上游改默认规则，要么在 init / 升级路径上挂自愈（本切片 M4 做的就是这个，但只在接缝层有单测，缺端到端断言）。
