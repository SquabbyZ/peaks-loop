/**
 * Slice rid-skill-persistence-001 (2026-08-12) — drift guard.
 *
 * Verifies that `src/services/hooks/pre-tool-superpowers-bridge.sh`
 * still emits the bridge reminder after the regex was widened to
 * cover the four additional superpowers chain-step Skills
 * (`systematic-debugging` / `test-driven-development` /
 * `verification-before-completion` / `using-superpowers`).
 *
 * Coverage: 4 cases (one per newly-denied skill). Each test pipes a
 * `Skill` tool-call payload whose `skill` field references the
 * skill under test, then asserts the script's stdout contains the
 * `hookSpecificOutput.additionalContext` envelope (i.e. the bridge
 * reminder fires; the IDE-level deny in L3 does not gate this L2
 * backstop). The test depends on bash availability but does not
 * require jq — the bridge script is grep-based.
 */
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const HOOK = resolve(
  __dirname, '..', '..', '..',
  'src', 'services', 'hooks', 'pre-tool-superpowers-bridge.sh'
);

const NEW_SKILLS: ReadonlyArray<string> = [
  'systematic-debugging',
  'test-driven-development',
  'verification-before-completion',
  'using-superpowers',
];

function runBridge(payload: string): { status: number | null; stdout: string; stderr: string } {
  // Bash is required (the shebang in pre-tool-superpowers-bridge.sh
  // uses `#!/usr/bin/env bash`); on stock Git Bash for Windows this
  // resolves to /usr/bin/bash. Caller-side preference is documented in
  // `.peaks/memory/2026-07-27-windows-shell-pref.md`.
  if (!existsSync(HOOK)) {
    throw new Error(`bridge script not found: ${HOOK}`);
  }
  const result = spawnSync('bash', [HOOK], {
    input: payload,
    encoding: 'utf8',
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

describe('slice rid-skill-persistence-001: bridge.sh rejects the 4 newly-denied superpowers skills', () => {
  for (const skillId of NEW_SKILLS) {
    it(`emits the bridge reminder when Skill tool calls superpowers:${skillId}`, () => {
      const payload = JSON.stringify({
        tool_name: 'Skill',
        tool_input: { skill: `superpowers:${skillId}` }
      });
      const { status, stdout } = runBridge(payload);
      expect(status).toBe(0);
      // The bridge envelope surfaces in stdout as a JSON object with
      // `hookSpecificOutput.additionalContext`. We accept either the
      // raw envelope (Claude Code shape) or one with a `decision`
      // wrapper (some IDEs expect a normalized outer shape).
      expect(stdout).toMatch(/hookSpecificOutput/);
      expect(stdout).toMatch(/additionalContext/);
    });
  }
});
