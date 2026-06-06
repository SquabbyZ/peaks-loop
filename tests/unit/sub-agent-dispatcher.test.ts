import { describe, expect, it } from 'vitest';
import {
  claudeCodeSubAgentDispatcher,
  nullSubAgentDispatcher,
  SubAgentNotSupportedError,
  traeSubAgentDispatcher
} from '../../src/services/dispatch/sub-agent-dispatcher.js';

describe('claudeCodeSubAgentDispatcher (G1 AC-3)', () => {
  it('supportsRole returns true for any non-empty role', () => {
    expect(claudeCodeSubAgentDispatcher.supportsRole('rd')).toBe(true);
    expect(claudeCodeSubAgentDispatcher.supportsRole('qa')).toBe(true);
    expect(claudeCodeSubAgentDispatcher.supportsRole('qa-business-api')).toBe(true);
    expect(claudeCodeSubAgentDispatcher.supportsRole('prd-ux')).toBe(true);
    expect(claudeCodeSubAgentDispatcher.supportsRole('')).toBe(false);
  });

  it('buildToolCall returns the exact Task-tool shape', () => {
    const toolCall = claudeCodeSubAgentDispatcher.buildToolCall({
      role: 'rd',
      prompt: 'plan the slice',
      requestId: '002-2026-06-07',
      sessionId: '2026-06-06-session-5b1095'
    });
    expect(toolCall.name).toBe('Task');
    expect(toolCall.args).toEqual({
      subagent_type: 'general-purpose',
      description: 'rd for rid=002-2026-06-07',
      prompt: 'plan the slice'
    });
  });

  it('buildToolCall embeds the role verbatim in description', () => {
    const tc = claudeCodeSubAgentDispatcher.buildToolCall({
      role: 'qa-business-api',
      prompt: '...',
      requestId: 'rid-1',
      sessionId: 'sid-1'
    });
    expect(tc.args).toMatchObject({ description: 'qa-business-api for rid=rid-1' });
  });
});

describe('traeSubAgentDispatcher (G1 AC-4)', () => {
  it('is byte-level identical to claude-code by design', () => {
    const input = {
      role: 'qa-business',
      prompt: 'test the API',
      requestId: 'rid-2',
      sessionId: 'sid-2'
    };
    const claudeTc = claudeCodeSubAgentDispatcher.buildToolCall(input);
    const traeTc = traeSubAgentDispatcher.buildToolCall(input);
    expect(traeTc).toEqual(claudeTc);
  });

  it('label is "trae"', () => {
    expect(traeSubAgentDispatcher.label).toBe('trae');
  });
});

describe('nullSubAgentDispatcher (G1 AC-5)', () => {
  it('supportsRole is always false', () => {
    expect(nullSubAgentDispatcher.supportsRole('rd')).toBe(false);
    expect(nullSubAgentDispatcher.supportsRole('')).toBe(false);
    expect(nullSubAgentDispatcher.supportsRole('any')).toBe(false);
  });

  it('buildToolCall throws SubAgentNotSupportedError with code IDE_NOT_SUPPORTED', () => {
    expect(() => nullSubAgentDispatcher.buildToolCall({
      role: 'rd',
      prompt: '...',
      requestId: 'r',
      sessionId: 's'
    })).toThrow(SubAgentNotSupportedError);
    try {
      nullSubAgentDispatcher.buildToolCall({ role: 'rd', prompt: 'x', requestId: 'r', sessionId: 's' });
    } catch (e: unknown) {
      const err = e as SubAgentNotSupportedError;
      expect(err.code).toBe('IDE_NOT_SUPPORTED');
      expect(err.role).toBe('rd');
    }
  });
});
