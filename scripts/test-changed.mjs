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
//   1. 用 `git diff --name-only <base>` 拿到所有变更文件(默认 base=HEAD)。
//   2. 分类:
//      a) 改的是 src/<area>/<file>.ts            → 跑 tests/unit/<area>/**/*.test.ts
//      b) 改的是 tests/<path>.test.ts            → 直接跑该文件
//      c) 改的是 scripts/ 或 .claude/ 或根 config → 跑全量(防漏)
//      d) 改的是 package.json / pnpm-lock.yaml   → 跑全量(配置变更影响面不可推断)
//      e) 没有变更                              → 跑全量(空 diff 等同"啥都没验证")
//      f) 改的全是"没有测试读"的豁免文件          → 跑 0 个测试,并明确打印出来
//         (当前只有 .peaks/lint/gate-baseline.json;见 fullFallbackExempt)
//
// 退出码:
//   0  vitest 绿 / 或改动集全部命中豁免 → 0 个测试要跑(两种情况都在 stderr 说明)
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
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

function runInherit(cmd, args) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      cwd: repoRoot,
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

  const diffProc = run('git', ['diff', '--name-only', '--cached', base]);
  const diffUnstaged = run('git', ['diff', '--name-only', base]);

  // 收集:staged + unstaged
  const seen = new Set();
  for (const out of [diffProc.stdout, diffUnstaged.stdout]) {
    if (!out) continue;
    for (const line of out.split(/\r?\n/)) {
      if (line.trim()) seen.add(line.trim());
    }
  }

  if (seen.size === 0) {
    console.error('[test-changed] no diff vs', base, '— falling back to full suite');
  }

  const changed = [...seen];
  console.error('[test-changed] base =', base);
  console.error('[test-changed] changed files =', changed.length);
  for (const f of changed) console.error('  -', f);

  // 2. 分类 + 选文件
  const picked = new Set();

  function add(p) {
    if (existsSync(resolve(repoRoot, p))) picked.add(p);
  }

  // case c/d: root config / package / scripts 变更 → 全量
  //
  // The `/^\.peaks\//` trigger STAYS broad on purpose. Real repo-root `.peaks/`
  // files ARE read off the working tree by tests, so a blanket `.peaks/`
  // exemption would skip tests that should run:
  //   - tests/unit/standards/loop-engineering-guidelines.test.ts:50 reads
  //     `.peaks/standards/loop-engineering-guidelines.md`
  //   - tests/unit/standards/repo-citation-integrity.test.ts:243,247 reads
  //     `.peaks/PROJECT.md` + every `*.md` under `.peaks/standards/`
  //   - tests/unit/standards/capability-glossary.test.ts:16 `git grep`s
  //     `.peaks/standards`
  const fullFallbackTriggers = [
    /^package\.json$/,
    /^pnpm-lock\.yaml$/,
    /^vitest\.config\.ts$/,
    /^tsconfig\.json$/,
    /^scripts\//,
    /^\.claude\//,
    /^\.peaks\//
  ];

  // Paths the broad triggers above would catch, but that NO test reads as input.
  // Exact-match only — this is a single-file exemption, not a prefix rule.
  //
  // `.peaks/lint/gate-baseline.json` is the husky gate's ceiling data file,
  // regenerated by every slice (it is tracked), so leaving it under the broad
  // `/^\.peaks\//` meant a typical slice always degraded to the full unit suite.
  // Searched 2026-09-23: no test reads it. The only mentions under `tests/` are
  // a comment in `tests/unit/_setup/first-of.ts:12` and two comments in
  // `tests/unit/lint/eslint-rules-config-coverage.test.ts` that name the
  // regenerator `.husky/peaks-gate-baseline.mjs`, not this file.
  const fullFallbackExempt = new Set(['.peaks/lint/gate-baseline.json']);

  let needsFull = changed.length === 0;
  for (const f of changed) {
    if (fullFallbackExempt.has(f)) continue;
    if (fullFallbackTriggers.some((re) => re.test(f))) {
      needsFull = true;
      break;
    }
  }

  if (needsFull) {
    console.error('[test-changed] -> full suite (config/scripts or empty diff)');
    const code = await runVitest(['run']);
    process.exit(code);
  }

  // Edge: the diff touched ONLY exempt gate data. Zero tests is the correct
  // answer, and it must be SAID OUT LOUD — a silent green here is
  // indistinguishable from a suite that ran and found nothing, and that
  // empty-vs-failure confusion has already cost this repo once.
  //
  // This is NOT the `picked.size === 0` fallback further down. That one covers
  // "changed something we could not map to a test" (e.g. a README) and still
  // degrades to the full suite on purpose. This one covers "changed only a file
  // no test consumes", where the full suite is pure waste and would cancel the
  // subset gain entirely. `changed.length > 0` keeps the empty-diff case out —
  // that one already went to the full suite above.
  if (changed.length > 0 && changed.every((f) => fullFallbackExempt.has(f))) {
    console.error('[test-changed] no tests need to run — every changed file is exempt gate data:');
    for (const f of changed) console.error('  =', f);
    console.error(
      '[test-changed] 0 test files selected; NOT running the suite and NOT falling back to full ' +
        '(no test reads these files).'
    );
    process.exit(0);
  }

  // case b: 直接改 test 文件
  for (const f of changed) {
    if (/^tests\/.+\.test\.ts$/.test(f)) add(f);
  }

  // case a: src/ 改动 → 同 area 的 tests
  const srcAreas = new Set();
  for (const f of changed) {
    const m = f.match(/^src\/([^/]+)/);
    if (m) srcAreas.add(m[1]);
  }

  for (const area of srcAreas) {
    // 直接用 vitest path filter: area 子目录下所有 .test.ts
    add(`tests/unit/${area}`);
    add(`tests/unit/${area}/`);
  }

  // 兜底:src/shared / src/cli-index 等顶层文件
  if (srcAreas.size === 0 && changed.some((f) => f.startsWith('src/'))) {
    add('tests/unit');
  }

  if (picked.size === 0) {
    console.error('[test-changed] no tests matched, falling back to full suite');
    const code = await runVitest(['run']);
    process.exit(code);
  }

  const files = [...picked];
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
