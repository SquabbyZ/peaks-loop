import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ08Contract } from '~/src/services/capability-guard-runner/contracts/J08';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J08 asset-roundtrip contract', () => {
  it('keeps the crystallization service with sediment/promotion references', async () => {
    const r = await runJ08Contract({ projectRoot: REPO, sessionId: 'J08', contract: {} as any, baselineInvariant: 'J08#1' });
    expect(r.status).toBe('pass');
  });
});