# Peaks watch + pnpm link 设计

## 目标

让 Peaks 在本地开发时可以持续 watch 源码和资源文件，并在另一个项目里通过 `pnpm link` 直接验证最新行为。

这个模式要解决两件事：

- `src/` 改动后自动重建可运行产物。
- `schemas/` 和 `skills/` 改动后也能同步到开发环境中。

## 范围

本次只做本地开发体验，不改发布语义。

- 保留现有 `build`、`prepack`、`postinstall` 行为。
- 新增 watch 脚本，用于持续重建开发产物。
- watch 需要覆盖 `src/**`、`schemas/**`、`skills/**`。
- 不把外部项目的运行逻辑耦合进 Peaks。
- 不改变 `bin/peaks.js` 的入口形式。

本次不做：

- 自动启动或重启外部项目。
- 为 `pnpm link` 增加额外约定。
- 改包名、改发布目录结构、改 CLI 命令集。

## 用户工作流

推荐的本地联调方式：

```text
# 在 peaks 仓库里
pnpm install
pnpm dev:watch

# 在另一个项目里
pnpm link peaks-cli
peaks ...
```

之后 Peaks 仓库里每次改动：

- `src/` 变更 -> 自动重建 `dist/`
- `skills/` 变更 -> 开发环境里的技能内容保持同步可用
- `schemas/` 变更 -> 相关 schema 读取到新内容

## 设计

### 1. Watch 入口

新增一个面向开发的脚本，例如 `dev:watch`。这个脚本只负责 watch，不承担发布构建职责。

建议它保持和现有构建链路一致：

- 继续以 TypeScript 编译产物为主。
- 复用现有 `build` 里已经确认正确的输出结构。
- 让 watch 模式产物与正式构建产物尽量一致。

### 2. 监听范围

watch 应监听三类输入：

- `src/**`：CLI、service、shared 逻辑。
- `schemas/**`：运行时依赖的 schema 资源。
- `skills/**`：打包/安装的技能目录。

### 3. 技能同步

现有 `postinstall` 已经会处理 bundled skills 的链接安装。watch 模式里需要把这件事纳入开发循环，以保证 skills 目录改动后不需要重新安装包。

优先策略是：

- 编译完成后刷新一次技能安装结果。
- 保持技能目录的本地链接关系稳定。
- 如果本地已有手工覆盖文件，则继续保留现有行为，不强行覆盖。

### 4. `pnpm link` 兼容性

`bin/peaks.js` 继续指向 `dist/src/cli/index.js`，所以只要 watch 持续更新 `dist/`，外部项目通过 link 到的就是最新开发版。

这意味着：

- 不需要额外的“link 专用入口”。
- 不需要改外部项目配置。
- 开发时只要保留 watch 进程运行即可。

## 风险与约束

- watch 不能写出与正式构建不同的目录结构，否则 link 后行为会漂移。
- skills 同步逻辑要避免覆盖用户本地手工改动。
- 监听范围不应扩大到整个仓库，避免无关文件触发重建。

## 验证

完成后需要验证这些场景：

- 改 `src/cli/*`，外部 link 项目能看到新行为。
- 改 `skills/*`，外部 link 项目仍能读取最新 skill 内容。
- 改 `schemas/*`，相关读取结果更新。
- watch 过程不影响 `pnpm build`。
- `pnpm link` 联调不需要额外步骤。

## 测试

新增或更新测试覆盖：

- watch 配置包含 `src/`、`schemas/`、`skills/`。
- 开发模式下的重建结果仍保持现有 `dist/` 结构。
- 技能安装/同步逻辑不会覆盖已有本地手工文件。
- `pnpm build` 与 watch 共享同一套输出约定。
