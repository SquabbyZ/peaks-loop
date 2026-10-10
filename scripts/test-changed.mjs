#!/usr/bin/env node
// scripts/test-changed.mjs
//
// Slice 2 (vitest-perf-治理-并行解串行): subset script — 跑被当前 git diff 影响的 tests。
//
// 用法:
//   pnpm test:changed                 — vs HEAD (unstaged + staged)
//   pnpm test:changed -- main         — vs main 分支
//   pnpm test:changed -- HEAD~3       — vs HEAD~3
//
// 算法(透明、可审、不调任何 LLM):
//   1. 用 `git diff --name-status -z <base>` 拿到所有变更文件及其 status(默认 base=HEAD)。
//      `-z` 是必须的:NUL 分隔、不加引号不转义,否则含非 ASCII 的路径会被 C-quote 掉。
//   2. 分类 —— 规则全部在 `scripts/test-changed-classify.mjs`(纯函数,单测覆盖;
//      这里不重复任何一条规则):
//      a) 改的是 src/<area>/<file>.ts            → 跑 tests/unit/<area>/**/*.test.ts
//      b) 改的是 tests/<path>.test.ts            → 直接跑该文件(删除的除外,删掉的文件跑不了)
//      c) 改的是 scripts/ 或 .claude/ 或根 config → 跑全量(防漏)
//      d) 改的是 package.json / pnpm-lock.yaml   → 跑全量(配置变更影响面不可推断)
//      e) 没有变更                              → 跑全量(空 diff 等同"啥都没验证")
//      f) 改的是 .peaks/lint/gate-baseline.json  → 内容真的动了才跑它的守卫套件
//         (这就是 R1;只动 generatedAt 则跑 0 个测试并说明,见 baselineContentMoved)
//      g) 有任何 A/D/R/C(文件集合变化)          → 额外跑整树 population 守卫(这是 R2)
//      h) 改的是 src/services/scan/file-size-policy.ts
//                                               → 额外跑整树 population 守卫(这是 R3)
//      i) 一条映射都不命中(README.md / .github/ / .husky/ 等)
//                                               → 跑全量。守卫是"映射之外再加",不是
//                                                 映射的替代品 —— 否则这个兜底永远不会触发
//
// 退出码:
//   0  vitest 绿 / 或 diff 的内容只有基线的 generatedAt(→ 0 个测试要跑,stderr 明确说明;
//      这条路径的 code 是 'baseline-inert',是 `mode: 'none'` 唯一的到达方式)
//   1  vitest 红 / git 失败 / 路径推断失败
//   2  git 没装或不在仓库里
//
// 设计边界(明确不做的事):
//   - 不做 import-graph 静态分析(那是 tsc / madge 的工作,我们只要 fast subset)。
//   - 不写 coverage(全量 coverage 走 pnpm test:ci)。
//   - 不读 LLM / 不调任何外部 API。
//   - 不调 `npx`:vitest 走本地 entry(node_modules/vitest/vitest.mjs),由同一个
//     node 执行。理由是硬的 —— Windows 上 `npx` 是 `npx.cmd`,shell:false 的
//     spawn 会 ENOENT,而那个错误曾被吞成裸 `exit 1`(看起来就像"测试红了")。

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { scrubGitHookEnv } from './git-hook-env.mjs';
import {
  BASELINE_REL,
  classifyChanged,
  mergeEntries,
  parseNameStatus,
  withoutGeneratedAt
} from './test-changed-classify.mjs';

// Resolve this script's directory. We DO NOT use `import.meta.url` because
// when this script is invoked via `node scripts/test-changed.mjs` under
// Node 22 ESM, `import.meta.url` points to the **invoking cwd** (e.g.
// `file:///C:/.../peaks-loop/[eval]`), not the actual file path. That
// makes `new URL('.', import.meta.url).pathname` produce a malformed
// `C:\C:\...` value on Windows. Using `process.argv[1]` gives us the
// real script path regardless of how Node was invoked.
const scriptPath = process.argv[1];
if (!scriptPath) {
  console.error('[test-changed] cannot resolve script path (process.argv[1] empty)');
  process.exit(2);
}
const repoRoot = resolve(dirname(scriptPath), '..');

function run(cmd, args) {
  return spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true
  });
}

/** The env the SUITE runs under: git's hook context removed, everything else intact. */
function suiteEnv() {
  return scrubGitHookEnv();
}

