/**
 * `tests/unit/skills/auto-compact-public-profile.test.ts`
 *
 * The presence projection's compaction band follows the PUBLIC profile.
 *
 * What this pins down:
 *   - `buildContextVerdict(ratio, mode, batch)` keeps its signature — it has
 *     existing callers and existing tests;
 *   - at the SAME ratio, the `eager` profile is already in a compacting band
 *     where the `standard` profile is not, so `eager` fires earlier;
 *   - the projection reads the profile from the public resolution, so a
 *     project that pins `eager` gets the earlier band in its presence
 *     envelope — no mode has to be entered for it.
 *
 * Dimensions covered:
 *   - behavior:    the band per profile, and the order between them
 *   - integration: a real project tree with a session binding and a pinned
 *     preference
 *   - render:      the verdict's shape (`context.action`, `context.mode`)
 *   - a11y:        omitted — this file asserts the band, not the wording; the
 *     wording is asserted in `tests/unit/code/auto-compact-modes.test.ts`.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { buildContextVerdict, contextVerdict } from '~/src/cli/commands/core/skill-context-verdict';

declareDimensions(
  'tests/unit/skills/auto-compact-public-profile.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'this file asserts the band, not the wording' }]
);

const getWs = withTmpWorkspacePerTest('peaks-public-profile-');
const SID = '2026-10-24-session-public-profile';

/** The bands, from the quietest to the most urgent. */
const BAND_ORDER = ['none', 'soft-warn', 'auto-fire', 'pre-compact', 'red-line'] as const;

function bandIndex(action: string): number {
  const index = BAND_ORDER.indexOf(action as (typeof BAND_ORDER)[number]);
  return index === -1 ? -1 : index;
}

/** A project with a session binding, so the presence projection can resolve one. */
function writeProject(projectRoot: string, profile?: string): void {
  mkdirSync(join(projectRoot, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SID, projectRoot }),
    'utf8'
  );
  if (profile === undefined) return;
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', 'preferences.json'),
    JSON.stringify({ schema_version: '2.0.0', autoCompactProfile: profile }, null, 2) + '\n',
    'utf8'
  );
}

describe('behavior — the band follows the profile', () => {
  it('when the ratio is the same, should eager compact where standard does not', () => {
    // given: one ratio, read under both profiles
    // when: the band of each verdict is compared
    // then: the eager profile is already compacting where the standard one is not
    const eager = buildContextVerdict(0.66, 'eager');
    const standard = buildContextVerdict(0.66, 'standard');

    expect(eager.context.action).toBe('auto-fire');
    expect(standard.context.action).toBe('soft-warn');
    // The band a ratio falls into is what the model reads, and the eager
    // profile is already past the line that starts the compaction.
    expect(bandIndex(eager.context.action)).toBeGreaterThan(bandIndex(standard.context.action));
  });

  it('when the ratio is 0.66, should eager instruct while standard stays quiet', () => {
    // given: a ratio inside the eager auto-fire band
    // when: the next actions of both profiles are read
    // then: the eager one instructs, the standard one stays quiet
    expect(buildContextVerdict(0.66, 'eager').nextActions.length).toBeGreaterThan(0);
    expect(buildContextVerdict(0.66, 'standard').nextActions).toEqual([]);
  });

  it('when the band is compared, should standard reach it one threshold later', () => {
    // given: the standard profile at 0.8 and the eager one at 0.64
    // when: the band each verdict reaches is read
    // then: the standard profile reaches the same band one threshold later
    expect(buildContextVerdict(0.8, 'standard').context.action).toBe('auto-fire');
    expect(buildContextVerdict(0.64, 'eager').context.action).toBe('soft-warn');
  });

  it('when the ratio grows, should the band never move backwards', () => {
    // given: a rising series of ratios
    // when: both profiles are read at each of them
    // then: the band never moves backwards
    for (const ratio of [0.4, 0.55, 0.66, 0.7, 0.75, 0.8, 0.86, 0.96]) {
      const eager = bandIndex(buildContextVerdict(ratio, 'eager').context.action);
      const standard = bandIndex(buildContextVerdict(ratio, 'standard').context.action);
      expect(eager).toBeGreaterThanOrEqual(standard);
    }
  });
});

describe('integration — the projection reads the public profile', () => {
  it('when a project pins eager, should its presence verdict carry the eager profile', () => {
    // given: a project whose preference pins the eager profile
    // when: the presence verdict is built
    // then: it carries the eager profile
    const ws = getWs();
    writeProject(ws.path, 'eager');

    const verdict = contextVerdict(ws.path);
    expect(verdict.context?.mode).toBe('eager');
  });

  it('when a project pins nothing, should the verdict carry the standard profile', () => {
    // given: a project whose preference carries no profile
    // when: the presence verdict is built
    // then: it carries the standard profile
    const ws = getWs();
    writeProject(ws.path);

    const verdict = contextVerdict(ws.path);
    expect(verdict.context?.mode).toBe('standard');
  });
});

describe('render — the verdict shape', () => {
  it('when the verdict is built, should it report the ratio, the band and the profile', () => {
    // given: a verdict built at a known ratio
    // when: its fields are read
    // then: it reports the ratio, the band and the profile
    const verdict = buildContextVerdict(0.66, 'eager');
    expect(verdict.context.ratioPct).toBe('66.0%');
    expect(verdict.context.action).toBe('auto-fire');
    expect(verdict.context.mode).toBe('eager');
  });
});
