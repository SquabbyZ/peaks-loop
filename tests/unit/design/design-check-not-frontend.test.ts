// The resolver's no-surface boundary: a repository with no frontend app root is
// `not-applicable`, while a bad --app stays `blocked`.
//
// Dimensions omitted: render (no output is rendered), integration (the temp
// directory is a fixture, not the behavior under test) and a11y (no
// human-visible text or exit code is asserted here; the CLI-side exit code is
// covered by tests/unit/cli/design-gate-evidence-write.test.ts).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type * as DesignCheckModuleTypes from '../../../src/services/design/design-check.js';

type DesignCheckModule = typeof DesignCheckModuleTypes;

declareDimensions(
  'tests/unit/design/design-check-not-frontend.test.ts',
  ['behavior'],
  [
    { dim: 'render', reason: 'no output is rendered; the returned result is asserted' },
    {
      dim: 'integration',
      reason: 'the temp directory is a fixture; no boundary is exercised'
    },
    {
      dim: 'a11y',
      reason: 'no human-visible text; the CLI exit code is covered by the gate-evidence test'
    }
  ]
);

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

async function loadDesignCheck(): Promise<DesignCheckModule> {
  vi.resetModules();
  return import('../../../src/services/design/design-check.js');
}

function makeNonFrontend(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-nofe-'));
  roots.push(root);
  writeFileSync(join(root, 'go.mod'), 'module example.com/app\n', 'utf8');
  return root;
}

describe('Scenario: behavior — a repository with no frontend surface', () => {
  it('when no frontend app root exists, should mark the check not-applicable', async () => {
    // given: a repository with no frontend evidence
    // when: check runs
    // then: there is no surface to judge, so the result is not-applicable, not blocked
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const result = await checkDesignSourceOnly({
      projectRoot: makeNonFrontend(),
      changedFiles: ['main.go']
    });
    expect(result.verdict).toBe('not-applicable');
    expect(result.errorCode).toBe('DESIGN_NOT_FRONTEND');
  });

  it('when --app names no frontend app root, should keep the result blocked', async () => {
    // given: a repository with no frontend evidence and an --app path that matches nothing
    // when: check runs
    // then: a bad --app is a configuration error, so the result stays blocked
    const { checkDesignSourceOnly } = await loadDesignCheck();
    const result = await checkDesignSourceOnly({
      projectRoot: makeNonFrontend(),
      appPath: 'apps/missing',
      changedFiles: ['main.go']
    });
    expect(result.verdict).toBe('blocked');
    expect(result.errorCode).toBe('DESIGN_APP_NOT_FOUND');
  });
});
