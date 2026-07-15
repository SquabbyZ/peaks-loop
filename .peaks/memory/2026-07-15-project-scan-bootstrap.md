---
name: 2026-07-15-project-scan-bootstrap
description: 项目扫描产物路径从 .peaks/_runtime/<sid>/rd/project-scan.md 改为 .peaks/project-scan/project-scan.md，peaks workspace init 自动触发，0-1 也写空模板，5 文件 boot 含 audit/business 模板。
metadata:
  type: project
---

# Slice 2026-07-15-project-scan-bootstrap — 完成

## 用户反馈

下游使用 peaks-loop 的项目反馈两点：
1. 项目扫描产物没出现在 `.peaks/project-scan/` 下，跑去了 `.peaks/_runtime/<sid>/rd/project-scan.md`，路径错。
2. 实际使用 peaks-loop 的项目必须有当前仓库 `.peaks/project-scan/` 下的全部 5 个 bootstrap 模板文件（不只是 `project-scan.md`）。

## 修复内容

### 1. CLI 落点
- `peaks project context` 现在写双份：`.peaks/PROJECT.md`（兼容旧脚本）+ `.peaks/project-scan/project-scan.md`（项目级 scan）。
- `peaks workspace init` 完成后自动调 `bootstrapProjectScan`，不再让 RD 自己写。
- 0-1 项目（无 package.json / 无 src 文件）写空模板，`archetype: unknown, confidence: low`，Tech stack / Library versions 表保留 `| (empty) |` 占位。
- 已有项目跑 `peaks scan archetype + libraries` 组合并写回。
- 幂等：`.peaks/project-scan/project-scan.md` 已存在且 frontmatter `schemaVersion: 1` 时跳过。

### 2. 5 模板 boot
- 新增 `src/services/workspace/templates/project-scan/` 目录，bundled 4 个 audit/business 模板（byte-equal to canonical `.peaks/project-scan/`）。
- `peaks workspace init` 把 4 个 bundled 模板复制到 `.peaks/project-scan/`（已存在则跳过，除非 `--force-project-scan-templates`）。
- `template-integrity.test.ts` 防模板漂移（R4 工程化保证）。

### 3. 路径同步
- SKILL.md / 6 个 references / peaks-rd SKILL.md / peaks-ui SKILL.md：所有 `.peaks/_runtime/<sessionId>/rd/project-scan.md` 改为 `.peaks/project-scan/project-scan.md`（共 14 处）。
- 历史 memory 中已记录 _runtime/ 路径的不改（sediment 痕迹）。

### 4. CLI 选项
- `--no-project-scan-bootstrap`（commander 风格）跳过 init 触发。
- `--force-project-scan-templates` 强制覆盖 4 个 bundled 模板。

### 5. Build script（R1 BLOCKER）
- 新增 `scripts/copy-templates.mjs`，build 后把 `.md` 模板复制到 `dist/`。
- `package.json#scripts.build` 加 `copy-templates.mjs` 步骤。

## Why
这是用户反馈驱动的小切片（slice 2026-07-15），不是 RD 主导；用户角色 = 业务/产品审阅者，不参与技术决策；LLM 跑 CLI；用户只说话或 pick。

## How to apply
- 任何后续 peaks-* 行为涉及"项目扫描"产物路径，必须使用 `.peaks/project-scan/project-scan.md`，**不再使用** `.peaks/_runtime/<sid>/rd/project-scan.md`。
- 任何 slice 涉及 "bundled 模板 / 非 JS 资源" 都必须改 `scripts/copy-templates.mjs`（防模板漂移）和 `template-integrity.test.ts`。
- 新增 bundled 资源要遵循同样路径：`src/services/<concern>/templates/<name>/`，并在 build script 加复制目标。
- vitest "全绿" 不等于生产可用：所有涉及 `import.meta.url` 资源读取的代码必须有 dist-mode CLI 验收（不能只在 tsx-mode 跑）。
- transition gate 在有 pre-existing FILE_SIZE_VIOLATION 等 fail 时，使用 `--allow-incomplete --reason "<明确责任边界>"` 标注；不要被 pre-existing 卡住。

## 红线
- 单文件 ≤ 800 行（peaks scan file-size gate）
- vitest 不许 skip / .todo
- 提交不许 `Co-Authored-By Claude`（CLAUDE.md red rule）
- 不动 peak-code SKILL.md 之外的 SKILL.md（除非 RD 自己 slice 范围）

