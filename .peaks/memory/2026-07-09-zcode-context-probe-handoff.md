---
name: 2026-07-09-zcode-context-probe-handoff
description: peaks-solo 探测 z-code 上下文的完整事实集,作为 peaks-code slice "add-zcode-adapter" 的 handoff 起点(2026-07-09)。
metadata:
  type: handoff
  from_skill: peaks-solo
  to_skill: peaks-code
  target_slice: add-zcode-adapter
---

# z-code 上下文探测 — peaks-solo → peaks-code handoff

**触发:** 2026-07-09 user 在 z-code 桌面应用里开 peaks-loop 项目,提出"peaks-loop 应该是适配不同 AI CLI 的,而不是硬编码 Claude"。

**user 拍板:** 走 A 路径(改 peaks-loop 源码),走 peaks-code 完整 11 步 runbook。

---

## 1. 三件事的真相(把 user 的认知错位先校准)

| user 原话 | 真实情况 | user 拍板 |
|---|---|---|
| "peaks-loop 推荐 sonnet/opus 但我用的是 MiniMax-M3" | install 默认 `model: 'sonnet'` 写死在 `scripts/install-skills.mjs:180`,首次安装后 z-code 用户看到推荐 Claude 模型 | **要改** |
| "在 z-code 中还是去建 `.claude` 目录" | z-code 桌面应用支持"导入 Claude skills"功能,user 手动触发,触发后 `~/.zcode/skills/<name>` 是指向 `~/.claude/skills/<name>` 的符号链接 | **保留现状**(z-code 借用 .claude 是它的设计) |
| "npm 安装 peaks-loop 不会装到 z-code 中" | **实际上装了**:链 `peaks-loop@npm → ~/.claude/skills/(postinstall symlink)→ ~/.zcode/skills/(user 手动导入)`,21 个 peaks-* skills 全部可调用 | **保留现状** |

---

## 2. z-code 当前运行时(实测值)

```
provider_id:  32a71410-df2f-4a13-9143-19571fd16fb0 (Minimax-199)
provider_name: Minimax-199
baseURL:      https://api.minimaxi.com/anthropic (Anthropic-compatible)
apiKind:      anthropic
当前 model:   M3 (1M context)
备选 model:   M2.7 (200K context)
settings 路径: C:\Users\smallMark\.zcode\v2\setting.json
bots cache:   C:\Users\smallMark\.zcode\v2\bots-model-cache.v2.json
providers 配置: C:\Users\smallMark\.zcode\v2\config.json (provider.<UUID>)
skills 根:    C:\Users\smallMark\.zcode\skills\ (38 个 symlink → ~/.claude/skills/)
```

**user 当前 session 的 model 字段 = `"M3"`**(大写、无前缀)。**不是** `MiniMax-M3`,也**不是** `minimax-2.7`。peaks-loop 现存代码里 `minimax` provider 默认 `minimax-2.7`(小写),adapter 是硬编码 `claude-opus-4-7`。

---

## 3. peaks-loop 当前跟 z-code 的关系(已验证)

| 维度 | 状态 | 来源 |
|---|---|---|
| `~/.zcode/skills/peaks-*` 全部存在 | ✅ | 实测 21 个 peaks-* symlink |
| 链接指向 `~/.claude/skills/` | ✅ | 实测 symlink 目标 |
| `~/.claude/skills/peaks-*` 指向 npm 包 | ✅ | 实测 → `AppData/.../node_modules/peaks-loop/skills/peaks-*` |
| `~/.peaks/config.json` 存在 | ✅ | install 时已写入 |
| `peaks` CLI 在 PATH | ✅ | install 已生效(本 session 已能 import peaks-solo skill) |
| peaks-* skills 在 z-code 里可调用 | ✅ | 本 session 跑在 z-code 里 |

**结论:** 装/链接/调用链路完全通。**唯一缺口是 peaks-loop 不知道有 z-code 存在** —— 它以为自己跑在 Claude Code 里。

---

## 4. 已知"硬编码 Claude"位置(audit 已定位,见 explore agent report)

### 4a. 需要新增 zcode 条目的(配置级改动,5-8 处)

| 文件:行 | 当前 | 需要加 |
|---|---|---|
| `scripts/install-skills.mjs:385-392` (`IDE_DETECTION_DIRS`) | 8 个 IDE,无 zcode | `{ id: 'zcode', dir: '.zcode' }` |
| `scripts/install-skills.mjs:407-472` (`IDE_SKILL_INSTALL_PROFILES`) | 8 个 profile,无 zcode | 完整 zcode profile(`~/.zcode/skills` 等) |
| `src/services/ide/ide-types.ts:19` (`IdeId` 联合类型) | 8 个 ID,无 zcode | 加 `'zcode'` |
| `src/services/ide/ide-registry.ts:22-29` | 注册 8 个 | 注册 zcode adapter |
| `src/services/ide/adapters/` (新建) | 无 | 新增 `zcode-adapter.ts` |

### 4b. 需要去掉硬编码的(模型默认值,3 处)

