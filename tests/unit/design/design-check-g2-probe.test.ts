import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { checkDesign } from '../../../src/services/design/design-check.js';
import {
  DEFAULT_URL,
  cleanProbe,
  createAdoptedApp,
  disposeFixtures,
  fakeEngine,
  runOfKind
} from './_fake-designlang.js';

declareDimensions('tests/unit/design/design-check-g2-probe.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

afterEach(() => {
  disposeFixtures();
});

const input = (root: string, extra: Record<string, unknown> = {}) => ({
  projectRoot: root,
  changedFiles: ['src/routes/a.tsx'],
  ...extra
});

describe('Scenario: behavior — the shared page-usability probe gates G2', () => {
  it('when the page is unusable, should block before any designlang check spawns', async () => {
    // given: a page the probe refuses as a blank shell
    // when: check runs
    // then: G2 blocks and not one check is spawned
    const root = await createAdoptedApp();
    let runs = 0;
    const result = await checkDesign(
      input(root),
      fakeEngine({
        probePage: async () => ({
          ok: false,
          code: 'DESIGN_PAGE_UNUSABLE',
          message: 'the page is blank'
        }),
        run: async (kind, request) => {
          runs += 1;
          return runOfKind(kind, request.args);
        }
      })
    );
    expect(result.verdict).toBe('blocked');
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_PAGE_UNUSABLE'
    });
    expect(runs).toBe(0);
  });

  it('when two pages are configured, should probe each page URL', async () => {
    // given: two configured pages and a probe that records every URL
    // when: the matrix runs
    // then: every page passes the probe before its own checks
    const root = await createAdoptedApp();
    const probed: string[] = [];
    const result = await checkDesign(
      input(root, { pages: ['/', '/about'] }),
      fakeEngine({
        probePage: async (url) => {
          probed.push(url);
          return cleanProbe(url);
        }
      })
    );
    expect(result.verdict).toBe('pass');
    expect(probed).toEqual([DEFAULT_URL, `${DEFAULT_URL}about`]);
  });
});