// The suite is spawned with `env: suiteEnv()` on purpose. git exports `GIT_DIR` and the
// rest of its context to every hook, `pnpm test:changed` inherits it, and so would vitest —
// where dozens of tests `git init` a scratch repository and commit into it. Measured on the
// 4.1.1 push: 233 arms red that are green outside the hook, and 169 commits titled
// `fixture` written onto the branch being pushed. Rationale + the variable list:
// `scripts/git-hook-env.mjs`; the runner's own `run()` git calls keep the context, because
// they ARE about this repository.
function runInherit(cmd, args) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      env: suiteEnv(),
      stdio: 'inherit',
      shell: false,
      windowsHide: true
    });
    child.on('exit', (code) => resolveRun(code ?? 1));
    child.on('error', (err) => {
      // NEVER silent. This handler used to be `() => resolveRun(1)`, so a spawn
      // that never started looked exactly like a test run that failed: exit 1,
      // no output. Measured 2026-09-23 — `spawn('npx')` under `shell: false` is
      // ENOENT on Windows (`npx` is `npx.cmd`), so this script exited 1 on EVERY
      // invocation there, printing nothing, and read as a red suite.
      console.error(`[test-changed] cannot spawn ${cmd}: ${err.code ?? err.message}`);
      resolveRun(1);
    });
  });
}

// The project-local vitest entry, run through the SAME node that runs this
// script — the repo's standing rule for tests is the local runner, never
// `npx <runner>`. It is not a style preference here: `npx` cannot be spawned
// with `shell: false` on Windows at all, and the ENOENT that caused surfaced as
// a bare `exit 1`, so both call sites below (the full-suite fallback AND the
// subset path) failed without ever starting vitest.
const VITEST_ENTRY = resolve(repoRoot, 'node_modules/vitest/vitest.mjs');

/** Run the local vitest with inherited stdio; resolves to its exit code. */
function runVitest(args) {
  return runInherit(process.execPath, [VITEST_ENTRY, ...args]);
}

/**
 * Did the gate artifact's CONTENT move, or only its `generatedAt` stamp?
 *
 * Measured 2026-10-10: a no-op regeneration produces a ONE-line diff and that line is
 * `generatedAt`. Now that the artifact selects its guard suites, paying them for a diff with
 * nothing to test is how a gate becomes the thing people skip with `--no-verify` — which this
 * repo's own pre-push comment calls worse than no gate. So the cheap path is kept, founded on
 * that measurement this time instead of on the false 2026-09-23 "no test reads it" claim.
 *
 * FAILS CLOSED everywhere it cannot read: the file absent from `<base>` (fresh clone, first
 * commit), absent from the index (`git show :<path>` fails on a deleted or unmerged entry),
 * absent from the working tree (deleted, so a git failure or a missing blob), all report
 * "content moved" and the guard suites run.
 *
 * IT READS THE INDEX TOO, and that is the point of the second `git show`. The classification
 * answers for `--cached` PLUS the worktree (the two `git diff` calls in `main`), so a
 * measurement that read only the worktree could disagree with the diff it is answering for:
 * QA staged a moved artifact and reverted the worktree file, and the gate printed
 * `baseline-inert` — 0 test files, exit 0, vitest never spawned
 * (rid `2026-10-10-gate-classifier-baseline-coverage`, F1). One decision, one set of inputs:
 * base vs index, and base vs worktree, both compared.
 */
function baselineContentMoved(base) {
  const atBase = run('git', ['show', `${base}:${BASELINE_REL}`]);
  if (atBase.status !== 0) return true;
  const atIndex = run('git', ['show', `:${BASELINE_REL}`]);
  if (atIndex.status !== 0) return true;
  const worktreePath = resolve(repoRoot, BASELINE_REL);
  if (!existsSync(worktreePath)) return true;
  const atBaseText = withoutGeneratedAt(atBase.stdout);
  return (
    atBaseText !== withoutGeneratedAt(atIndex.stdout) ||
    atBaseText !== withoutGeneratedAt(readFileSync(worktreePath, 'utf8'))
  );
}

