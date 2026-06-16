/**
 * Slice 003-2026-06-16-hook-governance — output helper unit tests.
 *
 * The hook output contract (see .claude/HOOKS.md) requires:
 *   - emitHint(text):     writes text to stderr (hint = diagnostic, never to stdout);
 *                         does NOT set a non-zero exit code. Hints must not affect
 *                         the host's permission decision.
 *   - emitBlock(reason):  writes the Claude-Code-shaped deny JSON to stdout
 *                         AND sets process.exitCode = 2; the host treats exit-2
 *                         + stderr as a hard block. The reason is also surfaced
 *                         to stderr so the LLM/operator can see it.
 *   - emitDecision(decision): writes the IDE-shaped JSON to stdout, exit 0.
 *                         `decision` is the canonical decision object that the
 *                         adapter's `formatDecisionResponse` produces.
 *
 * These tests run on darwin/linux/win32 via the cross-platform contract test
 * (tests/unit/hooks/contract.test.ts); this file focuses on the helper
 * semantics independent of platform.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { emitBlock, emitDecision, emitHint } from '../../../src/services/hooks/output.js';

const STDOUT: string[] = [];
const STDERR: string[] = [];
const IO = {
  stdout: (text: string) => STDOUT.push(text),
  stderr: (text: string) => STDERR.push(text)
};

function clearBuffers(): void {
  STDOUT.length = 0;
  STDERR.length = 0;
}

const ORIGINAL_PLATFORM = process.platform;
const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => {
  clearBuffers();
  process.exitCode = undefined;
  // Use darwin by default; the contract test overrides this per platform.
  Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM, configurable: true });
  process.exitCode = ORIGINAL_EXIT_CODE;
  vi.restoreAllMocks();
});

describe('emitHint', () => {
  test('writes text to stderr (never stdout)', () => {
    emitHint(IO, 'peaks hint: try `peaks gate bypass --sop X --phase Y --reason "..."`');
    expect(STDOUT.join('')).toBe('');
    expect(STDERR.join('')).toContain('peaks hint: try');
  });

  test('does not set a non-zero exit code (hint is not a block)', () => {
    emitHint(IO, 'a warning');
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  test('empty hint is a no-op (does not pollute stderr)', () => {
    emitHint(IO, '');
    expect(STDERR.join('')).toBe('');
  });

  test('newline-terminates its line so the host CLI does not glue the next emission onto it', () => {
    emitHint(IO, 'first');
    emitHint(IO, 'second');
    const combined = STDERR.join('');
    expect(combined).toContain('first');
    expect(combined).toContain('second');
    expect(combined).toMatch(/first\n/);
    expect(combined).toMatch(/second\n/);
  });
});

describe('emitBlock', () => {
  test('writes the canonical deny JSON to stdout', () => {
    const result = emitBlock(IO, 'Blocked by Peaks gate: SOP "x" phase "publish": no-todo=fail');
    expect(result.stdout).toContain('"permissionDecision":"deny"');
    expect(result.stdout).toContain('"hookEventName":"PreToolUse"');
    expect(STDOUT.join('')).toBe(result.stdout + '\n');
  });

  test('sets process.exitCode to 2 (the Claude Code block exit code)', () => {
    emitBlock(IO, 'reason');
    expect(process.exitCode).toBe(2);
  });

  test('surfaces the reason to stderr so the LLM/operator can see it', () => {
    emitBlock(IO, 'visible reason text');
    expect(STDERR.join('')).toContain('visible reason text');
  });

  test('escapes double quotes inside the reason so the deny JSON stays valid', () => {
    const reason = 'Oops: "git push" was blocked by peaks';
    const result = emitBlock(IO, reason);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(reason);
  });

  test('escapes backslashes and newlines inside the reason (JSON.stringify is the canonical escape)', () => {
    const reason = 'line1\nline2 \\ backslash';
    const result = emitBlock(IO, reason);
    expect(() => JSON.parse(result.stdout)).not.toThrow();
    const parsed = JSON.parse(result.stdout) as { hookSpecificOutput: { permissionDecisionReason: string } };
    expect(parsed.hookSpecificOutput.permissionDecisionReason).toBe(reason);
  });
});

describe('emitDecision', () => {
  test('writes the decision JSON to stdout and returns the emitted string', () => {
    const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } };
    const result = emitDecision(IO, decision);
    expect(result).toBe(JSON.stringify(decision));
    expect(STDOUT.join('')).toBe(result + '\n');
  });

  test('does not set a non-zero exit code (decision is the allow/deny signal; the host reads stdout)', () => {
    const decision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } };
    emitDecision(IO, decision);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
  });

  test('preserves the IDE-specific hookEventName (claude-code vs trae)', () => {
    const claudeDecision = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } };
    const traeDecision = { hookSpecificOutput: { hookEventName: 'beforeToolCall', permissionDecision: 'deny', permissionDecisionReason: 'r' } };
    const claudeResult = emitDecision(IO, claudeDecision);
    const traeResult = emitDecision(IO, traeDecision);
    expect(claudeResult).toContain('"hookEventName":"PreToolUse"');
    expect(traeResult).toContain('"hookEventName":"beforeToolCall"');
  });
});
