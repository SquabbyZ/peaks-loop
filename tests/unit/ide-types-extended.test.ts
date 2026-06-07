import { describe, expect, it } from 'vitest';
import { CLAUDE_CODE_ADAPTER } from '../../src/services/ide/adapters/claude-code-adapter.js';
import { TRAE_ADAPTER } from '../../src/services/ide/adapters/trae-adapter.js';
import { _setAdapterForTesting, getAdapter, _resetAdaptersForTesting } from '../../src/services/ide/ide-registry.js';

describe('IdeAdapter extended with subAgentDispatcher (G1 AC-2)', () => {
  it('claude-code adapter has subAgentDispatcher field', () => {
    // Slice #014: `subAgentToolMatcher` field is REMOVED from IdeAdapter
    // (the legacy progress-start hook entry is no longer installed; the
    // dispatch field's matcher is computed at dispatch time, not at
    // adapter-declaration time). The sub-agent dispatcher field itself
    // is preserved.
    expect(CLAUDE_CODE_ADAPTER.subAgentDispatcher).toBeDefined();
    expect(CLAUDE_CODE_ADAPTER.subAgentDispatcher.label).toBe('claude-code');
    expect(CLAUDE_CODE_ADAPTER.subAgentDispatcher.supportsRole('rd')).toBe(true);
  });

  it('trae adapter has subAgentDispatcher (UNVERIFIED placeholder)', () => {
    expect(TRAE_ADAPTER.subAgentDispatcher).toBeDefined();
    expect(TRAE_ADAPTER.subAgentDispatcher.label).toBe('trae');
  });

  it('custom test adapter can fill in any dispatcher', () => {
    const fakeDispatcher = {
      label: 'fake',
      supportsRole: (_: string) => false,
      buildToolCall: () => ({ name: 'X', args: {} })
    };
    _setAdapterForTesting('cursor', {
      ...CLAUDE_CODE_ADAPTER,
      id: 'cursor',
      subAgentDispatcher: fakeDispatcher
    });
    const adapter = getAdapter('cursor');
    expect(adapter.subAgentDispatcher.label).toBe('fake');
    expect(adapter.subAgentDispatcher.supportsRole('rd')).toBe(false);
    _resetAdaptersForTesting();
  });
});
