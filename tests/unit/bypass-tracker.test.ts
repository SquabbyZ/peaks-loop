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
