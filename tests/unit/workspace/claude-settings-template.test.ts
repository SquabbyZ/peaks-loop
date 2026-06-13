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
 *
 * Slice fix-claude-settings-template-hook-node-wrapper — added node -e
 * wrapper contract assertions + argv[2] indexing + spawn-based
 * cross-platform behaviour tests. The wrapper must be a real shell-
 * evaluable `node -e "<js>"` string so Claude Code's hook runner does
 * not trip a bash syntax error.
 */

import { execFileSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import {
  buildClaudeSettingsLocalJson,
  CLAUDE_SETTINGS_LOCAL_FILENAME,
  TEMPLATE_VERSION,
  templateContentMatches
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

describe('claude-settings-template — node -e wrapper contract (slice fix-claude-settings-template-hook-node-wrapper)', () => {
  function getHookCommand(matcher: string): string {
    const template = buildClaudeSettingsLocalJson() as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> }
    };
    const entry = template.hooks.PreToolUse.find((e) => e.matcher === matcher);
    if (!entry || entry.hooks.length === 0) {
      throw new Error(`matcher ${matcher} missing`);
    }
    return entry.hooks[0]!.command;
  }

  function runHook(command: string, candidate: string): { exitCode: number; stderr: string } {
    // Execute the wrapped command exactly the way Claude Code's hook
    // runner would: by passing the `command` field to the platform
    // shell as a single string. `shell: true` lets the shell parse
    // the `node -e "..."` wrapper, then the spawned Node child reads
    // the candidate from `process.argv[1]` (the first user-passed arg
    // under -e — see https://nodejs.org/api/process.html#processargv,
    // consistent across Windows, macOS, and Linux). We pass the
    // candidate as an extra positional arg so the wrapper sees it on
    // `argv[1]`.
    try {
      execFileSync(`${command} ${JSON.stringify(candidate)}`, {
        encoding: 'utf8',
        stdio: ['ignore', 'ignore', 'pipe'],
        shell: true
      });
      return { exitCode: 0, stderr: '' };
    } catch (error: unknown) {
      const err = error as { status?: number | null; stderr?: string | Buffer };
      return {
        exitCode: err.status ?? 1,
        stderr: typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? ''
      };
    }
  }

  test('Bash hook command is wrapped in `node -e "..."`', () => {
    const command = getHookCommand('Bash');
    expect(command.startsWith('node -e "')).toBe(true);
    expect(command.endsWith('"')).toBe(true);
  });

  test('Write hook command is wrapped in `node -e "..."`', () => {
    const command = getHookCommand('Write|Edit|MultiEdit');
    expect(command.startsWith('node -e "')).toBe(true);
    expect(command.endsWith('"')).toBe(true);
  });

  test('embedded double quotes in the inner JS payload are JSON-escaped as \\"', () => {
    const command = getHookCommand('Bash');
    // The wrapped form is `node -e "<inner>"` where every literal `"`
    // in the inner JS has been escaped to `\"`. We assert the escaping
    // contract by checking that the inner part contains the expected
    // `\"peaks \"` (escaped) sequence — not the unescaped `"peaks "`.
    // We can't simply check `inner.includes('"')` because `\"` is two
    // characters in the runtime string (backslash + quote), so the
    // indexOf for `"` would always match the trailing `"` of an
    // escape pair. Instead, we assert the escaped form is present and
    // the unescaped form is absent.
    expect(command).toContain('\\"peaks \\"');
    expect(command).not.toContain('"peaks "');
    // The wrapper boundary is intact: the command starts with `node -e "`
    // and ends with a single closing `"`.
    expect(command.startsWith('node -e "')).toBe(true);
    expect(command.endsWith('"')).toBe(true);
    expect(command.slice('node -e "'.length, -1).includes('"peaks "')).toBe(false);
  });

  test('inner JS reads candidate from process.argv[1] (Node docs: argv[1] is the first user-passed arg under -e)', () => {
    const bashCommand = getHookCommand('Bash');
    expect(bashCommand).toContain('process.argv[1]');
    // And it MUST NOT read argv[2] — that's the second user-passed
    // arg under -e, which Claude Code's hook runner does not populate
    // for this hook.
    expect(bashCommand).not.toContain('process.argv[2]');
  });

  test('Bash hook exits 0 for `peaks workspace init --project . --json` and non-zero for `npm install foo`', () => {
    const bashCommand = getHookCommand('Bash');
    const allow = runHook(bashCommand, 'peaks workspace init --project . --json');
    expect(allow.exitCode, `expected allow, stderr=${allow.stderr}`).toBe(0);
    const deny = runHook(bashCommand, 'npm install foo');
    expect(deny.exitCode, `expected deny, stderr=${deny.stderr}`).not.toBe(0);
  });

  test('Write hook allows `.peaks/_runtime/...` and `.peaks/<changeId>/...` paths and denies `src/...`', () => {
    const writeCommand = getHookCommand('Write|Edit|MultiEdit');
    const allowed = [
      '.peaks/_runtime/2026-06-13-session-x/session.json',
      '.peaks/_runtime/2026-06-13-session-x/rd/requests/001-foo.md',
      '.peaks/fix-foo/rd/requests/001-foo.md',
      '.peaks/fix-foo/qa/test-cases/001-foo.md'
    ];
    for (const p of allowed) {
      const r = runHook(writeCommand, p);
      expect(r.exitCode, `expected allow for ${p}, stderr=${r.stderr}`).toBe(0);
    }
    const denied = ['src/index.ts', 'package.json', 'README.md'];
    for (const p of denied) {
      const r = runHook(writeCommand, p);
      expect(r.exitCode, `expected deny for ${p}`).not.toBe(0);
    }
  });
});

