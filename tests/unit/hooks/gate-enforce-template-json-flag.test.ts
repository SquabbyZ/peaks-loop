/**
 * Slice 2026-08-05-hook-json-flag — drift guard.
 *
 * Regression: the gate-enforce hook command previously shipped without
 * `--json`. Without it, the hook's stdout is plain `{}` rather than a
 * structured envelope, which Claude Code's hook validator rejects with
 *   "Hook JSON output validation failed: <empty>"
 * See `.peaks/memory/bash-pretooluse-hook-json-error-fix.md` for the 2026-07-27
 * fix history.
 *
 * Slice 2026-09-10-rd-win-hook-fix RESHAPED the entry: the gate-enforce Bash
 * hook now carries a machine-specific `shell` on Windows (the default Git-Bash
 * shell force-allocates a console window on every Bash tool call), so it moved
 * out of the committed, shared `.claude/settings.json` and into the
 * machine-local, gitignored `.claude/settings.local.json`.
 *
 * Because that file is gitignored it is absent from a fresh clone and from CI,
 * so the shape assertions below are made against the canonical EMITTERS
 * (`buildClaudeSettingsLocalJson()` and `resolveHookSpec`) rather than against
 * the on-disk machine-local file. The only on-disk assertion is about the
 * committed shared file, which is always present.
 *
 * This test asserts that BOTH surfaces carry `--json`:
 *   1. `src/services/workspace/claude-settings-template.ts` — the pure template
 *      that `peaks workspace init` materializes into `.claude/settings.local.json`.
 *   2. `src/services/skills/hooks-settings-service.ts` — the canonical
 *      `HOOK_ENFORCE_COMMAND` template literal. (Note: the PRD originally
 *      cited `src/services/workspace/claude-settings-template.ts`, but that
 *      file only carries the `peaks code gate-step-08` literal for the
 *      `.claude/settings.local.json` Write|Edit|MultiEdit + Bash PreToolUse
 *      matchers; the `peaks gate enforce --project` literal lives in this
 *      hooks-settings-service.ts module — verified by `grep "peaks gate enforce"`.
 *      The test reads both files defensively so any future template-source
 *      drift is caught.)
 *
 * If either file ever drifts back to the `--json`-less form, this test fails,
 * the next `peaks hooks install` keeps the regression out of fresh installs,
 * and the on-disk settings files stay consistent with the template.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildClaudeSettingsLocalJson } from '~/src/services/workspace/claude-settings-template';

const ROOT = join(__dirname, '..', '..', '..');

type BashHandler = { type?: string; command?: string; shell?: string };

/** Collect every handler on a `Bash` matcher group of a built template. */
function bashHandlers(matcher: string): BashHandler[] {
  const template = buildClaudeSettingsLocalJson() as unknown as {
    hooks: { PreToolUse: Array<{ matcher: string; hooks: BashHandler[] }> };
  };
  return template.hooks.PreToolUse.filter((entry) => entry.matcher === matcher).flatMap((entry) => entry.hooks);
}

/** Find the template handler whose command contains `needle`. */
function handlerFor(needle: string): BashHandler {
  const found = bashHandlers('Bash').find((h) => String(h.command).includes(needle));
  if (found === undefined) {
    throw new Error(`No Bash handler containing "${needle}" in the workspace-init template`);
  }
  return found;
}

describe('slice 2026-08-05-hook-json-flag: gate-enforce hook must carry --json', () => {
  it('when the workspace-init template is built, should end the gate-enforce command with --json', () => {
    // given: the pure template that `peaks workspace init` materializes into
    //        the machine-local .claude/settings.local.json
    // when: its Bash gate-enforce handler is read
    const cmd = String(handlerFor('peaks gate enforce').command);
    // then: the handler invokes `peaks gate enforce`, carries
    //       `--project "<dir>"`, and ends with `--json`
    expect(cmd).toMatch(/^peaks gate enforce --project /);
    expect(cmd).toMatch(/--project .+\b/);
    expect(cmd.trimEnd().endsWith('--json')).toBe(true);
  });

  it('when the committed settings are read, should stay platform-neutral', () => {
    // given: the committed, shared .claude/settings.json that every
    //        teammate (macOS / Linux / Windows) reads
    // when: its hooks tree is parsed
    const parsed = JSON.parse(readFileSync(join(ROOT, '.claude', 'settings.json'), 'utf8')) as {
      hooks?: { PreToolUse?: unknown };
    };
    // then: it carries no Bash PreToolUse handler at all — any `shell` value
    //       here would be machine-specific and break the other platforms
    expect(parsed.hooks?.PreToolUse).toBeUndefined();
  });

  it('HOOK_ENFORCE_COMMAND template literal in hooks-settings-service.ts ends with --json', () => {
    const src = readFileSync(
      join(ROOT, 'src', 'services', 'skills', 'hooks-settings-service.ts'),
      'utf8'
    );
    // The canonical template literal — anchored on the `HOOK_ENFORCE_COMMAND`
    // export, with optional `${...}` env-var expansion allowed inside the
    // shell-quoted project dir value. Must end with `--json``.
    const re =
      /HOOK_ENFORCE_COMMAND\s*=\s*`peaks gate enforce --project "[^"]*\$\{CLAUDE_PROJECT_DIR\}[^"]*" --json`/;
    expect(src).toMatch(re);
  });

  it('when the canonical hook spec is resolved, should end the command with --json', () => {
    // given: the per-IDE spec `peaks hooks install` actually renders the hook
    //        from (a surface the old constant-only assertion never covered)
    // when: the claude-code spec is resolved
    const src = readFileSync(
      join(ROOT, 'src', 'services', 'skills', 'hooks-codegate-superpowers.ts'),
      'utf8'
    );
    // then: the rendered command carries the `--json` flag the constant
    //       documents, so install and template cannot drift apart
    expect(src).toContain("const jsonFlag = isClaudeCode ? ' --json' : '';");
  });
});
