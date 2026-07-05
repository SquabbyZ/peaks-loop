---
name: peaks-code-consumer-project-smoke-test-ice-cola
description: 2026-07-05 ice-cola 实测 peaks-code 消费项目实测发现 — 命名 rename 后首次验证 consumer 端 CLI 表面 + 关键陷阱(pnpm file: link 不触发 peaks-loop build)
metadata:
  type: project
  createdAt: 2026-07-05
  source: ice-cola smoke test session
---

# peaks-code 在消费项目 ice-cola 实测 — 2026-07-05

> **Why:** 2026-07-05 完成 peaks-solo → peaks-code rename 后,首次在消费项目 (`C:\Users\smallMark\Desktop\peaksclaw\ice-cola`) 做端到端 smoke 测试。本条记录实测发现的 3 个冰山一角陷阱,以免未来 sessions 重复踩。

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

$ ./node_modules/.bin/peaks session migrate-skill-name --from peaks-solo --to peaks-code --project . --json
→ ok: true, scannedFiles: 198, modifiedFiles: 0, keyValueReplacements: 0, errors: []
→ (ice-cola 历史 runtime 198 文件全扫,0 处需修改 — ice-cola 从未做过 rename,所以无 peaks-solo 残留需迁移)

$ ./node_modules/.bin/peaks skill presence:set peaks-code --gate startup
→ active: true, skill: "peaks-code", sessionId: 2026-07-03-session-763a70

$ ./node_modules/.bin/peaks skill presence --json
→ 同上,确认 persistence OK
```

**结论:** rename 后的 peaks-code 在消费项目 CLI 表面 + presence 切换 + 迁移工具全绿。peaks-code 真正可被消费项目当作唯一 user-facing 编排入口使用。

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

- `docs/superpowers/specs/2026-07-05-peaks-solo-to-peaks-code-rename-design.md` §3.6 (trigger 字符串同步) — 验证 consumer 端 trigger 字符串
- `docs/superpowers/plans/2026-07-05-peaks-solo-to-peaks-code.md` Task 6 (LLM auto-migrate) — ice-cola migrate 实测确认 ok
- [[peaks-solo-to-peaks-code-rename-session-directive]] — rename 时的 6 条硬约束,实测期间 0 违反