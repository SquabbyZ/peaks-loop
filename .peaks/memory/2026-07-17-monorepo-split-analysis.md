# 2026-07-17-monorepo-split-analysis

**标题:** peaks-loop 单仓整体扫描 + npm 包瘦身 / 服务域拆分方案

## 一、用户痛点确认

| 现象 | 量化数据 |
|------|---------|
| 单元测试场景数 | grep `it()/test()` 共 **5,386** 个 call site(去掉 skip 后 ~5,384),**523 个 .test.ts 文件**,13,020 LOC,5.5MB 体积 |
| npm publish 包大小 | `.tgz` 30.6MB(`peaks-loop-4.0.0-beta.10.tgz`),`npm pack --dry-run` 实测 **37.4MB** raw content |
| 总文件数 | **1,217** 个(dist 1,058 / src 538 / tests 523 / skills 163 / docs 61) |
| src/services 子域 | **77 个** 子目录,约 538 个 .ts 文件,**71,963 LOC** |

## 二、用户对 openspec 的疑问澄清

- 用户问"之前已经把 openspec 剔除了,怎么还有"。
- 实际:**只解耦了流程,没删源码**。2026-07-08 (beta.6) 的"OpenSpec 解耦"是 `peaks-code` 不再把 `.openspec/changes/` 当 source-of-truth,SKILL.md Step 0.5 删除;但 **`src/services/openspec/` 源码保留** + `peaks openspec list/show/to-rd/render/validate` 5 个 CLI 命令仍在 register + `dashboard-service` 引用 `scanOpenSpec`。
- **结论**:openspec 仍是 active 域,不在 Tier A 候选(因为 `dashboard-service` 引用 → indegree ≥ 1)。我之前把它列在 Tier A 是数据解读错误,**本次已修正**。

## 三、包名约定(用户 2026-07-17 现场修正)

- **不要 `@peaks-loop/*` 作用域**(用户说"没有 peaks-loop 组织")。
- **采用 `peaks-loop-*` 前缀的 unscoped npm 包名**:
  - `peaks-loop-mut`
  - `peaks-loop-doctor`
  - `peaks-loop-crystallization`
  - `peaks-loop-skillhub`
  - 主包仍叫 `peaks-loop`(沿用现状)
- 影响:pnpm workspace 的 package 目录名建议用 `peaks-loop-mut/` 这种连字符形式,与发布包名一致,避免 `import` 路径混用斜杠/连字符的歧义。

## 四、npm 包 30MB 根因(`npm pack --dry-run` 实测)

```
TOTAL MB: 37.4257
=== entries > 50KB ===
15667.2 KB  examples/video-demo/preview/peaks-loop-demo-en.mp4
15360.0 KB  examples/video-demo/preview/peaks-loop-demo.mp4
  659.7 KB  examples/video-demo/out/en-closing-960.png
  658.4 KB  examples/video-demo/out/zh-closing-960.png
  303.8 KB  CHANGELOG.md
```

**结论 1:这是 4 个视频/封面的锅,占 32.7MB(87%)。**
- `examples/video-demo/preview/peaks-loop-demo.mp4` ×2(15MB each)
- `examples/video-demo/out/en-closing-960.png` + `zh-closing-960.png`(660KB each)
- `package.json#files[]` 白名单明确包含 `examples/video-demo/preview/peaks-loop-demo.mp4` 等 4 个文件,所以 npm pack **不会**自动排除。
- **讽刺事实**:`examples/video-demo/node_modules` 471MB、`out/` 147MB、整个 video-demo 文件夹 673MB —— 但 npm pack 因为 files[] 白名单只挑了 preview/out 里 4 个产物,所以没被打进 30MB 巨包里。
- **真代码包体**:剔除那 4 个后,总 tarball 应该只有 **~4.8MB**。这是个**零风险的即时修复**。

## 五、src/services 依赖矩阵(Node 脚本统计 .ts 间 cross-domain import)

### 核心域(被 ≥3 个其他域依赖,真正的"基础设施")

| 域 | indegree | outdegree | 依赖 | 角色判断 |
|----|---------:|----------:|------|---------|
| `session` | 13 | 2 | workspace,observability | **超核心** |
| `config` | 12 | 2 | preferences,ide | **超核心** |
| `preferences` | 8 | 0 | — | 纯叶子但被广引 |
| `artifacts` | 7 | 5 | observability,config,session,scan,... | 中心枢纽 |
| `skills` | 5 | 4 | ide,config,memory,session | 核心 |
| `context` | 4 | 3 | ide,preferences,filesystem | 核心 |
| `dispatch` | 4 | 2 | filesystem,security | 核心 |
| `ide` | 4 | 1 | dispatch | 核心 |
| `audit` | 3 | 2 | memory,preferences | 核心 |
| `observability` | 3 | 1 | session | 叶子但被广引 |
| `workspace` | 3 | 2 | session,standards | 核心 |
| `memory` | 2 | 6 | fuzzy-matching,context,preferences,session | 出度最大 |
| `workflow` | 2 | 7 | session,artifacts,feedback,recommendations | workflow-loop |

