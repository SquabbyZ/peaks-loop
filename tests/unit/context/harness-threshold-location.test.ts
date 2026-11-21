// tests/unit/context/harness-threshold-location.test.ts
//
// `resolveHarnessCompactThresholdLocation` — the ONE place that turns an
// adapter declaration into "where the pair lives".
//
// WHY IT NEEDS ITS OWN ARMS. The function returns `null` when the adapter
// declares no window key, no percent key, or no settings file name. Nothing
// else in the slice can produce that `null`: `syncHarnessPercent` and
// `resetHarnessThreshold` both take a location, so a caller with a
// half-declared adapter either gets `null` here and reports "no threshold
// support" — or is handed a location with an `undefined` key and writes the
// literal string `"undefined"` into the user's settings file. The three
// independent `undefined` checks are therefore the guard, and each is pinned
// separately below with an adapter that declares the other two.
//
// Dimensions covered:
//   - render:      the resolved location's four fields
//   - behavior:    the three null-producing branches, each on its own
//   - integration: the real adapter registry, with a test seam adapter
//   - a11y:        omitted — no user-visible text is produced here; the CLI
//                  renders the location

import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { IdeAdapter } from '~/src/services/ide/ide-types';
import {
  _resetAdaptersForTesting,
  _setAdapterForTesting,
  getAdapter
} from '~/src/services/ide/ide-registry';
import { resolveHarnessCompactThresholdLocation } from '~/src/services/context/harness-compact-threshold-config';

declareDimensions(
  'tests/unit/context/harness-threshold-location.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'no user-visible text: the function returns a record, which the CLI renders'
    }
  ]
);

const PERCENT_KEY = 'TEST_AUTOCOMPACT_PCT';

/** The built-in adapter, as a base to declare a deliberately broken variant from. */
function baseAdapter(): IdeAdapter {
  return getAdapter('claude-code');
}

/** Register a variant of the built-in adapter for the detected env. */
function setVariant(patch: (adapter: IdeAdapter) => IdeAdapter): void {
  _setAdapterForTesting('claude-code', patch(baseAdapter()));
}

describe('harness threshold location — the adapter must declare ALL THREE', () => {
  afterEach(() => {
    _resetAdaptersForTesting();
  });

  describe('(render) the resolved shape', () => {
    it('when the adapter declares every half, should resolve the joined path and both keys', () => {
      // given: the built-in adapter, which declares both env vars and a file
      // when: the location is resolved for a project root
      // then: the settings path, BOTH adapter-declared keys, and the root. A
      //       caller can then write the pair without inventing a key name.
      const location = resolveHarnessCompactThresholdLocation({
        projectRoot: '/proj',
        env: {}
      });
      expect(location).not.toBeNull();
      const adapter = baseAdapter();
      expect(location?.settingsPath).toBe(
        join('/proj', adapter.settings.dirName, adapter.settings.localSettingsFileName ?? '')
      );
      expect(location?.envVar).toBe(adapter.compact?.autoCompactWindowEnvVar);
      expect(location?.percentEnvVar).toBe(adapter.compact?.autoCompactPercentEnvVar);
      expect(location?.projectRoot).toBe('/proj');
    });
  });

  describe('(behavior) each undeclared half is its own null', () => {
    it('when the adapter declares no WINDOW key, should resolve null', () => {
      // given: an adapter with the percent key and the file name only
      // when: the location is resolved
      // then: null — the caller must report "no threshold support" rather
      //       than write a key the harness never reads
      setVariant(
        (adapter) =>
          ({
            ...adapter,
            // A PARTIAL compact profile: this is deliberately the shape an
            // adapter that declares only the percent key has.
            compact: { autoCompactPercentEnvVar: PERCENT_KEY } as IdeAdapter['compact']
          }) as unknown as IdeAdapter
      );
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: '/proj', env: {} })).toBeNull();
    });

    it('when the adapter declares no PERCENT key, should resolve null', () => {
      // given: an adapter with the window key and the file name only
      // when: the location is resolved
      // then: null — this is the branch that keeps a "window-only" adapter
      //       from being handed a location with an undefined percent key
      setVariant(
        (adapter) =>
          ({
            ...adapter,
            compact: { autoCompactWindowEnvVar: 'TEST_WINDOW' } as IdeAdapter['compact']
          }) as unknown as IdeAdapter
      );
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: '/proj', env: {} })).toBeNull();
    });

    it('when the adapter declares no settings FILE NAME, should resolve null', () => {
      // given: both keys declared, neither file name. `localSettingsFileName`
      //        is preferred, so BOTH sides must be absent for this to fire —
      //        clearing only one would leave a usable name and pass anyway.
      // when: the location is resolved
      // then: null — `join(root, '.claude', undefined)` would produce a path
      //       ending in the literal `undefined`
      const adapter = baseAdapter();
      setVariant((current) => ({
        ...current,
        settings: {
          ...current.settings,
          localSettingsFileName: undefined,
          settingsFileName: undefined
        } as unknown as IdeAdapter['settings']
      }));
      expect(adapter.settings.dirName.length).toBeGreaterThan(0);
      expect(resolveHarnessCompactThresholdLocation({ projectRoot: '/proj', env: {} })).toBeNull();
    });
  });

  describe('(integration) the env selects the adapter', () => {
    it('when the env names unknown, should fall back to the built-in adapter', () => {
      // given: an env with no IDE marker at all
      // when: the location is resolved
      // then: it still resolves, through `claude-code` — the write half must
      //       work in an ordinary terminal, not only inside a detected IDE
      expect(
        resolveHarnessCompactThresholdLocation({ projectRoot: '/proj', env: {} })
      ).not.toBeNull();
    });
  });
});
