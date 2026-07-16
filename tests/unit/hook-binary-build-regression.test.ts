/**
 * Regression test for PRD#2 / PRD#8 (2026-06-16): the global `peaks`
 * binary on PATH (resolved by Claude Code's hook invocation) MUST
 * emit the fix that turns the Fact-Forcing Gate hint into a clean
 * stderr message instead of "PreToolUse:Bash hook error / No stderr
 * output" chrome.
 *
 * Background: `bin/peaks.js` is a thin shim that imports the compiled
 * `dist/src/cli/index.js`. When the local peaks-loop source is updated
 * but `pnpm build` is not re-run (or `npm install -g .` not re-run
 * after a version bump), Claude Code's hook fires the OLD compiled
 * gate-commands code, which still uses the pre-PRD#2 path. The unit
 * tests pass (they import the fresh src/ directly), but the real
 * hook fails.
 *
 * Fix: this test runs the COMPILED binary (dist/) and asserts that
 * `gate-commands` contains the `emitBlock` helper invocation. A
 * regression (e.g. someone ships src/ changes without rebuilding)
 * trips this test in CI.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const DIST_GATE_COMMANDS = join(PROJECT_ROOT, 'dist', 'cli', 'commands', 'gate-commands.js');

describe('PRD#8: built gate-commands binary matches the source fix', () => {
  test('dist/src/cli/commands/gate-commands.js exists and contains emitBlock (the deny-path helper)', () => {
    if (!existsSync(DIST_GATE_COMMANDS)) {
      throw new Error(
        `Built gate-commands.js missing at ${DIST_GATE_COMMANDS}. ` +
          'Run `pnpm build` to compile src/ → dist/. The Claude Code hook ' +
          'invokes bin/peaks.js → dist/cli/index.js, so a stale dist ' +
          'silently reverts the Fact-Forcing Gate fix in production.'
      );
    }

    const content = readFileSync(DIST_GATE_COMMANDS, 'utf8');
    const emitBlockCallCount = (content.match(/emitBlock\s*\(/g) ?? []).length;

    expect(
      emitBlockCallCount,
      'dist gate-commands.js should call emitBlock (PRD#2 fix). ' +
        'If zero, the compiled binary reverted to the old emitDecision path ' +
        'and Claude Code hooks will render "PreToolUse:Bash hook error" again.'
    ).toBeGreaterThan(0);
  });

  test('dist/src/cli/commands/hook-handle.js exists and contains emitHint / emitBlock (PRD#3 hook governance)', () => {
    // Sanity-check the broader hook-governance surface so a stale dist on
    // hook-handle.js also fails loudly.
    const hookHandle = join(PROJECT_ROOT, 'dist', 'cli', 'commands', 'hook-handle.js');
    if (!existsSync(hookHandle)) {
      throw new Error(`Built hook-handle.js missing at ${hookHandle}. Run pnpm build.`);
    }
    const content = readFileSync(hookHandle, 'utf8');
    expect(
      content.includes('emitHint') || content.includes('emitBlock'),
      'dist hook-handle.js should use the PRD#3 emitHint/emitBlock helpers. ' +
        'If false, hook-handle.ts was edited without rebuilding.'
    ).toBe(true);
  });

  test('dist is fresh relative to src/gate-commands.ts (build is up to date)', () => {
    // Belt-and-braces: also check that dist mtime >= src mtime. If src was
    // edited after the last build, this fails and forces a rebuild.
    const srcGate = join(PROJECT_ROOT, 'src', 'cli', 'commands', 'gate-commands.ts');
    if (!existsSync(srcGate) || !existsSync(DIST_GATE_COMMANDS)) return;
    const srcMtime = statSync(srcGate).mtimeMs;
    const distMtime = statSync(DIST_GATE_COMMANDS).mtimeMs;
    expect(
      distMtime >= srcMtime,
      `dist gate-commands.js is older than src gate-commands.ts ` +
        `(src=${new Date(srcMtime).toISOString()}, dist=${new Date(distMtime).toISOString()}). ` +
        'Run `pnpm build` to refresh the compiled binary.'
    ).toBe(true);
  });
});
