// tests/unit/release/version-precheck-quote-tolerance.test.ts
//
// rid 2026-10-03-release-gate-quote-brittle. `runRootVsShared` (precheck Layer A,
// the local mirror of publish.yml §(A)) extracted CLI_VERSION with a
// double-quote-only regex — the exact brittleness that made CI refuse the 4.1.0
// publish after prettier pass cf21d188 flipped version.ts to single quotes.
// These arms pin BOTH directions: quote-tolerant (equal value passes in either
// quote style) and NOT version-tolerant (a drifted value fails with the drift
// message in either quote style, a missing file fails with the missing-artifact
// message, an unparseable file fails with the parse message).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runRootVsShared } from '~/src/services/release/version-precheck-service';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-precheck-quote-'));
  mkdirSync(join(root, 'packages', 'peaks-loop-shared', 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'x', version: '4.1.0' }));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const writeDist = (body: string): void => {
  writeFileSync(join(root, 'packages', 'peaks-loop-shared', 'dist', 'version.js'), body);
};

describe('precheck Layer A — quote tolerance without version tolerance', () => {
  it('single-quoted CLI_VERSION equal to root → ok (the prettier cf21d188 shape)', () => {
    writeDist("export const CLI_VERSION = '4.1.0';\n");
    const r = runRootVsShared({ projectRoot: root });
    expect(r.status).toBe('ok');
    expect(r.observed?.sharedVersion).toBe('4.1.0');
  });

  it('double-quoted CLI_VERSION equal to root → ok (the historical shape keeps working)', () => {
    writeDist('export const CLI_VERSION = "4.1.0";\n');
    expect(runRootVsShared({ projectRoot: root }).status).toBe('ok');
  });

  it('single-quoted DRIFT → blocker carrying the drifted value (not an empty-string drift)', () => {
    writeDist("export const CLI_VERSION = '4.0.54';\n");
    const r = runRootVsShared({ projectRoot: root });
    expect(r.status).toBe('blocker');
    expect(r.message).toContain('does not match');
    expect(r.message).toContain('4.0.54');
  });

  it('double-quoted DRIFT → blocker carrying the drifted value', () => {
    writeDist('export const CLI_VERSION = "4.0.54";\n');
    const r = runRootVsShared({ projectRoot: root });
    expect(r.status).toBe('blocker');
    expect(r.message).toContain('does not match');
    expect(r.message).toContain('4.0.54');
  });

  it('missing dist file → blocker with the missing-artifact message', () => {
    rmSync(join(root, 'packages', 'peaks-loop-shared', 'dist'), { recursive: true });
    const r = runRootVsShared({ projectRoot: root });
    expect(r.status).toBe('blocker');
    expect(r.message).toContain('is missing');
  });

  it('file present but constant unparseable → blocker with the parse message, not a drift', () => {
    writeDist('export const CLI_VERSION = 410;\n');
    const r = runRootVsShared({ projectRoot: root });
    expect(r.status).toBe('blocker');
    expect(r.message).toContain('parseable');
  });
});
