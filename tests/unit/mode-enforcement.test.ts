import { describe, expect, test, vi, beforeEach } from 'vitest';

vi.mock('../../src/services/skills/skill-presence-service.js', () => ({
  getSkillPresence: vi.fn()
}));

const mockReadlineQuestion = vi.fn();
vi.mock('node:readline', () => ({
  createInterface: () => ({
    question: mockReadlineQuestion,
    close: vi.fn()
  })
}));

import { getSkillPresence } from '../../src/services/skills/skill-presence-service.js';
import {
  requiresConfirmation,
  requireUserConfirmation,
  ConfirmationRequiredError
} from '../../src/services/mode/mode-enforcement.js';
const mockedGetSkillPresence = vi.mocked(getSkillPresence);

describe('requiresConfirmation', () => {
  test('returns false for full-auto mode on any transition', () => {
    expect(requiresConfirmation('full-auto', 'prd:confirmed-by-user')).toBe(false);
    expect(requiresConfirmation('full-auto', 'rd:qa-handoff')).toBe(false);
    expect(requiresConfirmation('full-auto', 'qa:verdict-issued')).toBe(false);
    expect(requiresConfirmation('full-auto', 'rd:implemented')).toBe(false);
  });

  test('returns false for swarm mode on any transition', () => {
    expect(requiresConfirmation('swarm', 'prd:confirmed-by-user')).toBe(false);
    expect(requiresConfirmation('swarm', 'rd:qa-handoff')).toBe(false);
    expect(requiresConfirmation('swarm', 'qa:verdict-issued')).toBe(false);
  });

  test('returns true for strict mode on any transition', () => {
    expect(requiresConfirmation('strict', 'prd:confirmed-by-user')).toBe(true);
    expect(requiresConfirmation('strict', 'rd:qa-handoff')).toBe(true);
    expect(requiresConfirmation('strict', 'qa:verdict-issued')).toBe(true);
    expect(requiresConfirmation('strict', 'rd:implemented')).toBe(true);
    expect(requiresConfirmation('strict', 'ui:direction-locked')).toBe(true);
  });

  test('returns true for assisted mode on key transitions', () => {
    expect(requiresConfirmation('assisted', 'prd:confirmed-by-user')).toBe(true);
    expect(requiresConfirmation('assisted', 'rd:qa-handoff')).toBe(true);
    expect(requiresConfirmation('assisted', 'qa:verdict-issued')).toBe(true);
  });

  test('returns false for assisted mode on non-key transitions', () => {
    expect(requiresConfirmation('assisted', 'rd:implemented')).toBe(false);
    expect(requiresConfirmation('assisted', 'rd:blocked')).toBe(false);
    expect(requiresConfirmation('assisted', 'ui:direction-locked')).toBe(false);
    expect(requiresConfirmation('assisted', 'sc:impact-recorded')).toBe(false);
  });
});

describe('ConfirmationRequiredError', () => {
  test('includes transition description in message', () => {
    const error = new ConfirmationRequiredError('prd:confirmed-by-user');
    expect(error.message).toContain('PRD');
    expect(error.message).toContain('confirmed-by-user');
    expect(error.name).toBe('ConfirmationRequiredError');
  });

  test('is an instance of Error', () => {
    const error = new ConfirmationRequiredError('rd:qa-handoff');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
  });
});

describe('requireUserConfirmation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockReadlineQuestion.mockReset();
    delete process.env.PEAKS_AUTO_CONFIRM;
  });

  test('returns immediately when no skill presence is set', async () => {
    mockedGetSkillPresence.mockReturnValue(null);

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user'
      })
    ).resolves.toBeUndefined();
  });

  test('returns immediately when mode is not set', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo' } as never);

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user'
      })
    ).resolves.toBeUndefined();
  });

  test('returns immediately for full-auto mode', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'full-auto', setAt: '2026-05-28T00:00:00Z' });

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user'
      })
    ).resolves.toBeUndefined();
  });

  test('returns immediately when --confirm flag is passed', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' });

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user',
        confirmed: true
      })
    ).resolves.toBeUndefined();
  });

  test('throws ConfirmationRequiredError in assisted mode without confirmation', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' });
    // Simulate user declining the prompt
    mockReadlineQuestion.mockImplementation((_prompt: string, cb: (answer: string) => void) => cb('n'));

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user'
      })
    ).rejects.toThrow(ConfirmationRequiredError);
  });

  test('throws ConfirmationRequiredError in strict mode with PEAKS_AUTO_CONFIRM without --force-confirm', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'strict', setAt: '2026-05-28T00:00:00Z' });
    process.env.PEAKS_AUTO_CONFIRM = '1';

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'rd:qa-handoff'
      })
    ).rejects.toThrow(ConfirmationRequiredError);
  });

  test('returns in assisted mode with PEAKS_AUTO_CONFIRM and --force-confirm', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' });
    process.env.PEAKS_AUTO_CONFIRM = '1';
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'prd:confirmed-by-user',
        forceConfirm: true
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('--force-confirm used in assisted mode')
    );
  });

  test('returns in strict mode with --force-confirm (no env var)', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'strict', setAt: '2026-05-28T00:00:00Z' });
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'rd:qa-handoff',
        forceConfirm: true
      })
    ).resolves.toBeUndefined();

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('--force-confirm used in strict mode')
    );
  });

  test('returns in assisted mode for non-key transitions without confirmation', async () => {
    mockedGetSkillPresence.mockReturnValue({ skill: 'peaks-solo', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' });

    await expect(
      requireUserConfirmation({
        projectRoot: '/tmp',
        transitionKey: 'rd:implemented'
      })
    ).resolves.toBeUndefined();
  });
});
