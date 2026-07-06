---
name: peaks-code-consumer-project-smoke-test-ice-cola
description: 2026-07-05 ice-cola 实测 peaks-code 消费项目实测发现 — 命名 rename 后首次验证 consumer 端 CLI 表面 + 关键陷阱(pnpm file: link 不触发 peaks-loop build)
metadata:
  type: project
  createdAt: 2026-07-05
  source: ice-cola smoke test session
---

# peaks-code 在消费项目 ice-cola 实测 — 2026-07-05

> **Why:** 2026-07-05 完成 peaks-code → peaks-code rename 后,首次在消费项目 (`C:\Users\smallMark\Desktop\peaksclaw\ice-cola`) 做端到端 smoke 测试。本条记录实测发现的 3 个冰山一角陷阱,以免未来 sessions 重复踩。

## 实测环境

- **peaks-loop 本地副本:** `C:\Users\smallMark\Desktop\peaks-loop`(本次 rename 所在的开发仓库)
- **消费项目:** `C:\Users\smallMark\Desktop\peaksclaw\ice-cola`(monorepo,4 packages: admin / client / hermes-agent / server,package.json `devDependencies.peaks-loop = "file:C:/Users/smallMark/Desktop/peaks-loop"`)
- **实测 CLI 表面:** visibility / session migrate-skill-name / presence set / presence get

## 实测结果(全绿)

```
$ ./node_modules/.bin/peaks --version
3.1.2

$ ./node_modules/.bin/peaks skill:visibility --list --json
→ 4 public (peaks-code / peaks-resume / peaks-status / peaks-test)
  + 6 internal (peaks-prd / peaks-rd / peaks-qa / peaks-ui / peaks-sc / peaks-txt)
→ (注意:ice-cola 没有 peaks-sop,peaks-loop 自身有 — consumer project 拿不到 peaks-loop 私有 skill,符合 spec)

$ ./node_modules/.bin/peaks session migrate-skill-name --from peaks-code --to peaks-code --project . --json
→ ok: true, scannedFiles: 198, modifiedFiles: 0, keyValueReplacements: 0, errors: []
→ (ice-cola 历史 runtime 198 文件全扫,0 处需修改 — ice-cola 从未做过 rename,所以无 peaks-code 残留需迁移)

$ ./node_modules/.bin/peaks skill presence:set peaks-code --gate startup
→ active: true, skill: "peaks-code", sessionId: 2026-07-03-session-763a70

$ ./node_modules/.bin/peaks skill presence --json
→ 同上,确认 persistence OK
```

**结论:** rename 后的 peaks-code 在消费项目 CLI 表面 + presence 切换 + 迁移工具全绿。peaks-code 真正可被消费项目当作唯一 user-facing 编排入口使用。

## Re-run 2026-07-05 (晚场 · user 二次实测请求)

复测时已经按上述 3 个 pre-check 一次到位(bin/peaks.js / build 产物 mtime 新 / local link),继续验证:

```
$ ./node_modules/peaks-loop/bin/peaks.js --version
→ 3.1.2

$ ./node_modules/peaks-loop/bin/peaks.js help
→ Peaks Loop 3.1.2 · 10 skills ready (banner 不再提 peaks-solo)

$ ./node_modules/peaks-loop/bin/peaks.js skill list
→ 4 个 user-facing:peaks-code / peaks-resume / peaks-status / peaks-test
  peaks-solo 字样 0 处出现

$ ./node_modules/peaks-loop/bin/peaks.js solo --help
→ "peaks-code LLM-side workflow planner (slice 2 fast mode)" — orchestrator 字面锁死在 peaks-code

$ ./node_modules/peaks-loop/bin/peaks.js session migrate-skill-name --from peaks-solo --to peaks-code --project . --json
→ ok: true, scannedFiles: 199, modifiedFiles: 0, keyValueReplacements: 0, stringReplacements: 0
  skipped: [.peaks/memory, .peaks/skills/.system/bees]
  → (与早场 198 → 199 差异 = 1 个新增 runtime 文件;本质仍是 ice-cola 0 残留峰值)

$ ./node_modules/peaks-loop/bin/peaks.js skill presence:set peaks-code --mode full-auto --gate startup
→ active: true, skill: "peaks-code", mode: "full-auto", gate: "startup"
  outerSessionMismatch: bound-d50a55af → current-27a79622(跨 session 预期,本会话不阻塞)
```

