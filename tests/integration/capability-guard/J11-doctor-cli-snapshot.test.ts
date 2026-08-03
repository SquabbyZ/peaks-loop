import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ11Contract } from '~/src/services/capability-guard-runner/contracts/J11';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J11 doctor-cli-snapshot contract', () => {
  it('keeps the doctor + audit + openspec chain', async () => {
    const r = await runJ11Contract({ projectRoot: REPO, sessionId: 'J11', contract: {} as any, baselineInvariant: 'J11#1' });
    expect(r.status).toBe('pass');
  });
});