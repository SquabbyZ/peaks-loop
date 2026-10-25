---
name: codegraph-1-6-2-default-ignore-drops-tracked-source
description: codegraph 1.6.2 升级后 exclude 模板消失，缺口改由内置 DEFAULT_IGNORE_DIRS + gitignore 播种造成；修法是 .gitignore 反选（vendor）+ codegraph.json include（best-practice）
metadata:
  type: project
  node_type: memory
  modified: 2026-10-25T04:00:00.000Z
---

# codegraph 1.6.2 的默认忽略机制静默吞掉 tracked 源码（2026-10-25）

## 事实

codegraph 从 0.7.x 升到 1.6.2 之后，[[codegraph-default-excludes-hide-real-source]] 记的那个"删 `.codegraph/config.json` 里 5 条 exclude 规则"的修法**整体失效**，而且缺口换了一套成因：

1. **1.6.x 不再读 `.codegraph/config.json`**。per-project 配置的唯一位置是 `<root>/codegraph.json`；`include` 的语义也从"白名单"翻转成"强制纳入"。上游 1.6.x **不再附带 99 条 exclude 模板** —— 所以"删模板里那 5 条"这个动作已经无处可删。
2. **新的缺口来源是 `DEFAULT_IGNORE_DIRS`**（`@colbymchenry/codegraph@1.6.2` 的 `lib/dist/extraction/index.js`）。它是一份按**目录名**匹配的跨语言生态公约表（`node_modules` / `dist` / `vendor` / `target` / `Pods` / …），**对 git-tracked 文件同样生效**，唯一opt-in 是 `.gitignore` 里的反选。
3. **第三个来源是 gitignore 播种**：`buildScopeIgnore` 会跑 `git ls-files -o -i --exclude-standard --directory`，把 git 报告的 ignored 目录**当作模式加进匹配器**。gitignore 语义下，无前导斜杠的 `best-practice/` 匹配**任意深度**同名目录 —— 所以根级 artifact 目录 `/best-practice/` 会连带吞掉 `src/services/best-practice/` 和 `tests/unit/best-practice/`。这一条**`.gitignore` 反选救不回来**（播种在最后，反选会被压过），只有 `codegraph.json` 的 `include` 通道能覆盖。

本仓库实测：**17 个 tracked 源文件**被静默丢弃 —— `vendor/` 下 11 个（`packages/peaks-loop-internal-runtime/src/vendor/` 7 个 + `tests/unit/**/vendor/` 4 个）+ `best-practice/` 下 6 个（`src/services/best-practice/` 3 个 + `tests/unit/best-practice/` 3 个）。`peaks codegraph status` 照报 `[OK] Index is up to date`，因为它比的是"图 vs 上次扫描的输入"，而排除规则在**两侧同样生效**（见 [[codegraph-status-ok]]）。

## 修法（本次已做，两条通道各司其职）

| 通道 | 治谁 | 为什么只能是它 |
|---|---|---|
| `.gitignore` 反选 | `vendor/` 11 个 | `vendor` 在 `DEFAULT_IGNORE_DIRS` 里，**`include` 救不回来**（`ScopeIgnore.ignores()` 里 `include` 分支被 `!this.defaults.ignores(rel)` 挡住）；上游文档化的 opt-in 就是 `.gitignore` 反选 |
| `codegraph.json` 的 `include` | `best-practice/` 6 个 | gitignore 播种在匹配器**最后**加，`.gitignore` 反选被压过；`include` 分支在 `rootMatcher` **之前**返回 false，是唯一能覆盖它的通道 |

两条都不是"删规则"——1.6.x 没有模板可删。

### `.gitignore` 反选必须**锚定到精确路径**，不能写全局 `!vendor/`

上游把 defaults → 根 `.gitignore` → git ignored 目录**依次**加进同一个 `ignore` 实例，后加的赢。全局 `!vendor/` 会连带把 `node_modules/**/vendor/**` 放进来。实测（`ignore@7.0.6`，上游自带的版本）：

```
!vendor/                                    -> src/vendor/adapter.ts      ignored=false  ✅
                                              node_modules/foo/vendor/bar.js ignored=true  ✅（node_modules/ 目录本身被排除，反选进不去）
```

`node_modules/` 是靠**目录排除**保护的，所以全局反选其实也安全；但仓库里只有这三个 first-party vendor 目录，**写精确路径**更稳，也顺带说明了"为什么是这三条"。本次写入：

```
!/packages/peaks-loop-internal-runtime/src/vendor/
!/tests/unit/runtime/vendor/
!/tests/unit/vendor/
```

### `codegraph.json` 的 `include` 要写成**目录锚定**的形式

```json
{ "include": ["src/services/best-practice/", "tests/unit/best-practice/"] }
```

上游从 `include` 模式推出**静态前缀**（`includeStaticRoots`）供目录遍历器使用，所以祖先目录被排除时仍能走到目标子树。缺了这个，walker 会在 `src/services/` 就被剪掉。

### 验证

`index --force` 后：**2335 → 2352 文件**，集合差 `git ls-files`（源扩展名）⊖ 索引清单 = **0**，且索引里**没有**任何非 tracked 文件。符号级抽查：`detectLanguage` / `scanBestPractice` / `detectBinaryInstalled` 都带完整签名与 importer 边可查。

## Why

**"升级会让一个曾经有效的修复整体失效，而且不报错。"** 0.7.x 的修法是"删模板里的 5 条规则"，1.6.x 里那 5 条规则不存在了 —— 动作无声地变成 no-op，缺口换了个成因继续存在。**修法必须跟着机制走，而不是记住动作。**

推论：**修复位置要选"上游不重写"的地方。** 上游 `init` 只写 `codegraph.json` 的 `includeIgnored`（用于 nested repo opt-in），**从不重写 `include`** —— 所以 `codegraph.json` 里的 `include` 是持久的。反之 `.codegraph/config.json`（0.7.x 位置）不仅没人读，还被 `.gitignore` 忽略、未被跟踪。

## How to apply

1. **升级 codegraph / peaks-loop 后，第一件事是重算集合差**：`git ls-files`（按扩展名过滤）⊖ `peaks codegraph files --json` 的 path 集合。`status` 的 `[OK]` 不代表完整 —— 排除规则在求差的两侧同时生效。
2. **先查排除来源，再决定用哪个通道**。上游 1.6.2 有三个来源，优先级：`codegraph.json` 的 `exclude`（用户自己写的）> `gitignore` 播种 > `DEFAULT_IGNORE_DIRS`（内置）。`exclude` 会压过一切；`include` 只压得过 `rootMatcher`（gitignore 播种 + 默认表），压不过 `exclude`，也压不过内置默认表。
3. **改了排除规则必须 `index --force`**：增量索引不会删陈旧条目（[[codegraph-default-excludes-hide-real-source]] 已记），但新增条目增量也会进 —— 稳妥起见 force。
4. **`.gitignore` 反选写精确路径**，别写全局 `!vendor/`。
5. **别把 `vendor` 当垃圾**：本仓库的 sub-agent vendor adapters 就在 `vendor/` 里。同类的还有 `skills/`（eslint `ignorePatterns` 吞过）、`best-practice/`、曾经�� `artifacts/` 与 `release/` —— 全是"目录名被生态公约重载"的同一类问题。

相关：[[codegraph-status-ok]]、[[codegraph-default-excludes-hide-real-source]]、[[codegraph-dangling-marker-autorefresh-fix]]
