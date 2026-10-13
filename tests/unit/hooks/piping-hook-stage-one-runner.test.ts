// tests/unit/hooks/piping-hook-stage-one-runner.test.ts
//
// The stage-1 rule's own arms, in their own file.
//
// WHY EXTRACTED. These arms lived in `feedback-promoted-pretool-hooks.test.ts`
// until that file crossed the 500-line test cap, at which point the repository's
// own move is to split rather than to grow an over-cap file. The arms are
// unchanged; only their address is.
//
// WHAT THEY COVER. A runner token that APPEARS in the command text without being
// the command. The script's header has always carried the exception (line 29 —
// "the runner has to start the command"); the implementation read every pipeline
// stage, so a grep SEARCH PATTERN, a fixture, or a later stage read as an
// invocation.
//
// WHICH ARMS ARE EVIDENCE. The `measuredFalsePositives` block was RUN against the
// pre-fix hook and refused with exit 2 before it was pinned here; those are the
// red-direction cases, and they redden again if the runner is read from any stage
// but the first. The `controls` block is the opposite: each was allowed BEFORE
// the fix as well, so it guards against a regression and is not evidence that the
// fix does anything — a control that never exercised the path proves nothing, and
// saying which is which is the point. The three `KNOWN` arms assert the WRONG
// answer on purpose: they are the price of the rule, and asserting them means a
// later change that closes the gap has to redden here and update them openly.
//
// Run with:
//   pnpm exec vitest run tests/unit/hooks/piping-hook-stage-one-runner.test.ts

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const HOOKS_DIR = resolve(__dirname, '..', '..', '..', 'src', 'services', 'hooks');
const PIPE_HOOK = join(HOOKS_DIR, 'pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh');

/** Drive the hook with a real Bash tool payload on stdin. */
function runBashHook(hookPath: string, command: string): { status: number; stderr: string } {
  const payload = JSON.stringify({ tool_name: 'Bash', tool_input: { command } });
  const result = spawnSync('bash', [hookPath], {
    input: payload,
    encoding: 'utf8',
    // Git Bash (MSYS2) is a console app: without this, Windows allocates a
    // console window for every case in this file.
    windowsHide: true
  });
  return { status: result.status ?? -1, stderr: result.stderr ?? '' };
}

