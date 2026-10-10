/**
 * Refusal arms for the two feedback rules promoted to the layer-B
 * (PreToolUse) enforcement surface.
 *
 *   - `pre-tool-peaks-current-directory-scope.sh`
 *   - `pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh`
 *
 * WHY EVERY ARM HAS A PARTNER. A promotion gate that reads a rule's NAME is
 * satisfied by a correctly named script that exits 0 and decides nothing. These
 * tests therefore drive each hook with the real command string that produced
 * the rule (a global install; a test runner piped into a pager) and assert the
 * REFUSAL — exit 2 plus stderr naming the rule — rather than the file's
 * existence. Each hook also carries a plant: the same failing arm is re-run
 * against a copy of the script with its single deny site neutered, and the arm
 * has to stop being red. That is what keeps "the arm passed" from meaning
 * "nothing could have made it fail".
 *
 * The false-positive arms matter just as much, and for a blunter reason: an
 * over-broad hook gets uninstalled. Reading `~/.claude` is not writing it, a
 * project-local `.peaks/**` write is the sibling hooks' whole subject, and
 * `vitest run > suite.log 2>&1` is the fix this second rule prescribes — none
 * of those may be blocked.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const HOOKS_DIR = resolve(__dirname, '..', '..', '..', 'src', 'services', 'hooks');

const SCOPE_HOOK = join(HOOKS_DIR, 'pre-tool-peaks-current-directory-scope.sh');
const PIPE_HOOK = join(HOOKS_DIR, 'pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh');

const SCOPE_RULE = 'peaks-current-directory-scope';
const PIPE_RULE = 'piping-a-test-run-reports-the-pipes-exit-code';

type HookRun = { status: number; stdout: string; stderr: string };

/** Drive a hook with a real Bash tool payload on stdin. */
function runBashHook(hookPath: string, command: string): HookRun {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  return runPayload(hookPath, payload);
}

/** The older `{ tool, input }` payload shape both hooks accept as a fallback. */
function runLegacyBashHook(hookPath: string, command: string): HookRun {
  const payload = JSON.stringify({ tool: 'Bash', input: { command } });
  return runPayload(hookPath, payload);
}

