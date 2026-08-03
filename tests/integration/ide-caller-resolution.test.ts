// CONTRACT TEST — implementation pending; this test is the acceptance gate for slice 4.0.8 presence-lease-graph
// TC coverage: adapter contract per RD §5. Caller resolution must be adapter-owned and fail closed.
// Omitted render: adapter resolution returns IDs/errors, not a UI surface.

import { afterEach, describe, expect, it } from 'vitest';
import { getAdapter, _resetAdaptersForTesting } from '../../src/services/ide/ide-registry.js';
import type { IdeId, IdeAdapter } from '../../src/services/ide/ide-types.js';

afterEach(() => { _resetAdaptersForTesting(); });

const IDE_ENV: Readonly<Record<IdeId, string | undefined>> = {
  'claude-code': 'CLAUDE_CODE_SESSION_ID',
  trae: 'TRAE_SESSION_ID',
  cursor: undefined,
  codex: undefined,
  hermes: undefined,
  openclaw: undefined,
  qoder: undefined,
  'tongyi-lingma': undefined,
  zcode: undefined,
};

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function resolver(adapter: IdeAdapter): (env?: NodeJS.ProcessEnv) => string {
  return (adapter as unknown as { resolveCallerId?: (env?: NodeJS.ProcessEnv) => string }).resolveCallerId ?? (() => { const error = new Error('missing resolver') as Error & { code: string }; error.code = 'PEAKS_CALLER_NOT_RESOLVED'; throw error; });
}

describe('IDE caller resolution adapter contract', () => {
  for (const ide of Object.keys(IDE_ENV) as IdeId[]) {
    it(`${ide}: resolveCallerId uses only its adapter-owned signal or fails closed. RD §5. Pass criterion: valid signal returns a non-empty ID; absent signal throws PEAKS_CALLER_NOT_RESOLVED.`, () => {
      const resolveCallerId = resolver(getAdapter(ide));
      const envName = IDE_ENV[ide];
      if (envName) expect(resolveCallerId({ [envName]: `${ide}-caller` })).toBe(`${ide}-caller`);
      try { resolveCallerId({}); throw new Error('expected caller resolution failure'); }
      catch (error: unknown) { expect(codeOf(error)).toBe('PEAKS_CALLER_NOT_RESOLVED'); }
    });
  }

  it('vendor-neutral PEAKS_CALLER_ID override is trimmed and validated by the active adapter. RD §5. Pass criterion: assert.equal(resolveCallerId({ PEAKS_CALLER_ID: "  override-id  " }), "override-id").', () => {
    expect(resolver(getAdapter('claude-code'))({ PEAKS_CALLER_ID: '  override-id  ' })).toBe('override-id');
  });
});

export {};