## ice-cola 实测 hot-fix（2026-07-15）

实测对象：`C:\Users\smallMark\Desktop\peaksclaw\ice-cola`（pnpm monorepo，packages/{server,client,admin,hermes-agent}）。

### 发现的 3 个冰山陷阱

1. **A — monorepo 0-1 误判**：`isZeroToOneProject` 只检查 `<root>/src/`，把 pnpm-workspace monorepo 误判为 0-1，**跳过 scanArchetype/scanLibraries**。
2. **B — scanArchetype 的 monorepo 分支有 bug**：`if (hasMonorepoConfig && !hasBackend)` —— `hasBackend` 包含 `backendDirsPresent.length > 0`，monorepo 里 `packages/server` 让 `hasBackend=true`，monorepo 分支被跳过，最后 fallback 到 `legacy-fullstack`。
3. **C — `ProjectArchetype` union 缺 `fullstack-monorepo` enum**：补上。

### hot-fix 内容

**A** — `src/services/prd/project-scan-bootstrap-service.ts`：
- 加 `MONOREPO_ROOT_CONFIGS = ['pnpm-workspace.yaml', 'turbo.json', 'nx.json']`
- 加 `projectHasWorkspacesInPackageJson()` 检查 `package.json#workspaces[]` 或 `{ packages: [...] }`
- 加 `projectIsMonorepo()` 任一信号为 true
- 改 `projectHasSourceFiles()` 加 `packages/`, `apps/`, `libs/`, `services/`, `workspaces/` 候选根
- 改 `isZeroToOneProject()` monorepo 直接 `return false`（信任 workspace 布局）

**B + C** — `src/services/scan/archetype-service.ts` + `scan-types.ts`：
- 加 `fullstack-monorepo` 到 `ProjectArchetype` union
- 改 `decideArchetype` 把 monorepo 检测提到 hasBackend 检查**之前**：`hasMonorepoConfig` → `hasBackend ? 'fullstack-monorepo' : 'frontend-monorepo', confidence: 'high'`

**vitest 新增**：2 个 monorepo case（pnpm-workspace.yaml + packages/<pkg>/src/，monorepo 无 source）。

### 实测结果（hot-fix 后）

```
$ rm -rf .peaks/project-scan .peaks/PROJECT.md
$ peaks workspace init --project .
"projectScan": {
  "created": true,
  "templatesBooted": 5,
  "archetype": "fullstack-monorepo",  ← 修复前是 "unknown" / "legacy-fullstack"
  "durationMs": 23
}
```

`.peaks/project-scan/` 5 文件全在，libraryVersions 真实（Docusaurus / Camofox 等）。

### Why

用户反馈驱动 + 实测驱动；vitest 162/162 全过不等于生产可用，必须跑实际项目 CLI 验收。

### How to apply

任何 slice 涉及"项目布局探测"，必须考虑 monorepo 变体：
- `pnpm-workspace.yaml` / `turbo.json` / `nx.json` 任一为 true → monorepo
- `package.json#workspaces` 也是信号
- monorepo 内 source 在 `packages/<pkg>/src/` 不是 `<root>/src/`
- monorepo 后端子包 (`packages/server`) 不该让架构判定 fall through 到 `legacy-fullstack`
- `src/services/prd/project-scan-bootstrap-service.ts`（408 行 bootstrap 主逻辑）
- `src/services/workspace/templates/project-scan/`（bundled 4 模板 + index.ts）
- `scripts/copy-templates.mjs`（build 后 copy 模板到 dist）
- `tests/unit/services/prd/project-scan-bootstrap-service.test.ts`（11 case）
- `tests/unit/workspace/init-hooks-project-scan.test.ts`（4 case）
- `tests/unit/workspace/templates/template-integrity.test.ts`（5 case）

## 关键文件
- RD → implemented ✓
- QA → verdict-issued (verdict=pass) ✓
- 20/20 vitest pass
- 0 tsc 错误 in slice-owned files
- bin/peaks.js CLI 验证：0-1 → templatesBooted:5 / durationMs:23；--no-project-scan-bootstrap → 不创建；--force-project-scan-templates → 强制覆盖 user sediment
- pre-existing: `src/services/standards/project-standards-service.ts` (837 lines FILE_SIZE_VIOLATION, in-flight `.claude/rules/` → `.peaks/standards/` migration, NOT this slice)