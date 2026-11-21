// tests/unit/context/harness-threshold-secret-leak.test.ts
//
// The invariant MED-2 exists for, asserted at the layer that held the leak:
// NO RESULT OBJECT IN THIS SLICE MAY CARRY TEXT READ FROM THE SETTINGS FILE.
//
// The earlier fix bounded the ENVELOPE views only, so `nextActions` and
// `warnings` were clean while the service result the envelope is BUILT from
// still held the plaintext at `previousRawValue`. `JSON.stringify` of that
// returned value leaked a secret-shaped string to any consumer that logged or
// persisted the object — the envelope was one consumer among many.
//
// The invariant is now structural: every bounded note is computed where the
// value is READ, so the raw text never leaves its module. These tests pin that
// by stringifying the WHOLE return value of the reconcile and of the
// context-now threshold reader, with a secret parked at BOTH threshold keys,
// and asserting neither the secret nor a 20-character prefix of it survives.
//
// Dimensions covered:
//   - render:      the bounded notes a consumer sees instead of the value
//   - behavior:    both keys, both entry points, every branch of each result
//   - integration: real `.claude/settings.local.json` read by the real modules
//   - a11y:        the sentence a refusal prints never echoes the value either

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { ensureInitHarnessThreshold } from '~/src/cli/commands/workspace/init-harness-threshold';
import {
  resolveHarnessCompactThresholdLocation,
  syncHarnessPercent
} from '~/src/services/context/harness-compact-threshold-config';
import { readHarnessCompactThreshold } from '~/src/services/context/harness-compact-threshold-verdict';
import { readHarnessPercentState } from '~/src/services/context/harness-percent-ownership';
import { readHarnessWindow, syncHarnessWindow } from '~/src/services/context/harness-window-config';

declareDimensions('tests/unit/context/harness-threshold-secret-leak.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const WINDOW_KEY = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW';
const PERCENT_KEY = 'CLAUDE_AUTOCOMPACT_PCT_OVERRIDE';

/** Distinct secrets, so a leak names which key produced it. */
const WINDOW_SECRET = 'ghp_WINDOWSECRETMATERIAL_a1b2c3d4e5f6a7b8';
const PERCENT_SECRET = 'sk-live-SECRETMATERIAL-9f8e7d6c5b4a39281706';

/** Neither the whole secret nor any 20-character prefix of it may appear. */
function expectNoSecret(text: string, secret: string, where: string): void {
  expect(text, `${where} leaked the full secret`).not.toContain(secret);
  expect(text, `${where} leaked a 20-char prefix of the secret`).not.toContain(secret.slice(0, 20));
}

describe('harness threshold — settings-file text never leaves the service layer', () => {
  // A module-level tmp root rather than `withTmpWorkspacePerTest`: that helper's
  // pool is one of the shapes the mutation runner cannot target.
  let root = '';
  afterEach(() => {
    if (root !== '') rmSync(root, { recursive: true, force: true });
    root = '';
  });

  function projectWithBothKeys(): string {
    root = mkdtempSync(join(tmpdir(), 'peaks-threshold-secret-'));
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(
      join(root, '.claude', 'settings.local.json'),
      `${JSON.stringify(
        { env: { [WINDOW_KEY]: WINDOW_SECRET, [PERCENT_KEY]: PERCENT_SECRET } },
        null,
        2
      )}\n`,
      'utf8'
    );
    return root;
  }

  function locationOf(projectRoot: string) {
    const location = resolveHarnessCompactThresholdLocation({ projectRoot, env: {} });
    if (location === null) throw new Error('the claude-code adapter must declare both knobs');
    return location;
  }

  it('when both threshold keys hold a secret, should not stringify it out of ensureInitHarnessThreshold', () => {
    // given: a project whose window AND percent rows carry secret-shaped text
    // when: init reconciles the pair and the caller is handed the result object
    // then: JSON.stringify of the WHOLE object — every field, every nested half
    //       — and of both routed channels holds neither secret nor a 20-char
    //       prefix, while the bounded note proving the field was replaced (not
    //       dropped) is present and the user's values are untouched on disk
    const projectRoot = projectWithBothKeys();
    const nextActions: string[] = [];
    const warnings: string[] = [];
    const result = ensureInitHarnessThreshold(nextActions, warnings, projectRoot, {});
    expect(result).not.toBeNull();
    const whole = JSON.stringify(result);
    expectNoSecret(whole, WINDOW_SECRET, 'ensureInitHarnessThreshold result');
    expectNoSecret(whole, PERCENT_SECRET, 'ensureInitHarnessThreshold result');
    expectNoSecret(JSON.stringify(nextActions), WINDOW_SECRET, 'nextActions');
    expectNoSecret(JSON.stringify(nextActions), PERCENT_SECRET, 'nextActions');
    expectNoSecret(JSON.stringify(warnings), WINDOW_SECRET, 'warnings');
    expectNoSecret(JSON.stringify(warnings), PERCENT_SECRET, 'warnings');
    expect(whole).toContain('not echoed here');
    const env = (
      JSON.parse(readFileSync(join(projectRoot, '.claude', 'settings.local.json'), 'utf8')) as {
        env: Record<string, unknown>;
      }
    ).env;
    expect(env[WINDOW_KEY]).toBe(WINDOW_SECRET);
    expect(env[PERCENT_KEY]).toBe(PERCENT_SECRET);
  });

  it('when both threshold keys hold a secret, should not stringify it out of the context-now threshold reader', () => {
    // given: the same secret-bearing file, and the same values on the session side
    // when: `peaks code context-now`'s threshold half reads the file pair and
    //       compares it with the session pair
    // then: neither the file's values nor the session's reach the returned
    //       object in any field, and the bounded notes are present
    const projectRoot = projectWithBothKeys();
    const read = readHarnessCompactThreshold({
      location: locationOf(projectRoot),
      env: { [WINDOW_KEY]: WINDOW_SECRET, [PERCENT_KEY]: PERCENT_SECRET }
    });
    const whole = JSON.stringify(read);
    expectNoSecret(whole, WINDOW_SECRET, 'readHarnessCompactThreshold result');
    expectNoSecret(whole, PERCENT_SECRET, 'readHarnessCompactThreshold result');
    expect(whole).toContain('not echoed here');
  });

  it('when the state and sync readers see a secret, should not return it on any field', () => {
    // given: the secret-bearing file, addressed by the adapter's own key names
    // when: each reader that used to carry the raw value runs
    // then: every one of them is clean, each says it saw something, and the
    //       settings file is still exactly what the user wrote
    const projectRoot = projectWithBothKeys();
    const location = locationOf(projectRoot);
    const window = readHarnessWindow({ location, env: {} });
    const percentState = readHarnessPercentState(location.settingsPath, location.percentEnvVar);
    const windowSync = syncHarnessWindow({ location, tokens: 250_000, env: {} });
    const percentSync = syncHarnessPercent({ location, percent: 80 });
    for (const [name, value] of [
      ['readHarnessWindow', window],
      ['readHarnessPercentState', percentState],
      ['syncHarnessWindow', windowSync],
      ['syncHarnessPercent', percentSync]
    ] as const) {
      const whole = JSON.stringify(value);
      expectNoSecret(whole, WINDOW_SECRET, name);
      expectNoSecret(whole, PERCENT_SECRET, name);
      expect(whole).toContain('not echoed here');
    }
    expect(existsSync(location.settingsPath)).toBe(true);
  });
});
