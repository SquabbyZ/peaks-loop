import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../../packages/peaks-loop-internal-runtime/src/index', () => ({
  defaultRegistry: () => ({ list: () => [] }),
}));

import { doctorInvokeFromCode } from '../../../../src/cli/commands/doctor/invoke-from-code';
import { mkdtempSync, existsSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('peaks doctor invoke --from-code', () => {
  it('writes proposal.md under .peaks/_runtime/<sid>/doctor/', async () => {
    // Override cwd so we don't pollute the real .peaks
    const tmp = mkdtempSync(join(tmpdir(), 'doc-'));
    const orig = process.cwd();
    process.chdir(tmp);
    try {
      const sid = 's1';
      const out = await doctorInvokeFromCode({ sid, json: true });
      expect(out.ok).toBe(true);
      expect(out.data.proposalPath).toContain('/doctor/proposal.md');
      expect(existsSync(join(tmp, '.peaks', '_runtime', sid, 'doctor', 'proposal.md'))).toBe(true);
      const body = readFileSync(join(tmp, '.peaks', '_runtime', sid, 'doctor', 'proposal.md'), 'utf8');
      expect(body).toContain('doctor proposal');
    } finally {
      process.chdir(orig);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});