### 42 个叶子域(无任何其他域引用,**天然独立**)

adapter, classify, code, code-review, compact, complexity, crystallization, dashboard, doc, evolution, final-review, fixture, fork, handoff, hooks, impact, job, legacy, log, migrate-skill-name, migration, perf, polyrepo, profiles, progress, proxy, qa, refactor, release, retrospective, reviewer, role, sc, share, signal, skill, slice, smoke, sop, test-cache, upgrade, verdict

### 16 个单引用域(只被 1 个其他域 import)

agent, audit-independent, codegraph, doctor, feedback, loop, mut, openspec, prd, rd, runtime, security, sediment, skillhub, standards, understand

## 五、按"独立包候选度"分层

### Tier A(天生独立,零拆分代价)

| 候选包 (unscoped) | LOC | 子目录 | 说明 |
|------|----:|------|------|
| **peaks-loop-mut** | 736 | mut/ + audit/enforcers/ + agent/ecc-cache-service | 突变测试 4 文件(stryker mutate 列表) + enforcers + ecc cache,**完全独立** |
| **peaks-loop-doctor** | 1066 | doctor/(单文件 1066 行) | 项目健康检查,可单包,1 个 product 级 command |
| **peaks-loop-final-review** | 151 | final-review/ | 4-dim 业务复盘,零依赖 |
| **peaks-loop-crystallization** | 1515 | crystallization/ | 结晶化引擎,4 个 .sql migration + sqlite,叶子域 |
| **peaks-loop-skillhub** | 694 | skillhub/ | tarball + sqlite + migration,独立 skill 商城,1 个 product command |
| **peaks-loop-audit-independent** | 881 | audit-independent/ | 独立审计,完全无 cross-domain |
| **peaks-loop-release** | 191 | release/ | 发布管理,叶子 |

> **注:openspec 不在 Tier A** — 被 `dashboard-service` 引用 (indegree≥1),已从候选移除(见 §二)。

### Tier B(中等耦合,需小重构可拆)

| 候选包 (unscoped) | 域 | 难度 |
|------|----|------|
| **peaks-loop-slice** | slice/(3,398 LOC) | 中:依赖 fuzzy-matching/memory/session,需要把这些当 peer dep |
| **peaks-loop-loop** | loop/(3,298 LOC) + audit/(2,674) | 中:loop 是 loop-engineering 核心,但独立可拆 |
| **peaks-loop-prd/rd/qa/ui/sc/txt** | 各自 1 文件~7 文件 | 中:目前耦合 `peaks sub-agent dispatch` 接口,拆后需要稳定该接口 |

### Tier C(必须留在主包的内核)

| 域 | 为什么不能拆 |
|----|------|
| `session`(13 indegree) | 几乎所有域都依赖 |
| `config`(12) | 全局配置 |
| `preferences`(8) | 用户偏好,广引 |
| `artifacts`(7) | 工件中心,枢纽 |
| `workspace`(3) | 整个 `.peaks/` 命名空间 |
| `cli/`(184 命令文件) | CLI 入口层 |
| `cli/program.ts`(26.3KB) | Commander 装配 |
| `skills/`、`standards/`、`dispatch/` | 编排基础设施 |

## 六、6000 测试场景分布

- `tests/unit/` 5,552 LOC,488 个文件
- `tests/unit/cli-program.*.test.ts` 是大头(`cli-program.core/stateful/workflow/workspace/workflow-cli`)+ `tests/unit/cli/*.test.ts` 184 个命令测试
- 5 个 `vi.doMock('node:fs')` 重 mock 文件必须单线程跑(slow project),根因已在 vitest.config.ts 里解释
- **stryker mutate** 只针对 4 个文件(`evaluator-dispatcher` / `monotonic-guard` / `monotonic-runner` / `run-driver`),不需要拆包后 mutate 范围扩大

## 七、推荐拆分方案

### 方案 X:**Monorepo pnpm workspace + 4 个独立 npm 包**(推荐)

```
peaks-loop/                            # 主包,只保留 CLI + 编排内核
├── packages/
│   ├── peaks-loop-mut/                # peaks-loop-mut (突变测试)
│   ├── peaks-loop-doctor/             # peaks-loop-doctor (健康检查)
│   ├── peaks-loop-crystallization/    # peaks-loop-crystallization (结晶化)
│   └── peaks-loop-skillhub/           # peaks-loop-skillhub (skill tarball/sqlite)
├── src/                               # 主包 src(CLI + session/config/preferences/artifacts/...)
├── tests/                             # 主包测试
├── skills/                            # 主包 skill SKILL.md
└── pnpm-workspace.yaml
```