describe('piping-a-test-run — a runner token that is not the command is allowed', () => {
  const measuredFalsePositives: ReadonlyArray<{ label: string; command: string }> = [
    {
      label: 'the grep SEARCH PATTERN carries the runner token',
      command: 'ps -W 2>/dev/null | grep -iE "node|vitest|git" | head -12'
    },
    {
      label: 'a grep -r search whose literal holds the piped shape',
      command: "grep -rn 'x | vitest run | tail -30' docs/"
    },
    {
      label: 'a fixture printed as data, not run',
      command: "printf '%s' 'x | vitest run | tail -5'"
    }
  ];

  for (const { label, command } of measuredFalsePositives) {
    it(
      `allows the measured false positive: ${label}`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        expect(runBashHook(PIPE_HOOK, command).status).toBe(0);
      }
    );
  }

  const controls: ReadonlyArray<string> = [
    // a for loop feeding a fixture to the hook: allowed before and after, because
    // the `; do` after the literal is never a filter stage
    'for f in "node node_modules/vitest/vitest.mjs run | tail" "b"; do echo "$f"; done',
    'for f in "a | node node_modules/vitest/vitest.mjs run | tail -5"; do echo "$f"; done',
    // the header's line-29 example, spelled without a pipe in front of the runner
    "grep -r 'vitest run | tail -30' docs/",
    // the near-miss: the runner is on the RIGHT of the pipe, so `$?` is the
    // runner's own status and the harm the header names is absent. Allowed, and
    // it must stay allowed — the rule is about the number being read, not about
    // pipelines that merely mention a runner.
    'echo x | vitest run'
  ];

  for (const command of controls) {
    it(
      `allows (control, allowed before the fix too): ${command}`,
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        expect(runBashHook(PIPE_HOOK, command).status).toBe(0);
      }
    );
  }

  /**
   * KNOWN MISS, pinned so it cannot change silently.
   *
   * A runner in a non-first stage WITH A FILTER AFTER IT has the harm this rule
   * exists to prevent — `$?` really is the pager's number — and it was REFUSED
   * before this fix (measured: exit 2). Reading the runner from stage 1 is what
   * makes it allowed, and stage position is the only discriminator available
   * once quotes are not parsed. So the arm below asserts the WRONG answer on
   * purpose: it is the price of the fix, it is named in the script's header, and
   * asserting it means a later change that closes the miss reddens here and has
   * to update this arm deliberately.
   */
  it(
    'KNOWN MISS — a mid-pipeline runner with a filter after it is no longer refused',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // refused (exit 2) before the fix; allowed now, which is a miss, not a goal
      expect(runBashHook(PIPE_HOOK, 'echo x | vitest run | tail -5').status).toBe(0);
    }
  );

  /**
   * The SAME miss, from the OTHER input class — pinned separately on purpose.
   *
   * An arm that names one member of a class reads as though the class has one
   * member. The class is "any real pipe before the runner", and this is its
   * second shape: a lookup piped to `head`, then the suite piped to `tail` in
   * the same `&&` chain. It is not a restatement of the arm above — different
   * command, different reason the runner is not stage 1 — and it is an ordinary
   * way to run a suite, which is why it is the worse of the two.
   *
   * Measured: exit 2 before, exit 0 after. Four further shapes in the same class
   * are enumerated in the script's header (`echo done | vitest run | tail`;
   * `cat package.json | grep name && vitest run | tail`;
   * `echo 'a|b' > x; vitest run | tail`), so a reader can see the class.
   */
  it(
    'KNOWN MISS (second input class) — a piped lookup chained into a piped runner',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const chained = 'git status --short | head -5 && pnpm test:unit | tail -20';
      expect(runBashHook(PIPE_HOOK, chained).status).toBe(0);
    }
  );

  /**
   * The WRAPPER edge, and the reason the fix for it is the document and not this
   * matcher.
   *
   * `timeout 300 pnpm vitest run 2>&1 | tail -100` was the exact line
   * `skills/peaks-test/SKILL.md` prescribed, and the skill then told the reader
   * to read its exit code as the verdict. The first word of stage 1 is
   * `timeout`, so this hook never sees a runner and allows it — measured exit 0,
   * while the same command without `timeout` exits 2, which isolates the cause.
   *
   * Both arms are pinned: the wrapped form stays allowed (the hook cannot see
   * through wrapper words, and chasing them is unbounded), and the skill's page
   * no longer prescribes it.
   */
  it(
    'KNOWN EDGE — a wrapper word hides the runner, so the SKILL had to be repaired instead',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const wrapped = 'timeout 300 pnpm vitest run 2>&1 | tail -100';
      expect(runBashHook(PIPE_HOOK, wrapped).status).toBe(0);
      // the same command minus the wrapper IS refused, so the wrapper is the cause
      expect(runBashHook(PIPE_HOOK, 'pnpm vitest run 2>&1 | tail -100').status).toBe(2);
    }
  );

  it(
    'the prescribed command in skills/peaks-test/SKILL.md is the guarded form',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The doc is the repair, so the doc is what this arm reads. Anti-vacuity:
      // the file must have been read and must still be the one that prescribes a
      // run command at all.
      const skill = readFileSync(
        resolve(HOOKS_DIR, '..', '..', '..', 'skills', 'peaks-test', 'SKILL.md'),
        'utf8'
      );
      expect(skill.length, 'the skill file was really read').toBeGreaterThan(1000);
      expect(skill).toContain('## Step 2: Run the test suite');
      expect(skill, 'the step still shows a run command').toMatch(/timeout 300 pnpm vitest run/);
      // and that command redirects rather than piping into a filter
      expect(skill).toContain('timeout 300 pnpm vitest run > suite.log 2>&1; echo "EXIT=$?"');
      expect(skill).toContain('Do NOT pipe the run into a filter or pager');
      // The LINE the skill used to prescribe must be gone. Asserted per line
      // rather than against the whole file, because the new prose quotes the old
      // form inline to explain why it is wrong — a substring check would redden
      // on the warning itself.
      const lines = skill.split('\n').map((line) => line.trim());
      expect(lines, 'the old prescribed line is gone').not.toContain(
        'timeout 300 pnpm vitest run 2>&1 | tail -100'
      );
      // and the exit-code sentence must be about the RUNNER's code, not a pipeline's
      expect(skill).toContain('`EXIT=0` means the runner exited 0');
      expect(skill).not.toContain('If the exit code is 0, tests passed');
    }
  );
});
