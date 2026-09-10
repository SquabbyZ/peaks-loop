/**
 * Slice c5-write-hook-exec-form — the Write|Edit|MultiEdit PreToolUse gate.
 *
 * Background. The gate used to be emitted as an inline `node -e "<js>"`
 * one-liner whose escaping contract was defined in terms of bash reducing `\\`
 * to `\` inside a `"..."` wrapper. PowerShell does not perform that reduction,
 * so the handler could not take the platform `shell` pin its Bash siblings
 * carry. TEMPLATE_VERSION 1.6.0 moved the decision into
 * `src/services/hooks/write-gate.js`, invoked as `node "<path>"` — no inline
 * payload, therefore no shell dialect to couple to.
 *
 * Slice c5b-write-gate-polarity NARROWED the decision. The relocated chain read
 * its eight directory names as an EXCLUSION list, so `_runtime` AND every other
 * `.peaks/<slug>/` were allowed. `.claude/HOOKS.md` documents the opposite
 * contract for this handler (a write "targeting `.peaks/_runtime/`"), and
 * `CLAUDE.md` bans a top-level `.peaks/<change-id>/` outright. The table below
 * was rewritten to that documented contract, which the user chose:
 *
 *   - allow (0): only paths under `.peaks/_runtime/`
 *   - fall through (1): everything else — including every name that used to sit
 *     in the exclusion list and, as the flip, a bare `.peaks/<slug>/`
 *
 * ROWS THAT FLIPPED (both 0 → 1): `.peaks/2026-09-10-thing/x.md` and
 * `.peaks/something-else/x.md` — the deleted `.peaks/<slug>/` allow branch. The
 * other rows are unchanged: they already fell through before too, because the
 * exclusion list named the directories to REJECT.
 *
 * What this file asserts, and why both halves matter:
 *
 *   1. THE DECISION IS THE DOCUMENTED ONE. Each row is executed through the
 *      real emitted command on both channels: stdin (how Claude Code really
 *      delivers the payload) and the legacy positional arg.
 *
 *   2. THE COMMAND IS SHELL-AGNOSTIC. It carries no inline JavaScript, no
 *      backslash, and yields identical exit codes under two different shells.
 *      That is what the reshape bought, so it is asserted by execution rather
 *      than by string inspection alone.
 *
 * The `argv[2]` fallback is asserted too, because it is what keeps the existing
 * positional-arg invocation (and the rid-010 integration test) working.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import {
  buildClaudeSettingsLocalJson,
  writeGateScriptPath
} from '~/src/services/workspace/claude-settings-template';
import { resolveHookShell } from '~/src/services/skills/hooks-codegate-superpowers';

const ROOT = join(__dirname, '..', '..', '..');

type Handler = { type: string; command: string; shell?: string };

/** The emitted Write|Edit|MultiEdit handler, as `peaks workspace init` writes it. */
function writeHandler(): Handler {
  const template = buildClaudeSettingsLocalJson() as unknown as {
    hooks: { PreToolUse: Array<{ matcher: string; hooks: Handler[] }> };
  };
  const entry = template.hooks.PreToolUse.find((e) => e.matcher === 'Write|Edit|MultiEdit');
  const handler = entry?.hooks[0];
  if (handler === undefined) throw new Error('no Write|Edit|MultiEdit handler in the template');
  return handler;
}

/**
 * The decision table. `stdin` is how Claude Code really delivers the payload;
 * `argv` is the legacy positional-arg channel. Both must agree.
 */
const DECISION_TABLE: ReadonlyArray<{ path: string; code: number }> = [
  { path: '.peaks/_runtime/2026-09-10-x/rd/a.md', code: 0 },
  { path: 'D:/proj/.peaks/_runtime/2026-09-10-x/rd/a.md', code: 0 },
  { path: '.peaks/memory/foo.md', code: 1 },
  { path: '.peaks/sops/x.md', code: 1 },
  { path: '.peaks/retrospective/x.md', code: 1 },
  { path: '.peaks/project-scan/x.md', code: 1 },
  { path: '.peaks/perf-baseline/x.md', code: 1 },
  { path: '.peaks/_sub_agents/x.md', code: 1 },
  { path: '.peaks/_dogfood/x.md', code: 1 },
  { path: '.peaks/2026-09-10-thing/x.md', code: 1 },
  { path: '.peaks/something-else/x.md', code: 1 },
  { path: '.peaks/', code: 1 },
  { path: '', code: 1 }
];

function payloadFor(candidate: string): string {
  return candidate === ''
    ? ''
    : JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: candidate } });
}

/** Run the real emitted command, payload on stdin (Claude Code's channel). */
function runViaStdin(command: string, candidate: string): number | null {
  const result = spawnSync(command, { shell: true, input: payloadFor(candidate), encoding: 'utf8' });
  return result.status;
}