**附加校验(此次新增):**

1. `ls peaks-loop/skills/ | grep -E 'peaks-(code|solo|resume|status|test)'` → 4 个 user-facing skills 目录,其中 `peaks-solo/` **不存在**。
2. `grep -l peaks-solo peaks-loop/skills/peaks-code/SKILL.md` → **0 行**(SKILL.md 内部完全 peaks-code-only)。
3. ice-cola 内部 `grep peaks-solo -r .peaks/ .md` 命中 `index.json` + `2026-07-01-session-41be24/**` 历史 runtime — 命中迁移 `--skip .peaks/memory` 跳过列表,符合 spec;非回归。

**复测结论:** peaks-code 在 consumer project 端入口、CLI 表面、orchestrator 字面、SKILL.md 引用全部锁死到 rename 后形态,user-facing 唯一性成立。

## 冰山一角陷阱

### 1. peaks-loop `dist/src/cli/index.js` 而不是 `dist/cli/index.js`

- peaks-loop `bin/peaks.js` 写 `import '../dist/src/cli/index.js'`(相对仓库根)。
- `tsc -p tsconfig.json` 产出结构是 `dist/src/cli/...`,**不是** 早期期望的 `dist/cli/...`。
- peaks-loop Task 6 dogfood 失败原因(`dist/cli/index.js` not found) 是因为路径假设错了——实际是 `dist/src/cli/index.js`,**peaks-loop 项目自身能跑**(`./bin/peaks.js`),dogfood 脚本错引。

### 2. ice-cola `pnpm install --offline` **不触发** peaks-loop build

- ice-cola 用 `"peaks-loop": "file:C:/Users/smallMark/Desktop/peaks-loop"` link peaks-loop。
- `pnpm install --offline` 只刷新 `node_modules/peaks-loop` 的文件 link,**不**跑 peaks-loop 的 `pnpm build`。
- 因此 ice-cola `node_modules/peaks-loop/dist/` 是**上次** build 的产物,可能是旧版(rename 前的 3.1.x)。
- **必须**先在 peaks-loop 项目根跑 `pnpm build`,然后 ice-cola 才能用 rename 后的 CLI 表面。
- 否则会出现 "unknown option '--from'" 这种诡异错误——因为旧版 dist 里没有 session migrate-skill-name 子命令。

### 3. `peaks` 全局 npm 安装 vs local node_modules/.bin/peaks

- `which peaks` 在 `C:/Users/smallMark/AppData/Roaming/npm/peaks` 命中**全局 npm install 的 peaks**(旧 3.1.x,没有 rename 后的 surface)。
- 必须用 `node node_modules/peaks-loop/bin/peaks.js` 或 `./node_modules/.bin/peaks`(local link 后才有) 来访问新版本。
- shell `peaks` 命令会被全局版本抢先,**这是 pre-existing 路径冲突,与 rename 无关,但测试时容易踩**。

## How to apply

- 未来任何 rename 验证流程,先确认三件事再实测:
  1. peaks-loop 项目根 `pnpm build` 已跑
  2. consumer `pnpm install` 后,`node_modules/peaks-loop/dist/` mtime 比 source 文件新
  3. 用 `node node_modules/peaks-loop/bin/peaks.js ...` 而不是 shell `peaks`(避免全局抢路径)
- pre-existing bug:peaks-loop dogfood 脚本 `scripts/dogfood-sediment-cycle.sh` 引用 `dist/cli/index.js`,但实际是 `dist/src/cli/index.js`——**dogfood 始终跑不通**,与 rename 无关,是路径漂移。

## Related designs / memory

- `docs/superpowers/specs/2026-07-05-peaks-code-to-peaks-code-rename-design.md` §3.6 (trigger 字符串同步) — 验证 consumer 端 trigger 字符串
- `docs/superpowers/plans/2026-07-05-peaks-code-to-peaks-code.md` Task 6 (LLM auto-migrate) — ice-cola migrate 实测确认 ok
- [[peaks-code-to-peaks-code-rename-session-directive]] — rename 时的 6 条硬约束,实测期间 0 违反