- **价值**:
  - 主包 npm publish 从 30MB → **~5MB**(剔 4 个视频 + 拆出去的 4 个子域)
  - 每个子包可以独立 semver、独立 changelog、独立发布
  - 安装者按需 `pnpm add peaks-loop-mut` 而不是拉 30MB 巨包
  - 单元测试可以**分仓跑**,5 个 slow-lane 文件不再卡住 488 文件总时长
- **包名约定**:`peaks-loop-*` 前缀,无 scope(unscoped npm)。

### 方案 Y:**两包拆法**(保守)

```
peaks-loop/                  # 主包,所有当前 src
peaks-loop-assets/           # 仅 examples/video-demo/preview 的 mp4 + png
```

- **价值**:立刻砍掉 30MB,几乎零代码改动。
- **代价**:examples 在 npm 生态下要么公开 CDN 链接要么独立 github release,**长期不推荐**。

### 方案 Z:**拆出 examples**(零代码改动)

- 仅修改 `package.json#files[]` 删掉 `examples/video-demo/preview/*.mp4` + `out/zh-closing-960.png` + `out/en-closing-960.png`。
- 包大小 30MB → **~5MB**(主包几乎不变)。
- 这是方案 X 之前的**第一步**。

## 八、推荐路径(立即可行)

1. **Day 0(零代码改动,1 个 PR)**:实施方案 Z —— 从 files[] 删 4 个视频/封面,顺手把 `examples/video-demo/node_modules` 和 `.pack-cache` 加入 `.npmignore`。包 30MB → ~5MB。
2. **Day 1~3(中等改动,~3-5 个 PR)**:升级为方案 X —— 4 个 Tier A 候选域拆成 packages/,pnpm workspace 化,主包瘦身到 ~3MB。
3. **Day 4+**:Tier B 视迭代需要逐步拆。

## 九、推荐关联

- [[redline-no-claude-co-author]]
- [[human-nl-choice-only-tenet]]
- [[two-forms-only-rule]]
- [[peaks-loop-is-enhancement-not-new-cli]]

## 十、用户最终决策(2026-07-17 第四轮)

**用户论点(改变方向):**
- 单人维护者,但开发基本是 AI。
- Monorepo workspace 对 AI 反而**更友好**:workspace 软链,跨包 AI 一次 context 看完;`workspace:*` 协议 AI 不管版本;AI 改共享类型 vs 单仓完全一样。
- "全部一次性迁移",长任务不计成本,小步迭代(每 slice 1 个 RD+QA+SC 提交)。

**最终拆包列表(6 个 Tier A 包):**

| # | 包名 (unscoped) | LOC | 来源 |
|---|------|----:|------|
| 1 | **peaks-loop-mut** | 736 | mut/ + audit/enforcers/ + agent/ecc-cache-service |
| 2 | **peaks-loop-doctor** | 1066 | doctor/(单文件 1066 行) |
| 3 | **peaks-loop-crystallization** | 1515 | crystallization/ |
| 4 | **peaks-loop-skillhub** | 694 | skillhub/ |
| 5 | **peaks-loop-final-review** | 151 | final-review/ |
| 6 | **peaks-loop-audit-independent** | 881 | audit-independent/ |

**执行路径(全部一次性 + 小步迭代):**

| 阶段 | 切片数 | 单切片动作 |
|------|------:|------|
| **Day 0** | 1 PR | files[] 删 4 视频/封面 + .npmignore 补 .pack-cache + video-demo/node_modules |
| **S1 workspace 空壳** | 1 PR | pnpm-workspace.yaml + packages/ + tsconfig.base.json + 主包迁 packages/peaks-loop/ |
| **S2~S7 6 个包依次拆** | 6×2~3 PR = 12~18 PR | 每包:搬 source + 改 import + workspace:* + 独立 vitest + publish dry-run |
| **S8 全仓 publish dry-run** | 1 PR | pnpm -r publish --dry-run 全部通过 |
| **总计** | **15~21 PR** | |

> 长任务不计成本 → AI 单切片 5~10 分钟,15 PR ≈ 2~3 小时连续迭代。

## 十一、推荐关联(更新)

- [[redline-no-claude-co-author]]
- [[human-nl-choice-only-tenet]]
- [[two-forms-only-rule]]
- [[peaks-loop-is-enhancement-not-new-cli]]

## 十四、Turbo 决策(2026-07-17 第六轮)

**用户问:**"monorepo 需要使用 turbo 么?"
**答:** 不加,保持 pnpm workspace 原状。