function runPayload(hookPath: string, payload: string): HookRun {
  const result = spawnSync('bash', [hookPath], {
    input: payload,
    encoding: 'utf8',
    // Git Bash (MSYS2) is a console app: without this, Windows allocates a
    // console window for every case in this file.
    windowsHide: true
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

/** The arm's claim, as one predicate: refused, by THIS rule. */
function refuses(hookPath: string, command: string, ruleName: string): boolean {
  const run = runBashHook(hookPath, command);
  return run.status === 2 && run.stderr.includes(ruleName);
}

const scratchRoots: string[] = [];

/**
 * Copy a hook with its deny site removed. The replacement is anchored to the
 * line that is exactly `exit 2`, so the plant removes the DECISION and not a
 * mention of it in a comment; the assertion that the source actually changed
 * keeps a no-op plant from passing for a working one.
 */
function plantNeuteredHook(hookPath: string): string {
  const source = readFileSync(hookPath, 'utf8');
  const planted = source.replace(/^exit 2$/m, 'exit 0');
  expect(planted).not.toBe(source);
  const root = mkdtempSync(join(tmpdir(), 'peaks-hook-plant-'));
  scratchRoots.push(root);
  const target = join(root, basename(hookPath));
  writeFileSync(target, planted, 'utf8');
  return target;
}

afterAll(() => {
  for (const root of scratchRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('peaks-current-directory-scope — global-state mutations are refused', () => {
  const violations: ReadonlyArray<string> = [
    'npm i -g peaks-loop',
    'npm install -g .',
    'pnpm add -g peaks-loop',
    'yarn global add peaks-loop',
    'npm link',
    'echo ok > ~/.claude/settings.json',
    'cp build/out ~/.peaks/skills/out',
    'peaks hooks install',
    'peaks skill sync'
  ];

  for (const command of violations) {
    it(`refuses: ${command}`, { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
      expect(refuses(SCOPE_HOOK, command, SCOPE_RULE)).toBe(true);
    });
  }

  it(
    'names the rule and the "unless explicitly authorised" escape in stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runBashHook(SCOPE_HOOK, 'npm i -g peaks-loop');
      expect(run.status).toBe(2);
      expect(run.stderr).toContain(SCOPE_RULE);
      expect(run.stderr).toMatch(/unless the user explicitly authorises/i);
      expect(run.stderr).toContain('PEAKS_ALLOW_GLOBAL_STATE=1');
    }
  );

  const allowed: ReadonlyArray<string> = [
    'ls -la ~/.claude',
    'cat ~/.claude/settings.json',
    'grep -rn "npm i -g" src/',
    'printf ok > .peaks/_runtime/scratch/note.txt',
    'cp src/a.ts src/b.ts',
    'pnpm test:unit',
    'git status --short',
    'peaks hooks install --dry-run',
    'PEAKS_ALLOW_GLOBAL_STATE=1 npm i -g peaks-loop'
  ];

  for (const command of allowed) {
    it(`allows: ${command}`, { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
      expect(runBashHook(SCOPE_HOOK, command).status).toBe(0);
    });
  }

  it('ignores non-Bash tools and an empty payload', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
    const readCall = JSON.stringify({
      tool_name: 'Read',
      tool_input: { file_path: '~/.claude/settings.json' }
    });
    expect(runPayload(SCOPE_HOOK, readCall).status).toBe(0);
    expect(runPayload(SCOPE_HOOK, '').status).toBe(0);
  });

  it(
    'PLANT — the same refusal disappears once the deny site is removed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      expect(refuses(SCOPE_HOOK, 'npm i -g peaks-loop', SCOPE_RULE)).toBe(true);
      const planted = plantNeuteredHook(SCOPE_HOOK);
      const run = runBashHook(planted, 'npm i -g peaks-loop');
      // 0, not "anything but 2": a script that crashed would also fail the
      // arm's claim, and a crash is not evidence of a working decision.
      expect(run.status).toBe(0);
      expect(refuses(planted, 'npm i -g peaks-loop', SCOPE_RULE)).toBe(false);
    }
  );
});

describe('piping-a-test-run-reports-the-pipes-exit-code — piped test runs are refused', () => {
  const violations: ReadonlyArray<string> = [
    'node node_modules/vitest/vitest.mjs run | tail -5',
    'pnpm test:unit | tail -20',
    'npm test 2>&1 | head -50',
    'vitest run | grep FAIL',
    "cd . && vitest run --reporter=dot | sed -n '1,10p'"
  ];

  for (const command of violations) {
    it(`refuses: ${command}`, { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
      expect(refuses(PIPE_HOOK, command, PIPE_RULE)).toBe(true);
    });
  }

  it(
    'hands back the fix: redirect to a file, or read PIPESTATUS',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runBashHook(PIPE_HOOK, 'pnpm test:unit | tail -20');
      expect(run.status).toBe(2);
      expect(run.stderr).toContain(PIPE_RULE);
      expect(run.stderr).toContain('PIPESTATUS');
      expect(run.stderr).toContain('2>&1');
    }
  );

  const allowed: ReadonlyArray<string> = [
    'node node_modules/vitest/vitest.mjs run > suite.log 2>&1; echo "EXIT=$?"',
    'vitest run',
    'pnpm test:unit',
    'git log --oneline | head -20',
    'ls -la | grep ts',
    'git diff | tail -40',
    'grep vitest package.json | head'
  ];

  for (const command of allowed) {
    it(`allows: ${command}`, { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
      expect(runBashHook(PIPE_HOOK, command).status).toBe(0);
    });
  }

  it(
    'PLANT — the same refusal disappears once the deny site is removed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const command = 'node node_modules/vitest/vitest.mjs run | tail -5';
      expect(refuses(PIPE_HOOK, command, PIPE_RULE)).toBe(true);
      const planted = plantNeuteredHook(PIPE_HOOK);
      const run = runBashHook(planted, command);
      expect(run.status).toBe(0);
      expect(refuses(planted, command, PIPE_RULE)).toBe(false);
    }
  );
});

/**
 * The legacy `{ tool, input }` payload shape. Both hooks try `tool_name`
 * first and fall back to `tool`, and a fallback nothing drives is a branch
 * that can rot unnoticed — so it is exercised in BOTH directions here, not
 * just the one that happens to be convenient.
 */
describe('both hooks also read the legacy { tool, input } payload shape', () => {
  const cases: ReadonlyArray<{ label: string; hook: string; command: string; status: number }> = [
    {
      label: SCOPE_RULE,
      hook: SCOPE_HOOK,
      command: 'npm i -g peaks-loop',
      status: 2
    },
    { label: SCOPE_RULE, hook: SCOPE_HOOK, command: 'ls -la ~/.claude', status: 0 },
    {
      label: PIPE_RULE,
      hook: PIPE_HOOK,
      command: 'vitest run | tail -5',
      status: 2
    },
    { label: PIPE_RULE, hook: PIPE_HOOK, command: 'vitest run', status: 0 }
  ];

  for (const { label, hook, command, status } of cases) {
    it(
      `${label} under the legacy shape: ${command} → ${status}`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        expect(runLegacyBashHook(hook, command).status).toBe(status);
      }
    );
  }
});
