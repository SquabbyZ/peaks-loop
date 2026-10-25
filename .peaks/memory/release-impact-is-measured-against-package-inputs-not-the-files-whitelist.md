---
name: release-impact-is-measured-against-package-inputs-not-the-files-whitelist
description: 发版影响面要对「包的输入集」算，不对 package.json#files 白名单算——dist/ 占 tarball 2889 文件里的 2670 个且被 gitignore，白名单集合差会结构性漏掉 src/ 与 packages/ 的全部影响
metadata:
  type: project
  node_type: memory
  modified: 2026-10-25T14:40:00.000Z
---

# 发版影响面要算「输入集」，不是 `package.json#files` 白名单（2026-10-25 实测）

## 事实

根包 `peaks-loop` 的 npm tarball 实测 **2889 个文件 / 12,057,510 B**（`npm pack --dry-run --json --ignore-scripts`）：

| 顶层 | 文件数 | 来源 |
|---|---|---|
| `dist/` | **2670**（92.4 %） | `tsconfig.build.json`：`rootDir: "src"` / `outDir: "dist"` / `include: ["src/**/*.ts"]`；另有 `copy-templates.mjs` 从 `src/services/workspace/templates/project-scan`、`src/services/skillhub/migrations` 拷入 |
| `skills/` | 158 | 白名单直发（`skills/**` 一条 glob 展开成 158 个文件） |
| `schemas/` | 28 | 白名单直发（`schemas/*.json`） |
| `scripts/` | 19 | 白名单直发（19 条逐文件条目） |
| `contracts/` `config/` `bin/` | 2 / 2 / 2 | 白名单直发 |
| `.claude-plugin/` `agents/` `output-styles/` `CHANGELOG.md` `LICENSE` `README.md` `README-en.md` `package.json` | 各 1 | 白名单直发 / npm 必带 |

根包还以 `workspace:*` 依赖 4 个内部包（`peaks-loop-internal-runtime` / `-mut` / `-shared` / `-shared-channel`），
`scripts/release-pack.mjs` 在打包时把它们改写成精确版本号并**各自单独发布**。

## 为什么「`git diff` ∩ `package.json#files`」这个方法是错的

三个各自独立的错：

1. **白名单是「目的地」清单，不是「来源」清单。** `dist/` 占 tarball 的 92.4 %，而 `.gitignore:2` 把
   `dist/` 整个忽略 ⇒ **`git diff --name-only` 永远看不到它**。改一行 `src/` ⇒ 白名单交集为空，
   而消费者的包**完全不同**。同理 `packages/**` 不在根包白名单里，却会改变根包的依赖图与四个内部包自身的版本。
2. **白名单的一条不是「一个文件」。** `skills/**` 是 1 条 glob → 158 个文件；`schemas/*.json` → 28 个；
   还有 npm 的取反语义（`!skills/**/test-prompts.json`）。拿**路径**去和**glob**求交是错的运算，
   必须像 npm 那样展开（`npm pack --dry-run --json` 就是权威展开结果）。
3. **`package.json` 与 `CHANGELOG.md` 每次发版都变。** `scripts/bump-version.mjs` 改 `package.json#version`，
   而 `package.json` 永远在 tarball 里；`CHANGELOG.md` 在白名单里、发版条目由人手写。
   ⇒ 「白名单里有没有东西变了」在发版场景**恒为真**，这个测试只有在**排除发布元数据**之后才携带信息。

## 正确方法

**廉价前置检查**（不构建）：把 `git diff <上次发布tag>..HEAD --name-only` 对**输入集**算，不对白名单算：

- `src/**`、`packages/**` —— 经 `dist/` 与内部包间接到达消费者；
- 直发树：`skills/`、`agents/`、`output-styles/`、`schemas/`、`contracts/`、`.claude-plugin/`、
  `scripts/`、`bin/`、`config/eslint/`；
- **排除发布元数据**：`package.json`、`CHANGELOG.md`、`README*.md`、`LICENSE`。

**权威检查**（构建后）：`npm pack --dry-run --json --ignore-scripts` 给出「这次会发什么」的权威文件清单，
再与已发布 tarball 的清单对比（`npm pack peaks-loop@<lastVersion> --dry-run --json`）——差集才是消费者真实看到的差异。

⇒ 两层都空 ⇒ 这次发版对消费者是**零差异**，不值得占用一个版本号。

## 本次实测（2026-10-25）

`v4.1.20..HEAD` 共 17 个改动文件（codegraph 修复 2 个 commit + 测试时长护栏 2 个 commit）：
`.github/workflows/ci.yml`、`.gitignore`、`.husky/test-duration-ratchet*`、`.peaks/lint/**`、
`.peaks/memory/**`、`codegraph.json`、`tests/unit/lint/test-duration-ratchet*.test.ts`、
`tests/unit/standards/vitest-worker-cap.test.ts`、`vitest.workers.ts`。

用**输入集**算：**产品影响 = 空**。全部 17 个都是开发期文件，不进 tarball。
（`vitest.workers.ts` 在仓库根，`tsconfig.build.json` 只 include `src/**/*.ts`，所以它也**不**进 `dist/`。）

⇒ 4.1.21 对消费者零差异 ⇒ **不发**，等下一次真正动 `src/` 或 `packages/` 的改动一起发。

> 早先用「白名单集合差」得出的同一结论是对的，但**理由是错的**（靠运气没碰上 `src/` 改动）。
> 换成输入集之后，结论有了机制支撑。

## 复核命令

```powershell
# 权威清单
npm pack --dry-run --json --ignore-scripts | Out-File "$env:TEMP\pack-dryrun.json" -Encoding utf8

# 输入集核对
node .peaks/_runtime/2026-10-25-session-267981a1/sc/release-impact.cjs
git diff --name-only v4.1.20..HEAD

# 上次发布
git tag --list 'v*.*.*' --sort=-v:refname | Select-Object -First 1
npm view peaks-loop version
```

相关：[[unit-suite-duration-is-a-linear-function-of-file-count]]
