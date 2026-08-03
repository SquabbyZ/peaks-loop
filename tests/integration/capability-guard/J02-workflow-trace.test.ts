import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runJ02Contract } from '~/src/services/capability-guard-runner/contracts/J02';

const REPO = join(__dirname, '..', '..', '..');
let proj = '';
afterEach(() => { if (proj) rmSync(proj, { recursive: true, force: true }); proj = ''; });

describe('J02 workflow-trace contract', () => {
  it('walks the RD state machine in 4 transitions', async () => {
    proj = mkdtempSync(join(tmpdir(), 'cbl-J02-'));
    const r = await runJ02Contract({ projectRoot: REPO, sessionId: 'J02', contract: {} as any, baselineInvariant: 'J02#1' }, proj);
    expect(r.status).toBe('pass');
  });
});
