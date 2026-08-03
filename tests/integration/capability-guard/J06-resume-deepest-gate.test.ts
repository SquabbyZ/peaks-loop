import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ06Contract } from '~/src/services/capability-guard-runner/contracts/J06';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J06 resume-deepest-gate contract', () => {
  it('keeps a resume service that references deepestGate', async () => {
    const r = await runJ06Contract({ projectRoot: REPO, sessionId: 'J06', contract: {} as any, baselineInvariant: 'J06#1' });
    expect(r.status).toBe('pass');
  });
});
