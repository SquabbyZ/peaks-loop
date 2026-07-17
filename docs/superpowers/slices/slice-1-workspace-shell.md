# slice-1-workspace-shell — 完成报告

**change-id:** slice-1-workspace-shell
**date:** 2026-07-17
**session:** 2026-07-17-session-1d5ac0
**type:** monorepo 骨架空壳

## 一、目标

在 peaks-loop 单仓内建立 pnpm monorepo 工作区空壳,为后续 6 个子包拆分(slice-2~slice-7)预留位置。

## 二、产出(4 个新文件)

| # | 路径 | 作用 |
|---|------|------|
| 1 | `pnpm-workspace.yaml` | 声明 `./packages/*` 为 workspace 成员 |
| 2 | `tsconfig.base.json` | 共享 TypeScript 编译选项(7 个字段,子包可 extends) |
| 3 | `packages/.gitkeep` | 占位文件,确保 `packages/` 被 git 追踪 |
| 4 | `docs/superpowers/slices/slice-1-workspace-shell.md` | 本报告 |

## 三、本 slice **未触碰**(留给后续 slice)

- `src/**` / `tests/**` / `bin/**` / `scripts/**`
- 主包 `package.json`(主包元数据不变)
- 现有 `tsconfig.json` / `tsconfig.build.json`(本 slice **不**让它们 extends base)
- `.github/workflows/publish.yml`(OIDC 流程不搅)
- `.gitignore`

## 四、设计要点

- **pnpm-workspace.yaml 只声明 `./packages/*`**;不指向 `examples/`、`docs/`、`tools/`,避免误识别为可发布子包。
- **tsconfig.base.json 只承载 7 个真正可被 6 个子包共享的字段**:`target` / `module` / `strict` / `lib` / `esModuleInterop` / `skipLibCheck` / `declaration` / `declarationMap` / `sourceMap`。运行/构建专属字段(`rootDir` / `outDir` / `moduleResolution` / `noUncheckedIndexedAccess` / `exactOptionalPropertyTypes` / `types` / `forceConsistentCasingInFileNames` / `noEmitOnError`)**故意不**放入 base,以免后续 slice 把现有 `tsconfig.json` 改为 `extends` 时被 base 反向覆盖。
- **packages/.gitkeep** 让 git 追踪空目录;pnpm 看到 glob 命中一个非空文件就不会报 "No packages found"。

## 五、验证(已跑通)

| 项 | 命令 | 实测 |
|----|------|------|
| `pnpm install` | `pnpm install` | **PASS** — Done in 767ms;workspace glob 命中 `packages/.gitkeep`,无 "No packages found" 警告;postinstall `install-skills.mjs` 仍正常。 |
| 主包 build | `pnpm build` | **PASS** — sync-version → clean-dist → `tsc -p tsconfig.build.json` → copy-templates 全部成功,主包 dist 产物正常。 |
| `pnpm -r build` | `pnpm -r build` | 预期行为:`-r` 在 workspace 模式下**只**跑 `packages/*` 列出的子包;主包留根目录未声明,所以被跳过。需要 `pnpm build` 单跑主包。这是设计预期,见 §四 / §八。 |
| vitest 子集冒烟 | `./node_modules/.bin/vitest run tests/unit/workspace/sibling-date-dir-guard.test.ts` | **PASS** — 8/8 passed in 172s(单文件 transform/setup 全正常,确认 workspace 配置未破坏 vitest config 加载)。完整 `pnpm test:dev` 在用户确认前未跑(488 文件预计 30+ 分钟),但因本 slice 不改 src/**、tsconfig.json、tests/**,**零回归预期**。 |
| `npm pack --dry-run` | `npm pack --dry-run` | **PASS** — `name: peaks-loop / version: 4.0.0-beta.14 / package size: 1.7 MB / unpacked size: 6.0 MB / total files: 1256`。本 slice 新增 4 文件,unpacked ≤ 6MB 边界符合。 |

## 六、下游 slice 入口

- `slice-2-peaks-loop-mut`:在 `packages/peaks-loop-mut/` 创建第一个子包
- `slice-3~7`:其他 5 个子包
- `slice-8-publish-dry-run`:全 6 包 + 主包 7 个 publish dry-run 验证

## 七、回滚

```bash
rm pnpm-workspace.yaml tsconfig.base.json packages/.gitkeep docs/superpowers/slices/slice-1-workspace-shell.md
```
