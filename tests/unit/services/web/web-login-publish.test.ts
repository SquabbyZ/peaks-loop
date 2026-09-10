// tests/unit/services/web/web-login-publish.test.ts
//
// S4 R5: the STAGING PUBLISH — what the artifact on disk holds after a login
// (tech-doc §9 file 20; decision UD-7), and what is left beside it. Split out of
// `web-login-profile.test.ts` when the repair round pushed that file past the
// 800-line scan limit, on the same precedent as `_login-fake.ts`: the seam is
// "the session is in memory" → "the artifact holds it".
//
// The fake chromium, the redirected HOME and the CLI helpers come from
// `_login-harness.ts`. The two `vi.mock` calls are FILE-SCOPED and cannot live
// there, so they are declared here too, for the same reason and with the same
// factory bodies.
//
// Dimensions covered:
//   - render:      the bytes at the resolved path, and what is beside them
//   - behavior:    a failed publish, the staging sweep
//   - integration: the REAL filesystem under a redirected HOME
//   - a11y:        omitted — nothing in this file is human-facing; the envelope
//                  and the human error line are asserted in
//                  `web-login-profile.test.ts`.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/web/web-login-publish.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no human-facing surface in this file (see the header)' }]
);

import { runHeadedLogin, webProfileDir } from '../../../../src/services/web/web-login-profile.js';
import { pw, readStateCookies, stagingLeftovers, statePathFor } from './_login-harness.js';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const { fsMock } = await import('./_login-fake.js');
  return fsMock(actual);
});

vi.mock('../../../../src/services/web/playwright-loader.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../../src/services/web/playwright-loader.js')>();
  const { loaderMock } = await import('./_login-fake.js');
  return loaderMock(actual);
});

describe('render — the artifact on disk', () => {
  it('when the user closes the window, should leave a readable storage state at the resolved path', async () => {
    // given: a user who closes the window after the session was snapshotted
    const name = 'e2e';
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: name, announce: () => undefined });
    // then:  the artifact exists, is non-empty, and parses as a storage state
    expect(outcome.ok).toBe(true);
    expect(existsSync(statePathFor(name))).toBe(true);
    const written = JSON.parse(readFileSync(statePathFor(name), 'utf8')) as { cookies: unknown[] };
    expect(written.cookies).toHaveLength(1);
    expect(outcome.bytes).toBeGreaterThan(0);
  });

  it('when the same profile logs in a second time, should replace the previous state', async () => {
    // given: a profile that already holds a session from an earlier login
    const name = 'relogin';
    pw.closeAfterMs = 10;
    const first = await runHeadedLogin({ profile: name, announce: () => undefined });
    expect(first.ok).toBe(true);
    expect(readStateCookies(name)).toHaveLength(1);
    // when:  the user logs in again and the fresh session holds three cookies
    pw.cookies = 3;
    pw.closed = false;
    pw.onDisconnected = [];
    const second = await runHeadedLogin({ profile: name, announce: () => undefined });
    // then:  the write lands on a file that ALREADY EXISTS and replaces it.
    //        Re-login over an existing storageState.json is the normal case, and
    //        it is the one the publish path must not fail on.
    expect(second.ok).toBe(true);
    expect(readStateCookies(name)).toHaveLength(3);
  });

  it('when the capture holds only origins, should publish it rather than refuse it', async () => {
    // given: a session kept in localStorage — `origins` populated, `cookies`
    //        empty. That is a real, valid Playwright storage state, and the
    //        round-4 refusal (which keyed on `cookies` alone) made it
    //        unpersistable — the persistent-login verb could not persist a
    //        non-cookie session at all (S4 R5 / F2).
    const name = 'origins-only';
    pw.cookies = 0;
    pw.origins = 2;
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: name, announce: () => undefined });
    // then:  it IS a login: published, reported as one, and readable on disk
    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe('');
    expect(outcome.cookies).toBe(0);
    expect(outcome.origins).toBe(2);
    const written = JSON.parse(readFileSync(statePathFor(name), 'utf8')) as { origins: unknown[] };
    expect(written.origins).toHaveLength(2);
  });
});

