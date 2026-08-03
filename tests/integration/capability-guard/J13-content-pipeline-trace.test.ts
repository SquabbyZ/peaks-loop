import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runJ13Contract } from '~/src/services/capability-guard-runner/contracts/J13';

const REPO = resolve(__dirname, '..', '..', '..');

describe('J13 content-pipeline-trace contract', () => {
  it('keeps a content surface that references at least 3 of the 5 stages', async () => {
    const r = await runJ13Contract({ projectRoot: REPO, sessionId: 'J13', contract: {} as any, baselineInvariant: 'J13#1' });
    expect(r.status).toBe('pass');
  });
});