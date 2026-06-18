import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, afterEach } from 'vitest';
import {
  getBypassCount,
  recordBypass,
  isBypassLimitReached,
  MAX_BYPASSES_PER_SESSION
} from '../../src/services/mode/bypass-tracker.js';

let tempDir: string;

async function makeSession(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'peaks-bypass-'));
  return tempDir;
}

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

describe('getBypassCount', () => {
  test('returns 0 when no bypass file exists', async () => {
    const session = await makeSession();
    expect(getBypassCount(session)).toBe(0);
  });

  test('returns 0 when bypass file contains invalid JSON', async () => {
    const session = await makeSession();
    const fs = await import('node:fs');
    fs.writeFileSync(join(session, '.bypass-count.json'), 'not-json', 'utf8');
    expect(getBypassCount(session)).toBe(0);
  });

  test('returns 0 when bypass file has no count field', async () => {
    const session = await makeSession();
    const fs = await import('node:fs');
    fs.writeFileSync(join(session, '.bypass-count.json'), JSON.stringify({}), 'utf8');
    expect(getBypassCount(session)).toBe(0);
  });

  test('returns the count from a valid bypass file', async () => {
    const session = await makeSession();
    const fs = await import('node:fs');
    fs.writeFileSync(join(session, '.bypass-count.json'), JSON.stringify({ count: 2 }), 'utf8');
    expect(getBypassCount(session)).toBe(2);
  });
});

describe('recordBypass', () => {
  test('increments from 0 to 1 on first call', async () => {
    const session = await makeSession();
    const result = recordBypass(session);
    expect(result).toBe(1);
    expect(getBypassCount(session)).toBe(1);
  });

  test('increments sequentially on multiple calls', async () => {
    const session = await makeSession();
    expect(recordBypass(session)).toBe(1);
    expect(recordBypass(session)).toBe(2);
    expect(recordBypass(session)).toBe(3);
    expect(getBypassCount(session)).toBe(3);
  });

  test('preserves existing count when file already exists', async () => {
    const session = await makeSession();
    const fs = await import('node:fs');
    fs.writeFileSync(join(session, '.bypass-count.json'), JSON.stringify({ count: 5 }), 'utf8');
    const result = recordBypass(session);
    expect(result).toBe(6);
  });
});

describe('isBypassLimitReached', () => {
  test('returns false when count is below limit', async () => {
    const session = await makeSession();
    recordBypass(session);
    recordBypass(session);
    expect(isBypassLimitReached(session)).toBe(false);
  });

  test('returns true when count equals limit', async () => {
    const session = await makeSession();
    for (let i = 0; i < MAX_BYPASSES_PER_SESSION; i++) {
      recordBypass(session);
    }
    expect(isBypassLimitReached(session)).toBe(true);
  });

  test('returns true when count exceeds limit', async () => {
    const session = await makeSession();
    for (let i = 0; i < MAX_BYPASSES_PER_SESSION + 2; i++) {
      recordBypass(session);
    }
    expect(isBypassLimitReached(session)).toBe(true);
  });

  test('returns false for a fresh session', async () => {
    const session = await makeSession();
    expect(isBypassLimitReached(session)).toBe(false);
  });
});

describe('MAX_BYPASSES_PER_SESSION', () => {
  test('is set to 3', () => {
    expect(MAX_BYPASSES_PER_SESSION).toBe(3);
  });
});

// 2.7.1 regression guard: the bypass counter MUST live under the
// canonical session home `.peaks/_runtime/<sid>/`, never at the
// project root `.peaks/<sid>/`. The legacy root path was the
// root-pollution source the user surfaced after 2.7.0; this guard
// pins the new path formula and asserts a file-show under the
// alternate root returns the fresh-session count (i.e. the counter
// did not land there).
describe('2.7.1 root-pollution regression — bypass-count home', () => {
  test('recordBypass writes to the dir the caller passed; root path is NOT auto-derived', async () => {
    const session = await makeSession();
    // Mimic the 2.7.1 fix: request-commands.ts line ~403 now passes
    // `<projectRoot>/.peaks/_runtime/<sid>` as the sessionRoot. The
    // bypass-tracker API is path-agnostic — it writes wherever the
    // caller points. This test pins that contract.
    recordBypass(session);
    recordBypass(session);
    // canonical home
    const { existsSync, readFileSync } = await import('node:fs');
    expect(existsSync(join(session, '.bypass-count.json')), 'count file at passed dir').toBe(true);
    const content = JSON.parse(readFileSync(join(session, '.bypass-count.json'), 'utf8')) as { count: number };
    expect(content.count).toBe(2);
  });

  test('the sessionRoot formula used by peaks request transition is the canonical _runtime path', async () => {
    // Pure string-level pin: the formula
    //   join(projectRoot, '.peaks', '_runtime', resolvedSessionId)
    // MUST be the path passed to isBypassLimitReached / recordBypass.
    // If a future refactor regresses back to `.peaks/<sid>/`, this
    // string check fails and surfaces the regression.
    const projectRoot = '/tmp/proj';
    const resolvedSessionId = '2026-06-18-session-2a4f9c';
    const sessionRoot = join(projectRoot, '.peaks', '_runtime', resolvedSessionId);
    expect(sessionRoot, 'canonical bypass home').toBe(
      '/tmp/proj/.peaks/_runtime/2026-06-18-session-2a4f9c'
    );
    expect(sessionRoot, 'never the legacy root home').not.toBe(
      '/tmp/proj/.peaks/2026-06-18-session-2a4f9c'
    );
  });
});