describe('behavior — the publish and the staging sweep', () => {
  it('when the publish rename fails, should leave the previous profile byte-for-byte intact', async () => {
    // given: a profile that already holds a working session (a normal re-login)
    const name = 'atomic';
    pw.closeAfterMs = 10;
    const first = await runHeadedLogin({ profile: name, announce: () => undefined });
    expect(first.ok).toBe(true);
    const before = readFileSync(statePathFor(name));
    // when:  the user re-logs in and the RENAME fails. The failure is injected at
    //        the rename, which is the operation the atomicity claim is about and
    //        which happens AFTER the real staged bytes are on disk. A write-time
    //        throw raised by the fake never called the real `writeFileSync`, so
    //        the byte-equality assertion below could not fail however the publish
    //        was implemented (S4 R5 / R4-1).
    pw.cookies = 3;
    pw.closed = false;
    pw.onDisconnected = [];
    pw.failPublishRename = true;
    const second = await runHeadedLogin({ profile: name, announce: () => undefined });
    pw.failPublishRename = false;
    // then:  the injection really did land after a real write, the publish really
    //        did fail, and the old cookie jar is EXACTLY what it was — not
    //        truncated to 0 bytes, not half-written. This assertion is the WHOLE
    //        POINT of the atomic publish.
    expect(pw.stagingOnDiskAtRename).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.code).toBe('WEB_LOGIN_FAILED');
    expect(readFileSync(statePathFor(name))).toEqual(before);
    expect(readStateCookies(name)).toHaveLength(1);
    expect(stagingLeftovers(name)).toEqual([]);
    // and the message claims only what this run can verify (S4 R5): our one
    // artifact-touching operation is the rename, and it threw
    expect(second.warnings.join('\n')).toContain('did not modify');
  });

  it('when the publish succeeds, should not leave the staging file behind', async () => {
    // given: a normal login
    const name = 'no-residue';
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: name, announce: () => undefined });
    // then:  the staging file is renamed ONTO the artifact, so nothing staging
    //        is left in the profile directory — the carve-out sanctions it only
    //        while a publish is in flight
    expect(outcome.ok).toBe(true);
    expect(stagingLeftovers(name)).toEqual([]);
    expect(existsSync(statePathFor(name))).toBe(true);
  });

  it('when a killed run left a staging file, should sweep it', async () => {
    // given: a staging file a SIGKILLed run left behind — its pid is gone, so no
    //        `finally` of its own will ever run — and a login that does NOT
    //        publish (the user never closes the window)
    const name = 'sweep';
    const stale = join(webProfileDir(name), 'storageState.json.2147483647.staging');
    mkdirSync(webProfileDir(name), { recursive: true });
    writeFileSync(stale, 'live cookies a killed run left behind');
    // when:  login runs and times out
    const outcome = await runHeadedLogin({
      profile: name,
      announce: () => undefined,
      timeoutMs: 120
    });
    // then:  the NEXT run on this profile is what clears it — this is the one job
    //        the `finally` sweep has that a successful run does not do for itself
    expect(outcome.code).toBe('WEB_LOGIN_NOT_CLOSED');
    expect(existsSync(stale)).toBe(false);
    expect(stagingLeftovers(name)).toEqual([]);
  });

  it('when a live run holds a staging file, should leave it alone', async () => {
    // given: another login that is still RUNNING (this test's parent process
    //        stands in for it) with its staging file still in flight. Deleting it
    //        would make that run's rename fail and hand it a failure message
    //        about an artifact it in fact replaced — the false invariant the
    //        per-run staging name exists to remove (S4 R5 / F1).
    const name = 'in-flight';
    const inFlight = join(webProfileDir(name), `storageState.json.${String(process.ppid)}.staging`);
    mkdirSync(webProfileDir(name), { recursive: true });
    writeFileSync(inFlight, 'another run, still publishing');
    // when:  this login runs and does not publish
    const outcome = await runHeadedLogin({
      profile: name,
      announce: () => undefined,
      timeoutMs: 120
    });
    // then:  the other run's staging file is still there
    expect(outcome.code).toBe('WEB_LOGIN_NOT_CLOSED');
    expect(existsSync(inFlight)).toBe(true);
  });
});

describe('integration — the profile directory', () => {
  it.skipIf(process.platform === 'win32')(
    'when the state is persisted, should keep the profile owner-only',
    async () => {
      // given: a login the user closes the window on (the mode bits are inert on
      //        Windows, which is why this is skipped there)
      const name = 'owner-only';
      pw.closeAfterMs = 10;
      // when:  login runs
      const outcome = await runHeadedLogin({ profile: name, announce: () => undefined });
      // then:  live session cookies are not world-readable, unlike the default
      //        umask a plain write would take
      expect(outcome.ok).toBe(true);
      expect(statSync(webProfileDir(name)).mode & 0o777).toBe(0o700);
      expect(statSync(statePathFor(name)).mode & 0o777).toBe(0o600);
    }
  );
});