| 文件:行 | 当前硬编码 | 改成 |
|---|---|---|
| `scripts/install-skills.mjs:180` | `model: 'sonnet'` | 留空 / 改成运行时探测 |
| `src/services/config/model-routing.ts:3` | `STRONGEST_MODEL_ID = 'claude-opus-4-7'` | 运行时探测或留空 |
| `scripts/install-skills.mjs:184-188` | `providers: { minimax: { model: 'minimax-2.7' } }` | 留空或去掉 |

### 4c. 需要同步改的(测试 fixture,30+ 处)

`tests/**` 里钉死 `'sonnet'` / `'claude-opus-4-7'` 字面量的地方(见 audit 报告 §2.A)。改默认值会让 `npm test` 失败,需要同步。

### 4d. 不需要改的(已确认)

- **`src/services/standards/project-standards-service.ts`** —— 整套 CLAUDE.md / .claude/rules 处理**保留**。z-code 借用 `.claude/` 的设计意味着 CLAUDE.md 仍然是宪法文件,不用改。
- **`src/services/standards/migrate-claude-rules-service.ts` + `missing-standards-detector.ts`** —— 同上,保留。
- **agents/karpathy-reviewer.md:5** `model: sonnet` —— reviewer sub-agent 是 Claude Code 专属,z-code 不一定调用,**可能不动**,待 peaks-rd 评估。

---

## 5. zcode-adapter 设计要点(给 peaks-rd 起步用)

**核心约束:** 复用 `claude-code-adapter.ts` 的结构(M3 锁死的"adapter 抽象"),只在 profile 字段替换值。

```
adapter = {
  id: 'zcode',
  dirName: '.zcode',           // 项目根检测
  settingsFileName: 'settings.json',  // 跟 Claude Code 同名,可能复用
  envVar: 'ZCODE_PROJECT_DIR',  // ⚠ 待确认(z-code 文档)
  hookEvent: 'PreToolUse',     // ⚠ 待确认(Anthropic-compatible 大概率相同)
  toolMatcher: 'Bash',         // ⚠ 待确认
  compact.envVarForContextPercent: 'ZCODE_CONTEXT_USAGE_PERCENT',  // ⚠ 待确认
  compact.compactCommand: 'zcode --compact',  // ⚠ 待确认(z-code 是桌面应用,没有 CLI?)
  standardsProfile.rootFile: 'CLAUDE.md',  // ✅ 保留(z-code 借用 .claude/)
  standardsProfile.rulesDir: '.claude/rules',  // ✅ 保留
  skillInstall.skillsDir: ~/.zcode/skills,
  skillInstall.outputStylesDir: ~/.zcode/output-styles,  // ⚠ 待确认(z-code 是否支持)
  skillInstall.agentsDir: ~/.zcode/agents,  // ⚠ 待确认
}
```

**未确认项需要 peaks-rd 去 z-code 仓库 / 文档 / 源码里查清**(可能是 GitHub repo 或 vendor 私有仓库)。

---

## 6. 11 步 runbook 起步建议

peaks-code 接手时,建议:

1. **PRD 阶段**:出 `.peaks/_runtime/<sid>/prd/requests/rid-add-zcode-adapter.md`,覆盖 §1 三件事、§4 改动清单、§5 adapter 设计、§6 acceptance criteria
2. **RD 阶段**:基于本文件 §4 §5 出 design.md,重点答"运行时探测 model"产品决策(做 vs 不做)
3. **slice 分解**:建议拆 3 个 slice
   - **slice A**: install 默认 model 修复(4b 三处) + 同步测试 fixture(4c)
   - **slice B**: 新增 zcode adapter(4a 五处 + zcode-adapter.ts 新文件)
   - **slice C**: 运行时探测 model(可选,如果 RD 决定做)
4. **SC**: 4c 测试 fixture 同步策略明确写出来
5. **QA**: 模拟 z-code 环境(可构造虚拟 `~/.zcode/` 跑 smoke test)
6. **其余按 runbook**

---

## 7. 关键引用

- explore agent 完整 audit 报告(Claude 硬编码全景):发在 explorer 上下文,引用本文件即可
- peaks-loop 沉淀池已存在的相关 lesson:
  - `peaks-loop-is-enhancement-not-new-cli.md` — peaks-loop = AI CLI 之上的增强层,不造新 CLI(2026-07-04 user)
  - `vendor-neutrality-adapter-vendor.md` — vendor-neutrality 通过 adapter 抽象守住(2026-07-08 beta.6)
  - `ide-adapter-resource-profile-framework.md` — IDE adapter 已有 framework(2026-07)
  - `slim-ideadapter-shape-is-the-contract.md` — slim adapter 是契约
- 现有 8 个 IDE adapter 的源码位置:`src/services/ide/adapters/`,命名 `<id>-adapter.ts`
- `peaks-cli-1-3-3-will-be-the-first-release-with-the-ide-adapter-layer.md` — slice 1 引入 IDE-adapter 层的历史