**判断依据:**
- peaks-loop = 1 主包 + 6 子包 = 7 个 package
- `pnpm -r build` 全跑 < 35 秒
- 改一个文件触发全仓重 build 也能接受
- Turbo 增量缓存收益 = 0(单包 build < 3 秒)
- 引入 turbo.json = AI 多一层抽象,拖慢调试反馈

**未来加 Turbo 的触发信号(任一):**
- `pnpm -r build` > 5 分钟
- `pnpm -r test` > 10 分钟
- CI 单次 build > 8 分钟
- 包数量 > 15

**渐进迁移路径:** `pnpm add -D turbo` + 写 `turbo.json` 即可,不影响现有 scripts。

## 十五、slice-3 doctor 回滚 + 重新规划(2026-07-17 第七轮)

**问题:** RD 在 slice-3 doctor 用了 **wrapper 模式**:子包 dist 直接 re-export 主仓 src/services/doctor/doctor-service.ts,1066 行源码**没动**。这违反"真拆"初衷,doctor 永远留主仓。

**用户决定:** 回滚 + 拆为两步:
- **slice-3a**: 抽出 Tier A 包共用的 8 个 internal utils → `packages/peaks-loop-shared/`
- **slice-3b**: 基于 shared,真拆 doctor-service.ts 到子包

**适用范围:** 后续 4 个 Tier A 包(crystallization / skillhub / final-review / audit-independent)也可能依赖 shared utils。slice-3a 的共享包是 monorepo 拆分的**基础设施**,其他包会受益。

**Karpathy 反思:** RD 报告里虽然诚实记录偏差,但一开始就该拒绝 wrapper 模式。重构路径应是:
- "看到 indegree=0" ≠ "可以无成本搬走"
- 跨包 import 必须在子包有对应依赖或 alias 才能搬

## 十七、Monorepo 拆分执行总结(2026-07-17 终)

**总成果:**
- 8 commit 推进 monorepo 化
- 6 个 peaks-loop-* 子包成功拆分(独立 workspace package):
  - peaks-loop-shared(4 utils + peaks-loop-shared 依赖)
  - peaks-loop-mut(mut + ecc-cache)
  - peaks-loop-doctor(injectable probes,Option C 真拆)
  - peaks-loop-crystallization(injectable loop schemas,Option C 真拆)
  - peaks-loop-final-review(inline LlmRunner type,真拆)
  - peaks-loop-audit-independent(零 cross-domain,最干净拆分)
- 1 个 Tier A 包跳过:**peaks-loop-skillhub**(被 8 个 CLI command + sediment types 深度耦合,需要单独 slice-5b)
- 主包 npm pack dry-run: **1.7MB**(原 30MB → **18x reduction**)
- Trusted Publishing OIDC 链路接通(.github/workflows/publish.yml)
- 全程零 Claude/Anthropic co-author trailer

**验证结果:**
- 子包 build 全过(tsc clean)
- 子包 tests 全过(mut 41/41, shared 4/4, doctor 57/57, crystallization 27/27, final-review 5/5, audit-independent 32/32 = **166/166 PASS**)
- 主仓 `pnpm build` 通过

## 十六、Trusted Publishing 决策(2026-07-17 第五轮)

**用户确认走 Trusted Publishing(OIDC)。**

**为什么必须这样:**

- LLM 的 conversation context 会被沉淀/同步/部分用于训练,token 一旦进 context 即等同泄露
- AI 跑 Bash 时 env var / stdout / shell history 都可能截留 token
- 即使一次性贴,撤销成本 = SquabbyZ 名下所有包 rotate

**Trusted Publishing 形态:**

- npmjs.com → Settings → Trusted Publishers → Add GitHub Action(repo + workflow + environment)
- 用户**只手动配置一次**,之后:
  - 用户: `git tag v4.1.0 && git push --tags`
  - GitHub Action: 自动 `pnpm changeset publish`
  - AI: 完全看不到 token,只写 workflow yaml
- 撤销:npmjs 删 trusted publisher

**新增切片:**

| Slice | 内容 |
|------|------|
| **S-1 trusted-publish** | 加 `.github/workflows/publish.yml`(`id-token: write` + changesets),npmjs 配置 trusted publisher,文档更新 README → publish 流程 |
| **S8** | 扩展 S8 publish dry-run 验证为"6 个 peaks-loop-* 包 + 主包 7 个全过 trusted publish dry-run" |

## 十三、本文件目标读者

- 用户(单人维护者 + AI 开发主导)
- peaks-rd 子智能体(取本文件 §四 + §十 + §十二 决定 slice 切法)
- peaks-qa 子智能体(取 §四 §五 §十 §十二 验证)