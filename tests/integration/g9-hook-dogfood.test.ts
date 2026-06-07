/**
 * G9.5 — PreToolUse hook execution test.
 *
 * The hook layer (peaks sub-agent-dispatch-guard) is the strictest layer
 * in the G9 chain (RL-30). It MUST:
 *  - Re-validate prompt size against the threshold table
 *  - Return allow: false for >= 80% prompts
 *  - NOT honor any --force flag (the CLI doesn't even expose one)
 *  - Return allow: true for < 75% prompts with CONTEXT_NEAR_LIMIT warning
 *
 * These tests exercise the in-process `evaluateHookGuard()` function and
 * `readPromptSizeFromHookStdin()` helper. The CLI integration is
 * exercised by the slice #010 dogfood.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateHookGuard,
  HOOK_GUARD_RESULT_TYPE
} from '../../src/cli/commands/sub-agent-dispatch-guard.js';
import { readPromptSizeFromHookStdin } from '../../src/hooks/pre-tool-use-sub-agent.js';

describe('G9.5 evaluateHookGuard (RL-30 strict)', () => {
  it('prompt < 50% => allow: true, code OK', () => {
    const r = evaluateHookGuard(50_000);
    expect(r.allow).toBe(true);
    expect(r.code).toBe('OK');
    expect(r.tier).toBe('ok');
    expect(r.warnings).toEqual([]);
  });

  it('prompt 50-75% => allow: true, code CONTEXT_SOFT_WARN', () => {
    const r = evaluateHookGuard(150 * 1024);
    expect(r.allow).toBe(true);
    expect(r.code).toBe('CONTEXT_SOFT_WARN');
  });

  it('prompt 75-80% => allow: true, code CONTEXT_NEAR_LIMIT (soft warn, NOT reject)', () => {
    const r = evaluateHookGuard(200 * 1024);
    expect(r.allow).toBe(true);
    expect(r.code).toBe('CONTEXT_NEAR_LIMIT');
    expect(r.warnings).toContain('CONTEXT_NEAR_LIMIT');
  });

  it('prompt >= 80% => allow: false, code PROMPT_TOO_LARGE', () => {
    const r = evaluateHookGuard(210 * 1024);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('PROMPT_TOO_LARGE');
    expect(r.reason).toMatch(/exceeds threshold/);
    expect(r.suggest).toMatch(/Trim prompt|--force/);
  });

  it('prompt >= 90% => allow: false, code PROMPT_EMERGENCY', () => {
    const r = evaluateHookGuard(240 * 1024);
    expect(r.allow).toBe(false);
    expect(r.code).toBe('PROMPT_EMERGENCY');
  });

  it('result has correct schema version', () => {
    const r = evaluateHookGuard(50_000);
    expect(r.schema).toBe(HOOK_GUARD_RESULT_TYPE);
  });

  it('result has ratio + bytesUsed + capacityBytes', () => {
    const r = evaluateHookGuard(128 * 1024);
    expect(r.ratio).toBeCloseTo(0.5, 3);
    expect(r.bytesUsed).toBe(128 * 1024);
    expect(r.capacityBytes).toBe(256 * 1024);
  });
});

describe('G9.5 readPromptSizeFromHookStdin', () => {
  it('reads command field (Claude Code shape)', () => {
    const stdin = { tool_name: 'Bash', tool_input: { command: 'echo hello' } };
    expect(readPromptSizeFromHookStdin(stdin)).toBe(Buffer.byteLength('echo hello', 'utf8'));
  });

  it('reads prompt field (Trae / generic shape)', () => {
    const stdin = { tool_name: 'sub-agent', tool_input: { prompt: 'do thing' } };
    expect(readPromptSizeFromHookStdin(stdin)).toBe(Buffer.byteLength('do thing', 'utf8'));
  });

  it('returns 0 on null/non-object stdin', () => {
    expect(readPromptSizeFromHookStdin(null)).toBe(0);
    expect(readPromptSizeFromHookStdin('string')).toBe(0);
    expect(readPromptSizeFromHookStdin(undefined)).toBe(0);
  });

  it('returns 0 on object with no toolInput', () => {
    expect(readPromptSizeFromHookStdin({})).toBe(0);
    expect(readPromptSizeFromHookStdin({ tool_name: 'X' })).toBe(0);
  });

  it('returns 0 on toolInput with no command/prompt/text/input field', () => {
    expect(readPromptSizeFromHookStdin({ tool_input: { unrelated: 'x' } })).toBe(0);
  });

  it('counts bytes (UTF-8 multibyte chars take > 1 byte)', () => {
    const stdin = { tool_input: { command: '中文' } };
    expect(readPromptSizeFromHookStdin(stdin)).toBe(6); // 3 bytes per Chinese char
  });
});

describe('G9.5 hook strictness: NO --force equivalent (RL-30)', () => {
  it('evaluateHookGuard ignores any force-like override (no parameter for it)', () => {
    // The function signature is evaluateHookGuard(promptSize: number) — there is
    // NO `force` parameter exposed at the hook layer. This is enforced at
    // compile-time by the function signature.
    const r1 = evaluateHookGuard(210 * 1024);
    expect(r1.allow).toBe(false);
    // Even if a caller tried to call with `force: true` (TypeScript would
    // reject it), the function body has no override path. The CLI atom
    // that wraps this function does not declare a --force flag either.
    expect(typeof r1.allow).toBe('boolean');
  });
});
