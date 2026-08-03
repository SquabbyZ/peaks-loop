import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ09Contract } from '~/src/services/capability-guard-runner/contracts/J09';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J09 sop-register contract', () => {
  it('keeps the SOP service with gate-validation fragments', async () => {
    const r = await runJ09Contract({ projectRoot: REPO, sessionId: 'J09', contract: {} as any, baselineInvariant: 'J09#1' });
    expect(r.status).toBe('pass');
  });
});