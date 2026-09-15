// tests/unit/services/audit/enforcer-liveness.test.ts
//
// A9 of the 2026-09-15 diagnosis: `cli-backed` used to mean "the enforcer
// file exists on disk". These cases pin the replacement question — does
// any module outside `src/services/audit/enforcers/` import it? — against
// small synthetic projects, so the assertion does not depend on which
// enforcers happen to be wired in the real tree today.

import { describe, expect, it, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { computeLiveEnforcers } from '../../../../src/services/audit/enforcer-liveness.js';

const tmpRoots: string[] = [];

/** Materialise a project root from a path → file-body map. */
function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-liveness-'));
  tmpRoots.push(root);
  for (const [relativePath, body] of Object.entries(files)) {
    const abs = join(root, ...relativePath.split('/'));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}

const LIVE = 'src/services/audit/enforcers/live.ts';
const DEAD = 'src/services/audit/enforcers/dead.ts';
const INNER = 'src/services/audit/enforcers/inner.ts';

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('computeLiveEnforcers', () => {
  it('when a source file outside the enforcers dir imports the enforcer, should mark it live', () => {
    // given: a caller that imports ./enforcers/live.js
    const root = makeProject({
      'src/services/audit/red-lines-service.ts': "import { x } from './enforcers/live.js';\n",
      [LIVE]: 'export const x = 1;\n',
    });

    // when: liveness is computed for that ref
    const scan = computeLiveEnforcers(root, [LIVE]);

    // then: the ref is live and liveness was decidable
    expect(scan.unknown).toBe(false);
    expect([...scan.live]).toEqual([LIVE]);
  });

  it('when nothing imports the enforcer, should not mark it live', () => {
    // given: an enforcer file with no importers at all
    const root = makeProject({ [DEAD]: 'export const x = 1;\n' });

    // when: liveness is computed
    const scan = computeLiveEnforcers(root, [DEAD]);

    // then: the ref is not live, but the scan still succeeded
    expect(scan.unknown).toBe(false);
    expect(scan.live.size).toBe(0);
  });

  it('when only a sibling enforcer imports it, should not mark it live', () => {
    // given: a dead enforcer importing another dead enforcer
    const root = makeProject({
      [DEAD]: `import { y } from './inner.js';\nexport const x = y;\n`,
      [INNER]: 'export const y = 1;\n',
    });

    // when: liveness is computed
    const scan = computeLiveEnforcers(root, [DEAD, INNER]);

    // then: neither is live — an import from inside the enforcers dir proves nothing
    expect(scan.unknown).toBe(false);
    expect(scan.live.size).toBe(0);
  });

  it('when the project has no src/ tree, should report liveness as unknown', () => {
    // given: a project root with no source tree at all
    const root = makeProject({ 'README.md': '# nothing to scan\n' });

    // when: liveness is computed
    const scan = computeLiveEnforcers(root, [LIVE]);

    // then: undecidable is reported as undecidable, not as "dead"
    expect(scan.unknown).toBe(true);
    expect(scan.live.size).toBe(0);
  });

  it('when a caller imports through a re-export path, should still mark the target live', () => {
    // given: a caller importing with an explicit ../ hop
    const root = makeProject({
      'src/other/caller.ts': "export { x } from '../services/audit/enforcers/live.js';\n",
      [LIVE]: 'export const x = 1;\n',
    });

    // when: liveness is computed
    const scan = computeLiveEnforcers(root, [LIVE]);

    // then: the resolved relative path matches the ref
    expect([...scan.live]).toEqual([LIVE]);
  });
});