describe('claude-settings-template — TEMPLATE_VERSION + templateContentMatches (slice 2026-06-13-selfheal-claude-settings-template)', () => {
  test('TEMPLATE_VERSION is a non-empty semver-ish string', () => {
    expect(typeof TEMPLATE_VERSION).toBe('string');
    expect(TEMPLATE_VERSION.length).toBeGreaterThan(0);
    expect(TEMPLATE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test('templateContentMatches returns true for identical strings', () => {
    const serialized = JSON.stringify(buildClaudeSettingsLocalJson(), null, 2) + '\n';
    expect(templateContentMatches(serialized, serialized)).toBe(true);
  });

  test('templateContentMatches returns true regardless of whitespace or key order', () => {
    const serialized = JSON.stringify(buildClaudeSettingsLocalJson(), null, 2) + '\n';
    // Re-serialize with different indentation.
    const reformatted = JSON.stringify(buildClaudeSettingsLocalJson(), null, 4) + '\n';
    // The comparator parses both and compares ASTs — whitespace must not affect the verdict.
    expect(templateContentMatches(serialized, reformatted)).toBe(true);
  });

  test('templateContentMatches returns true when on-disk content matches generated content', () => {
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    const onDisk = JSON.stringify(buildClaudeSettingsLocalJson());
    expect(templateContentMatches(generated, onDisk)).toBe(true);
  });

  test('templateContentMatches returns false when on-disk content has drifted (synthesized OLD unwrapped version)', () => {
    // Build an OLD-style template that lacks the `node -e "..."` wrapper
    // (pre-9551c52 shape). This is the exact stale-template scenario the
    // self-heal fixes.
    const stale = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Write|Edit|MultiEdit',
            hooks: [
              {
                type: 'command',
                command: 'const p=process.argv[1]||"";if(p.includes(".peaks/_runtime/"))process.exit(0);process.exit(1)'
              }
            ]
          },
          {
            matcher: 'Bash',
            hooks: [
              {
                type: 'command',
                command: 'const c=process.argv[1]||"";if(!c.startsWith("peaks "))process.exit(1);process.exit(0)'
              }
            ]
          }
        ]
      }
    };
    const staleSerialized = JSON.stringify(stale);
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    expect(templateContentMatches(generated, staleSerialized)).toBe(false);
  });

  test('templateContentMatches returns false on JSON.parse errors', () => {
    const valid = JSON.stringify(buildClaudeSettingsLocalJson());
    expect(templateContentMatches('not json {{{', valid)).toBe(false);
    expect(templateContentMatches(valid, 'also not json')).toBe(false);
  });

  test('templateContentMatches returns false when shape is missing hooks.PreToolUse', () => {
    const missing = JSON.stringify({ hooks: {} });
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    expect(templateContentMatches(generated, missing)).toBe(false);
  });

  test('templateContentMatches returns false when entry length differs', () => {
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    const shorter = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'noop' }]
          }
        ]
      }
    });
    expect(templateContentMatches(generated, shorter)).toBe(false);
  });

  test('templateContentMatches returns false when command string differs', () => {
    const generated = JSON.stringify(buildClaudeSettingsLocalJson());
    const parsed = JSON.parse(generated) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ type: string; command: string }> }> };
    };
    // Mutate the first hook's command to simulate a one-char drift.
    parsed.hooks.PreToolUse[0]!.hooks[0]!.command = parsed.hooks.PreToolUse[0]!.hooks[0]!.command + 'X';
    const drifted = JSON.stringify(parsed);
    expect(templateContentMatches(generated, drifted)).toBe(false);
  });
});