/** Run the real emitted command, candidate appended as a positional arg. */
function runViaArgv(command: string, candidate: string): number | null {
  const result = spawnSync(`${command} "${candidate}"`, { shell: true, input: '', encoding: 'utf8' });
  return result.status;
}

describe('slice c5b-write-gate-polarity: the write gate allows only .peaks/_runtime/', () => {
  for (const { path, code } of DECISION_TABLE) {
    const label = path === '' ? '(empty path)' : path;
    it(`given stdin payload for "${label}", when the emitted command runs, then exit ${code}`, () => {
      // given: the handler peaks workspace init writes into settings.local.json
      // when: it is executed exactly as Claude Code would (payload on stdin)
      const status = runViaStdin(writeHandler().command, path);
      // then: the documented decision — 0 only under .peaks/_runtime/
      expect(status).toBe(code);
    });

    it(`given positional arg "${label}", when the emitted command runs, then exit ${code}`, () => {
      // The legacy channel: the old form read argv[1] and could only ever
      // receive a path this way. New form: argv[2]. Same table, by design.
      const status = runViaArgv(writeHandler().command, path);
      expect(status).toBe(code);
    });
  }
});

describe('slice c5-write-hook-exec-form: the emitted command is shell-agnostic', () => {
  it('when the handler is emitted, should invoke the script with no inline JavaScript', () => {
    // given: a fix whose entire purpose is to remove the shell-escaped payload
    const { command } = writeHandler();
    // then: there is no `-e` exit hatch, no `"` inside the payload, no backslash
    //       for bash to reduce or for PowerShell to backtick-escape
    expect(command).toMatch(/^node "[^"]+"$/);
    expect(command).not.toContain('-e');
    expect(command).not.toContain('\\');
  });

  it('when the handler is emitted, should point at a script that exists on disk', () => {
    // given: the path is derived from this module's own location, not from
    //        process.argv[1] (see the daemon-supervisor precedent)
    const scriptPath = writeGateScriptPath();
    // then: the same relative filename must resolve in the tree we run from
    expect(existsSync(scriptPath)).toBe(true);
    expect(scriptPath.endsWith('/services/hooks/write-gate.js')).toBe(true);
  });

  it('when the handler is emitted, should carry the same platform shell pin as its siblings', () => {
    // given: the pin that stops Windows' default Git Bash force-allocating a
    //        console window on every matching tool call
    const shell = resolveHookShell();
    const { shell: handlerShell } = writeHandler();
    // then: pinned on win32, key omitted entirely elsewhere
    expect(handlerShell).toBe(shell);
  });

  it('when a script ships alongside the build, should be copied into dist', () => {
    // given: `node <path>` resolves to dist/services/hooks/ in an installed
    //        consumer. tsc does not compile a plain .js asset, so without the
    //        copy-templates target the hook is a broken path for every consumer
    //        while every test in this repo still passes.
    const copyScript = readFileSync(join(ROOT, 'scripts', 'copy-templates.mjs'), 'utf8');
    // then: the hooks directory is a copy target with .js included
    expect(copyScript).toContain("'src/services/hooks'");
    expect(copyScript).toMatch(/extensions: \['\.js'\]/);
  });
});

/**
 * The strongest available evidence that the escaping coupling is gone: run the
 * SAME emitted string through two different shells and require identical exit
 * codes. Before the reshape this failed — the payload was escaped for bash.
 * Each shell is skipped independently when it is not installed.
 */
const SHELLS: ReadonlyArray<{ name: string; probe: string[]; run: (command: string) => string[] }> = [
  { name: 'bash', probe: ['--version'], run: (command) => ['-c', command] },
  { name: 'powershell', probe: ['-NoProfile', '-Command', 'exit 0'], run: (command) => ['-NoProfile', '-Command', command] }
];

describe('slice c5-write-hook-exec-form: two shells agree on the same command', () => {
  for (const shell of SHELLS) {
    const available = spawnSync(shell.name, shell.probe, { encoding: 'utf8' }).status === 0;
    it.skipIf(!available)(`given ${shell.name}, when the emitted command runs, then the table matches`, () => {
      // given: an interpreter running the emitted command string verbatim
      const { command } = writeHandler();
      const mismatches: string[] = [];
      // when: every row of the table is executed through that shell
      for (const { path, code } of DECISION_TABLE) {
        const result = spawnSync(shell.name, shell.run(command), {
          input: payloadFor(path),
          encoding: 'utf8'
        });
        if (result.status !== code) {
          mismatches.push(`${path || '(empty)'} → ${result.status}, expected ${code}`);
        }
      }
      // then: ${shell.name} produced the same decision as the native run
      expect(mismatches).toEqual([]);
    });
  }
});