async function main() {
  // 1. 拿 diff base: 用户可显式传一个位置参数(过滤 --flag)。否则默认 HEAD。
  const userBase = process.argv
    .slice(2)
    .filter((a) => !a.startsWith('--'))
    .pop();
  const base = userBase || 'HEAD';

  const gitCheck = run('git', ['rev-parse', '--git-dir']);
  if (gitCheck.status !== 0) {
    console.error('[test-changed] not a git repo or git not installed');
    console.error('  cwd:', repoRoot);
    console.error('  stderr:', (gitCheck.stderr || '').trim());
    process.exit(2);
  }

  // `-z` ON BOTH CALLS, and it is not optional. Without it git C-quotes any path holding
  // non-ASCII or control bytes (`core.quotePath` defaults on), and a quoted path matches no
  // anchored rule and no baseline comparison — `M "src/services/…"` used to drop that whole
  // suite from the selection, silently. `-z` separates records by NUL and quotes nothing.
  //
  // `encoding: 'utf8'` in `run()` does NOT truncate at a NUL: spawnSync decodes the whole
  // buffer and a NUL is an ordinary code point in a JS string, which is what lets the parser
  // split on it. That is measured, not assumed — the byte-fidelity arms in
  // `tests/unit/scripts/test-changed-nul-paths.test.ts` assert the LAST record of a real
  // `git diff -z` stream survives the decode, and the end-to-end arm drives this file.
  const diffProc = run('git', ['diff', '--name-status', '-z', '--cached', base]);
  const diffUnstaged = run('git', ['diff', '--name-status', '-z', base]);

  // 收集:staged + unstaged,status 一起带上(分类要用 status,见 classify 模块)。
  // mergeEntries 是 UNION 语义 —— 同一路径可能两次出现且 status 不同,第一个 wins 会让
  // `[M 之后 D]` 丢掉 D 从而不触发 R2;列表也用合并后的视图,这样它的计数不会少报。
  const diffEntries = [
    ...parseNameStatus(diffProc.stdout),
    ...parseNameStatus(diffUnstaged.stdout)
  ];
  const changed = mergeEntries(diffEntries);

  console.error('[test-changed] base =', base);
  console.error('[test-changed] changed files =', changed.length);
  for (const entry of changed) console.error(`  - ${entry.status} ${entry.path}`);

  // 2. 分类 —— 规则只有一处:scripts/test-changed-classify.mjs(纯函数,有单测)。
  //    这里只做它不做的事:盘上是否存在、spawn vitest、退出码、stderr 叙述。
  //
  // The exemption that used to live here claimed `.peaks/lint/gate-baseline.json` was cheap
  // because "no test reads it" (searched 2026-09-23). That was false, and the way it was
  // false matters: the search looked for the PATH STRING, while the real reader reaches the
  // artifact through `BASELINE_PATH` in tests/unit/standards/_file-size-cap-scan.ts — a
  // constant such a grep cannot see. The rules and their reasons live in the classifier
  // (R1/R2/R3 there); the runner contributes only the one fs/git fact below, which the pure
  // module cannot compute for itself.
  //
  // Asked only when the artifact is actually in the diff, so the common push pays no extra
  // git call.
  const baselineTouched = changed.some((entry) => entry.path === BASELINE_REL);
  const contentMoved = !baselineTouched || baselineContentMoved(base);
  const plan = classifyChanged(diffEntries, { baselineContentMoved: contentMoved });
  for (const reason of plan.reasons) console.error('[test-changed] reason:', reason);
  console.error('[test-changed] verdict:', plan.code);

  if (plan.mode === 'full') {
    const code = await runVitest(['run']);
    process.exit(code);
  }

  // The ONLY path to a 0-test run: the diff's content is the baseline's `generatedAt` stamp,
  // which no guard can observe (code `baseline-inert`). 0 tests is the correct answer and it
  // must be SAID OUT LOUD — a silent green here is indistinguishable from a suite that ran and
  // found nothing, and that empty-vs-failure confusion has already cost this repo once.
  if (plan.mode === 'none') {
    console.error(
      '[test-changed] 0 test files selected; NOT running the suite and NOT falling back to full.'
    );
    process.exit(0);
  }

  // The classifier prints candidates; existence is an fs fact and stays here. A
  // candidate path that is not on disk (e.g. `src/<area>` with no `tests/unit/<area>`)
  // would otherwise make vitest exit 1 on a filter that matches nothing.
  const files = plan.paths.filter((path) => existsSync(resolve(repoRoot, path)));
  if (files.length === 0) {
    console.error(
      '[test-changed] no selected test path exists on disk, falling back to full suite'
    );
    const code = await runVitest(['run']);
    process.exit(code);
  }

  console.error('[test-changed] picked', files.length, 'test path(s):');
  for (const f of files) console.error('  *', f);

  // 直接调本地 vitest entry(绕过 pnpm 位置参数转义;也绕开 `npx` —— 它在
  // Windows 上无法被 shell:false 的 spawn 执行,见 runVitest 的注释)。
  const code = await runVitest(['run', ...files]);
  process.exit(code);
}

main().catch((err) => {
  console.error('[test-changed] fatal:', err);
  process.exit(1);
});
