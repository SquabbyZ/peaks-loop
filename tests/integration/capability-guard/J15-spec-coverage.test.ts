import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ15Contract } from '~/src/services/capability-guard-runner/contracts/J15';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J15 spec-coverage contract', () => {
  it('keeps the openspec archive service with Capability Mapping + coverage cross-check', async () => {
    const r = await runJ15Contract({ projectRoot: REPO, sessionId: 'J15', contract: {} as any, baselineInvariant: 'J15#1' });
    expect(r.status).toBe('pass');
  });
});