/**
 * Slice 2026-08-05-hook-json-flag — drift guard.
 *
 * Regression: `.claude/settings.json` previously shipped with the hook command
 * `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}"` (no `--json`). Without
 * `--json`, the hook's stdout is plain `{}` rather than a structured envelope,
 * which Claude Code's hook validator rejects with
 *   "Hook JSON output validation failed: <empty>"
 * See `.peaks/memory/bash-pretooluse-hook-json-error-fix.md` for the 2026-07-27
 * fix history.
 *
 * This test asserts that BOTH surfaces carry `--json`:
 *   1. `.claude/settings.json` — the current on-disk settings file.
 *   2. `src/services/skills/hooks-settings-service.ts` — the canonical
 *      `HOOK_ENFORCE_COMMAND` template literal that `peaks hooks install`
 *      uses to scaffold a fresh settings.json. (Note: the PRD originally
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
 * and the on-disk settings.json stays consistent with the template.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');

/**
 * Parse a settings.json-shaped file and return the PreToolUse Bash hook
 * command string. Tolerates either `\"...\"` (escaped JSON) or `"..."`
 * (unescaped) quoting around the project-dir placeholder.
 */
function readBashPreToolUseCommand(settingsJsonPath: string): string {
  const raw = readFileSync(settingsJsonPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    hooks?: { PreToolUse?: Array<{ matcher?: string; hooks?: Array<{ type?: string; command?: string }> }> };
  };
  const entries = parsed.hooks?.PreToolUse ?? [];
  for (const entry of entries) {
    if (entry.matcher !== 'Bash') continue;
    for (const h of entry.hooks ?? []) {
      if (h.type === 'command' && typeof h.command === 'string') return h.command;
    }
  }
  throw new Error(`No Bash PreToolUse command found in ${settingsJsonPath}`);
}

describe('slice 2026-08-05-hook-json-flag: gate-enforce hook must carry --json', () => {
  it('.claude/settings.json Bash PreToolUse command ends with --json', () => {
    const cmd = readBashPreToolUseCommand(join(ROOT, '.claude', 'settings.json'));
    // The Bash matcher command must:
    //   1. Invoke `peaks gate enforce`
    //   2. Carry `--project "<dir>"` (or `${...}` placeholder)
    //   3. End with `--json`
    expect(cmd).toMatch(/^peaks gate enforce --project /);
    expect(cmd).toMatch(/--project .+\b/);
    expect(cmd.trimEnd().endsWith('--json')).toBe(true);
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

  it('drift guard: HOOK_ENFORCE_COMMAND template ends with --json (template-side only)', () => {
    // Drift guard: the canonical template literal in hooks-settings-service.ts
    // must end with `--json` so that `peaks hooks install` writes a --json-bearing
    // command into every fresh `.claude/settings.json`. The env-var placeholder
    // ${CLAUDE_PROJECT_DIR} is left literal in the rendered settings file (Claude
    // Code resolves it at hook execution time, not at install time), so we do
    // NOT compare the rendered template byte-for-byte against the on-disk file.
    const templateSrc = readFileSync(
      join(ROOT, 'src', 'services', 'skills', 'hooks-settings-service.ts'),
      'utf8'
    );
    const match = templateSrc.match(/HOOK_ENFORCE_COMMAND\s*=\s*`([^`]+)`/);
    expect(match).not.toBeNull();
    const templateLiteral = match![1]!;
    expect(templateLiteral.startsWith('peaks gate enforce --project ')).toBe(true);
    expect(templateLiteral.includes('${CLAUDE_PROJECT_DIR}')).toBe(true);
    expect(templateLiteral.trimEnd().endsWith('--json')).toBe(true);
  });
});
