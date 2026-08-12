import { afterEach, describe, expect, it } from 'vitest';

import { parseCatchGateReply } from '../../../src/cli/commands/best-practice-scan-command.js';

const SAVED_ENV = process.env.PEAKS_BEST_PRACTICE_STDIN;

afterEach(() => {
  if (SAVED_ENV === undefined) {
    delete process.env.PEAKS_BEST_PRACTICE_STDIN;
  } else {
    process.env.PEAKS_BEST_PRACTICE_STDIN = SAVED_ENV;
  }
});

describe('parseCatchGateReply', () => {
  it('empty input → accept the LLM recommendation', () => {
    const outcome = parseCatchGateReply('', 'A');
    expect(outcome.kind).toBe('accept');
    if (outcome.kind === 'accept') {
      expect(outcome.choice).toBe('A');
    }
  });

  it('accepts an alternative choice (接受方案 B) with reason captured', () => {
    const outcome = parseCatchGateReply('接受方案 B  我的项目 2 周上线', 'A');
    expect(outcome.kind).toBe('alternative');
    if (outcome.kind === 'alternative') {
      expect(outcome.choice).toBe('B');
      expect(outcome.reason).toContain('2 周上线');
    }
  });

  it('accepts an alternative choice without reason', () => {
    const outcome = parseCatchGateReply('接受方案 C', 'A');
    expect(outcome.kind).toBe('alternative');
    if (outcome.kind === 'alternative') {
      expect(outcome.choice).toBe('C');
    }
  });

  it('rejects + reason → re-runs with user context', () => {
    const outcome = parseCatchGateReply('拒绝 我的项目 2 周上线所以选 1', 'B');
    expect(outcome.kind).toBe('reject');
    if (outcome.kind === 'reject') {
      expect(outcome.reason).toContain('2 周上线');
    }
  });

  it('plain "接受" is accepted as default accept', () => {
    const outcome = parseCatchGateReply('接受', 'C');
    expect(outcome.kind).toBe('accept');
    if (outcome.kind === 'accept') {
      expect(outcome.choice).toBe('C');
    }
  });

  it('rejects empty reject (no reason) gracefully', () => {
    const outcome = parseCatchGateReply('拒绝', 'A');
    expect(outcome.kind).toBe('reject');
    if (outcome.kind === 'reject') {
      expect(outcome.reason).toBe('unspecified');
    }
  });

  it('unknown reply is treated as reject-with-reason (raw text becomes the reason)', () => {
    const outcome = parseCatchGateReply('我想用方案 A 因为简单', 'B');
    expect(outcome.kind).toBe('reject');
    if (outcome.kind === 'reject') {
      expect(outcome.reason).toContain('方案 A');
    }
  });

  it('whitespace-only input is treated as accept (default path)', () => {
    const outcome = parseCatchGateReply('   \n  ', 'A');
    expect(outcome.kind).toBe('accept');
  });
});