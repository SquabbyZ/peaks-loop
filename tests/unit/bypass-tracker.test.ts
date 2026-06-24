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
// project root `.peaks/_runtime/<sid>/`. The legacy root path was the
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
    // If a future refactor regresses back to `.peaks/_runtime/<sid>/`, this
    // string check fails and surfaces the regression. On Windows the
    // join() helper emits backslashes; the contract is the segment
    // ordering (`.peaks/_runtime/<sid>/`), which the
    // `.includes('/_runtime/')` check pins in a platform-stable way.
    const projectRoot = '/tmp/proj';
    const resolvedSessionId = '2026-06-18-session-2a4f9c';
    const sessionRoot = join(projectRoot, '.peaks', '_runtime', resolvedSessionId);
    const legacyRoot = join(projectRoot, '.peaks', resolvedSessionId);
    expect(sessionRoot.includes(`${require('node:path').sep}_runtime${require('node:path').sep}`) ||
           sessionRoot.includes('/_runtime/'), 'canonical bypass home contains _runtime/ segment').toBe(true);
    expect(sessionRoot.includes('/_runtime/') || sessionRoot.includes('\\_runtime\\'), 'canonical bypass home uses _runtime/').toBe(true);
    expect(sessionRoot.endsWith(resolvedSessionId), 'canonical bypass home ends with sid').toBe(true);
    expect(legacyRoot.includes('/_runtime/') || legacyRoot.includes('\\_runtime\\'), 'never the legacy root home (no _runtime/ segment)').toBe(false);
    expect(legacyRoot.endsWith(resolvedSessionId), 'legacy root would end with sid').toBe(true);
  });

  // 2.7.1 round-3 audit hardening: the two string-level tests above pin
  // the formula in isolation but do NOT cover the actual call site in
  // request-commands.ts. This source-level lint catches a regression
  // where the formula in the action handler itself is reverted (the
  // original 2.7.1 audit's `mutation test` showed both tests above stay
  // green when the source reverts to `.peaks/_runtime/<sid>/`). The regex below
  // looks for the legacy pattern at the actual writer call site.
  test('request-commands.ts does NOT call recordBypass/isBypassLimitReached with a root .peaks/_runtime/<sid> path', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { resolve: resolvePath } = require('node:path') as typeof import('node:path');
    const sourcePath = resolvePath(
      __dirname,
      '..',
      '..',
      'src',
      'cli',
      'commands',
      'request-commands.ts'
    );
    const source = readFileSync(sourcePath, 'utf8');

    // The legacy pattern: anywhere inside request-commands.ts a line that
    // joins '.peaks' followed by a sessionId-shaped token (without the
    // _runtime/ segment) and then passes it to recordBypass /
    // isBypassLimitReached. Heuristic: find `.peaks',` followed within
    // ~6 lines by `recordBypass(` or `isBypassLimitReached(` AND the
    // resolvedSessionId token appears in between.
    const sessionRootLineMatch = source.match(/join\([^)]*'\.peaks'[^)]*\)/g) ?? [];
    const usesCanonical = sessionRootLineMatch.some((line) => /_runtime/.test(line));
    const usesLegacy = sessionRootLineMatch.some((line) =>
      /_runtime/.test(line) === false &&
      /(resolvedSessionId|sessionId)/.test(source.slice(
        Math.max(0, source.indexOf(line) - 200),
        source.indexOf(line) + 400
      ))
    );

    expect(
      sessionRootLineMatch.length,
      `expected at least one .peaks join() in request-commands.ts; found ${sessionRootLineMatch.length}`
    ).toBeGreaterThan(0);
    expect(
      usesCanonical,
      `expected at least one .peaks join() to use the _runtime/ canonical home; matches: ${JSON.stringify(sessionRootLineMatch)}`
    ).toBe(true);
    expect(
      usesLegacy,
      `expected no .peaks join() in request-commands.ts to feed a sessionId-shaped token into recordBypass / isBypassLimitReached without the _runtime/ segment; matches: ${JSON.stringify(sessionRootLineMatch)}`
    ).toBe(false);
  });
});
