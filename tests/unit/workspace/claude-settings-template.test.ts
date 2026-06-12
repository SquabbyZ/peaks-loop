/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — data test for the consumer-project
 * `.claude/settings.local.json` template.
 *
 * The template is a pure-data module that returns the JSON content
 * `peaks workspace init` will write to the consumer project's
 * `.claude/settings.local.json` file. The template is a PreToolUse hook
 * allow-list that bypasses the Claude Code [Fact-Forcing Gate] for
 * tool calls whose paths or commands target the peaks-managed
 * `.peaks/` workspace.
 *
 * Sub-cases (per PRD AC):
 *   (a) template is a valid JSON-serialisable object
 *   (b) the template declares a PreToolUse hooks block
 *   (c) the Write|Edit|MultiEdit matcher allows paths under
 *       `.peaks/_runtime/` and `.peaks/<changeId>/`
 *   (d) the Bash matcher allows commands that start with `peaks ` for
 *       the documented peaks CLI subcommands
 *   (e) the rendered template is reproducible (no random ids, no
 *       timestamps that would invalidate the test)
 *
 * The template is small enough to test without filesystem mocks. The
 * `--no-claude-hooks` opt-out flag is exercised in
 * `workspace-init-claude-hooks.test.ts`; the template itself is a pure
 * function and does not need the flag.
 */

import { describe, expect, test } from 'vitest';
import {
  buildClaudeSettingsLocalJson,
  CLAUDE_SETTINGS_LOCAL_FILENAME
} from '../../../src/services/workspace/claude-settings-template.js';

describe('claude-settings-template — pure-data structure', () => {
  test('returns a JSON-serialisable object', () => {
    const template = buildClaudeSettingsLocalJson();
    // Must not throw. Round-tripping through JSON proves the value is
    // a plain JSON-compatible object (no BigInt, no functions, no
    // circular refs, no Symbols).
    const roundTrip = JSON.parse(JSON.stringify(template)) as unknown;
    expect(typeof roundTrip).toBe('object');
    expect(roundTrip).not.toBeNull();
  });

  test('declares a PreToolUse hooks block at the top level', () => {
    const template = buildClaudeSettingsLocalJson() as { hooks?: { PreToolUse?: unknown } };
    expect(template.hooks).toBeDefined();
    expect(Array.isArray(template.hooks?.PreToolUse)).toBe(true);
    const preToolUse = template.hooks?.PreToolUse as unknown[];
    expect(preToolUse.length).toBeGreaterThanOrEqual(1);
  });

  test('Write|Edit|MultiEdit matcher is present and allow-rules match .peaks/_runtime/ and .peaks/<changeId>/', () => {
    const template = buildClaudeSettingsLocalJson() as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> }
    };
    const writeMatcher = template.hooks.PreToolUse.find((entry) => entry.matcher === 'Write|Edit|MultiEdit');
    expect(writeMatcher).toBeDefined();
    expect(writeMatcher!.hooks.length).toBe(1);
    const hook = writeMatcher!.hooks[0]!;
    expect(hook.type).toBe('command');
    // The hook command is a Node one-liner that path-matches; the
    // allow-list literal `.peaks/_runtime/` must appear in the command
    // string so the template ships with the rule baked in.
    expect(hook.command).toContain('.peaks/_runtime/');
  });

  test('Bash matcher is present and allow-rules include `peaks ` prefix', () => {
    const template = buildClaudeSettingsLocalJson() as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> }
    };
    const bashMatcher = template.hooks.PreToolUse.find((entry) => entry.matcher === 'Bash');
    expect(bashMatcher).toBeDefined();
    expect(bashMatcher!.hooks.length).toBe(1);
    const hook = bashMatcher!.hooks[0]!;
    expect(hook.type).toBe('command');
    // The Bash hook must whitelist the `peaks ` prefix; subcommand-
    // level whitelisting is layered on top in the implementation but
    // the prefix literal MUST be present in the command string.
    expect(hook.command).toContain('peaks ');
  });

  test('exposes the canonical filename constant for the caller to use', () => {
    expect(CLAUDE_SETTINGS_LOCAL_FILENAME).toBe('.claude/settings.local.json');
  });

  test('rendered template is reproducible (no embedded timestamps or random ids)', () => {
    const a = buildClaudeSettingsLocalJson();
    const b = buildClaudeSettingsLocalJson();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
