// tests/unit/services/web/web-login-profile.test.ts
//
// S4: the persistent login profile — the headed login RUN (tech-doc §9 file 9;
// design §2/§5/§10.2, decision C1).
//
// No headed window is opened and no real Playwright is touched: the module
// boundary that resolves Playwright is replaced with a fake chromium, so the
// ASSERTED subject is the runner's own behaviour — the guard, the disconnect
// signal, the capture, and every observable failure.
//
// The fake chromium, the redirected HOME and the CLI helpers live in
// `_login-harness.ts`, split out when the S4 repair round pushed this file past
// the 800-line scan limit. The name guard has its own file
// (`web-login-profile-guard.test.ts`), on the same precedent.
//
// Dimensions covered:
//   - render:      the JSON envelope, the human-mode failure line
//   - behavior:    the guard's verdicts, the disconnect signal, each failure code
//   - integration: the fake chromium boundary and the real login path
//   - a11y:        exit code, the stderr instruction, and that no cookie VALUE is printed

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/web/web-login-profile.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

import { runHeadedLogin } from '../../../../src/services/web/web-login-profile.js';
import { SECRET_COOKIE_VALUE } from './_login-fake.js';
import {
  asEnvelope,
  pw,
  readStateCookies,
  runWeb,
  stagingLeftovers,
  statePathFor
} from './_login-harness.js';

/**
 * `vi.mock` is file-scoped, so the calls stay here; their BODIES come from
 * `_login-fake.js`, which imports nothing mocked (see its header — the factories
 * `await import()` it, and a factory that awaited a module needing this same
 * mock would deadlock). The per-test hooks and the CLI helpers are in
 * `_login-harness.js`, imported statically above.
 */
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

describe('render — the login envelope', () => {
  it('when the user closes the window, should emit one ok envelope carrying the profile and counts', async () => {
    // given: a user who logs in and closes the headed window
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    // then:  the envelope names the verb, the profile and the artifact
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'work', '--json']));
    expect(parsed.ok).toBe(true);
    expect(parsed.data['profile']).toBe('work');
    expect(parsed.data['storageStatePath']).toBe(statePathFor('work'));
    expect(parsed.data['cookies']).toBe(1);
    expect(parsed.data['origins']).toBe(2);
    expect(typeof parsed.data['bytes']).toBe('number');
    expect(process.exitCode).toBeFalsy();
  });

  it('when --profile differs only in case, should report the canonical name and the fold', async () => {
    // given: a user who types their profile name with a capital letter
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'Work', '--json']));
    // then:  the run succeeds under the canonical name, and the fold is said out
    //        loud rather than silently aliasing the profile
    expect(parsed.ok).toBe(true);
    expect(parsed.data['profile']).toBe('work');
    expect(parsed.data['storageStatePath']).toBe(statePathFor('work'));
    expect(parsed.warnings.join('\n')).toContain('"Work" resolved to the profile "work"');
    expect(process.exitCode).toBeFalsy();
  });

  it('when --profile is already canonical, should warn about nothing', async () => {
    // given: a name the fold leaves exactly as it was
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'work', '--json']));
    // then:  nothing is reported — the notice is for a real difference only
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings).toEqual([]);
  });

  it('when the gate is on, should emit the tier-3 envelope and open no browser', async () => {
    // given: PEAKS_WEB_DISABLED=1 — the degradation gate
    process.env['PEAKS_WEB_DISABLED'] = '1';
    // when:  login runs with a perfectly valid profile
    // then:  it degrades, and chromium.launch was never reached
    try {
      const parsed = asEnvelope(await runWeb(['login', '--profile', 'work', '--json']));
      expect(parsed.ok).toBe(false);
      expect(parsed.code).toBe('WEB_DISABLED');
      expect(parsed.data['tier']).toBe(3);
      // EMPTY, not a tool: no `mcp__playwright__*` tool persists a storage state,
      // so the machine-readable field must agree with `nextActions` below and not
      // send the caller to `browser_navigate` (S4 R3).
      expect(parsed.data['mcpTool']).toBe('');
      expect(parsed.nextActions.length).toBeGreaterThan(0);
      expect(pw.launches).toBe(0);
    } finally {
      delete process.env['PEAKS_WEB_DISABLED'];
    }
  });

  it('when the gate refuses login, should offer the gate itself as the recovery', async () => {
    // given: PEAKS_WEB_DISABLED=1 — no MCP tool can persist a storage state
    process.env['PEAKS_WEB_DISABLED'] = '1';
    // when:  login degrades
    try {
      const parsed = asEnvelope(await runWeb(['login', '--profile', 'work', '--json']));
      // then:  the way forward is unsetting the gate, not a tool that cannot
      //        save a login profile at all
      const actions = parsed.nextActions.join('\n');
      expect(actions).not.toContain('browser_navigate');
      expect(actions).toContain('PEAKS_WEB_DISABLED');
    } finally {
      delete process.env['PEAKS_WEB_DISABLED'];
    }
  });
});

describe('behavior — the --profile contract', () => {
  it('when --profile is missing, should refuse and open no browser', async () => {
    // given: login with no profile name
    // when:  it runs
    // then:  it refuses with a structured code, and nothing was launched or written
    const parsed = asEnvelope(await runWeb(['login', '--json']));
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_PROFILE_REQUIRED');
    expect(parsed.nextActions.length).toBeGreaterThan(0);
    expect(process.exitCode).toBe(1);
    expect(pw.launches).toBe(0);
    expect(existsSync(join(homedir(), '.peaks', 'web-profiles'))).toBe(false);
  });

  it('when the gate is on and --profile is missing, should answer WEB_DISABLED rather than the profile refusal', async () => {
    // given: both conditions at once — the ordering tech-doc §5.1 fixes
    process.env['PEAKS_WEB_DISABLED'] = '1';
    // when:  login runs with no profile
    // then:  the gate is statement #1: WEB_DISABLED wins
    try {
      const parsed = asEnvelope(await runWeb(['login', '--json']));
      expect(parsed.code).toBe('WEB_DISABLED');
      expect(pw.launches).toBe(0);
    } finally {
      delete process.env['PEAKS_WEB_DISABLED'];
    }
  });

  it('when the profile name is invalid, should refuse before any launch', async () => {
    // given: a traversing name that a charset test alone would accept
    // when:  login runs
    // then:  the guard refuses and no browser was opened
    const parsed = asEnvelope(await runWeb(['login', '--profile', '..', '--json']));
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_PROFILE_NAME_INVALID');
    expect(pw.launches).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it('when the window is never closed, should report NOT_CLOSED and write no state', async () => {
    // given: a user who never closes the headed window
    // when:  the wait expires
    const started = performance.now();
    const outcome = await runHeadedLogin({ profile: 'silent', announce: () => undefined, timeoutMs: 120 });
    // then:  the deadline is HONOURED — not merely an upper bound on how fast it
    //        gave up — the failure is explicit, and no artifact is left. The
    //        `.partial` line is a regression guard: a second on-disk artifact is
    //        exactly what staging bought, and it must never come back (S1).
    expect(performance.now() - started).toBeGreaterThanOrEqual(120);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_NOT_CLOSED');
    expect(outcome.message).toContain('not closed');
    expect(existsSync(outcome.storageStatePath)).toBe(false);
    expect(existsSync(`${outcome.storageStatePath}.partial`)).toBe(false);
    // The sanctioned staging file is a SIBLING under the profile directory
    // (`browser-workflow.md`) and its name is PER-RUN (S4 R5), so this asks the
    // directory rather than one fixed filename: the timeout path must not leave
    // one behind.
    expect(stagingLeftovers('silent')).toEqual([]);
  });

  it('when the setup eats the bound, should not hand the wait a fresh one', async () => {
    // given: a launch that takes 150 ms against a 100 ms bound. Launch, context
    //        and page creation are time the user does not get back, and the
    //        deadline is taken BEFORE the launch precisely so they SPEND it
    //        (S4 R3).
    pw.launchDelayMs = 150;
    const started = performance.now();
    // when:  login runs
    const outcome = await runHeadedLogin({
      profile: 'setup-slow',
      announce: () => undefined,
      timeoutMs: 100
    });
    // then:  the run ends as soon as the setup returns and the bound is already
    //        spent, rather than granting the wait a whole new 100 ms (and, with
    //        a real interval, a full extra second) — the difference between a
    //        deadline taken before the launch and one taken after it.
    expect(outcome.code).toBe('WEB_LOGIN_NOT_CLOSED');
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('when the session can never be snapshotted, should refuse to publish an empty one', async () => {
    // given: every `storageState()` rejects, and the user closes the window
    pw.stateFails = true;
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'broken', announce: () => undefined });
    // then:  nothing was captured, so nothing is published — a code, not a silent
    //        success with zero counts
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_NO_SNAPSHOT');
    expect(outcome.bytes).toBe(0);
    expect(existsSync(outcome.storageStatePath)).toBe(false);
    expect(stagingLeftovers('broken')).toEqual([]);
  });

  it('when every read fails while the browser is open, should name that failure and not blame the close', async () => {
    // given: a PERSISTENT read failure that is not the window closing — the fake
    //        rejects every `storageState()`, and the browser is open when the
    //        first of those rejections happens (S4 R3, R3-2)
    pw.stateFails = true;
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'flaky', announce: () => undefined });
    // then:  the outcome does not tell the user the browser "closed before its
    //        session could be read" — it did not; every read threw. The real
    //        reason reaches the caller instead of being swallowed by a bare
    //        `catch {}`.
    expect(outcome.message).toContain('WEB_STATE_WRITE_FAILED');
    expect(outcome.message).not.toContain('closed before its session could be read');
  });

  it('when the browser really does close first, should still report it as a close', async () => {
    // given: a browser that disconnected before the wait began — the only read
    //        fails BECAUSE the context is gone, not for a reason of its own
    pw.closed = true;
    // when:  login runs
    const outcome = await runHeadedLogin({
      profile: 'gone',
      announce: () => undefined,
      timeoutMs: 5_000
    });
    // then:  the other side of the distinction above — a genuine close is still
    //        described as one, so the new read-error message cannot swallow it
    expect(outcome.code).toBe('WEB_LOGIN_NO_SNAPSHOT');
    expect(outcome.message).toContain('closed before its session could be read');
  });

  it('when the close beats the disconnect event, should still report it as a close', async () => {
    // given: a close whose FIRST read rejection lands BEFORE the `disconnected`
    //        event reaches the runner — so `closed()` is still false when the
    //        error is seen, and a check that keys on the event alone records it
    //        as a read failure and blames the read (S4 R5 / F3)
    pw.firstReadFailsAsClosed = true;
    pw.closeAfterMs = 30;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'raced', announce: () => undefined });
    // then:  it is described as what it was — the window closed before its
    //        session could be read — and not as a read that failed while open
    expect(outcome.code).toBe('WEB_LOGIN_NO_SNAPSHOT');
    expect(outcome.message).toContain('closed before its session could be read');
    expect(outcome.message).not.toContain('every attempt failed');
  });

  it('when the browser will not close, should still report the closed capture', async () => {
    // given: the window closes, then teardown fails
    pw.closeAfterMs = 10;
    pw.closeFails = true;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'sticky', announce: () => undefined });
    // then:  the session is kept AND the teardown problem is said out loud (S1's F1)
    expect(outcome.ok).toBe(true);
    expect(outcome.cookies).toBe(1);
    expect(outcome.warnings.join('\n')).toContain('did not close cleanly');
  });

  it('when the browser never confirms it closed, should bound the teardown and say so', async () => {
    // given: a `browser.close()` that never settles — a wedged renderer. Before
    //        S4 R3 the `finally` awaited it with no bound, so the docstring's
    //        "cannot hold a browser open forever" was a claim the code did not
    //        honour.
    pw.closeAfterMs = 10;
    pw.closeHangs = true;
    const started = performance.now();
    // when:  login runs with a shortened bound (the teardown bound is the lesser
    //        of the login bound and the constant)
    const outcome = await runHeadedLogin({
      profile: 'wedged',
      announce: () => undefined,
      timeoutMs: 150
    });
    // then:  the capture is kept, the command RETURNS, and the browser's fate is
    //        reported rather than silently assumed
    expect(outcome.ok).toBe(true);
    expect(outcome.cookies).toBe(1);
    expect(outcome.warnings.join('\n')).toContain('may still be running');
    expect(performance.now() - started).toBeLessThan(3_000);
  });

  it('when the published state cannot be read back, should say so rather than report a clean success', async () => {
    // given: a snapshot that lands unparseable on disk, published on close
    pw.stateRaw = 'not a storage state';
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'corrupt', announce: () => undefined });
    // then:  the file is reported at its real size, and the read-back failure is not
    //        swallowed (S1's F1) — a silent zero here is the failure mode it exists for
    expect(outcome.ok).toBe(true);
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.cookies).toBe(0);
    expect(outcome.warnings.join('\n')).toContain('could not be read back');
  });

  it('when the capture holds neither cookies nor origins, should fail rather than report a login that did not happen', async () => {
    // given: a window closed before a real login
    pw.cookies = 0;
    pw.origins = 0;
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'empty', announce: () => undefined });
    // then:  `ok: true` / exit 0 for a verb whose whole purpose is persisting a
    //        session was a success report for a login that did not happen (S4 R3,
    //        both lenses). Nothing is written, and the outcome says so.
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_EMPTY_SNAPSHOT');
    expect(outcome.bytes).toBe(0);
    expect(existsSync(statePathFor('empty'))).toBe(false);
    expect(stagingLeftovers('empty')).toEqual([]);
  });

  it('when an empty capture is taken over a working profile, should not overwrite it', async () => {
    // given: a profile that already holds a working session
    const name = 'keep-good';
    pw.closeAfterMs = 10;
    const first = await runHeadedLogin({ profile: name, announce: () => undefined });
    expect(first.ok).toBe(true);
    const before = readFileSync(statePathFor(name));
    // when:  the user opens a login that captures nothing
    pw.cookies = 0;
    pw.origins = 0;
    pw.closed = false;
    pw.onDisconnected = [];
    const second = await runHeadedLogin({ profile: name, announce: () => undefined });
    // then:  the good cookie jar survives BYTE-FOR-BYTE. This is the footgun both
    //        lenses flagged: an empty capture used to replace a working profile.
    expect(second.ok).toBe(false);
    expect(second.code).toBe('WEB_LOGIN_EMPTY_SNAPSHOT');
    expect(readFileSync(statePathFor(name))).toEqual(before);
    expect(readStateCookies(name)).toHaveLength(1);
  });

  it('when the window closes only after the wait has begun, should keep snapshotting until then', async () => {
    // given: a user who closes the window 750 ms after the browser opened — three
    //        snapshot intervals into the wait, and NOT closed when it starts
    pw.closeAfterMs = 750;
    // when:  login runs with a bound far longer than that
    const started = performance.now();
    const outcome = await runHeadedLogin({
      profile: 'slow',
      announce: () => undefined,
      timeoutMs: 5_000
    });
    const elapsed = performance.now() - started;
    // then:  it waited for the close rather than deciding at once, and the state it
    //        persisted is the one it had snapshotted
    expect(outcome.ok).toBe(true);
    expect(outcome.cookies).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    // A read AFTER the close is attempted and refused (as the real 1.63.0 does),
    // so what got published is the snapshot taken WHILE the window was open: one
    // ask succeeded, and there were more asks than successes.
    expect(pw.captures).toBeGreaterThanOrEqual(1);
    expect(pw.snapshots).toBeGreaterThan(pw.captures);
    const published = readStateCookies('slow');
    expect(published).toHaveLength(1);
    expect(published[0]?.value).toBe(SECRET_COOKIE_VALUE);
  });

  it('when the login outlives a snapshot interval, should read the session again while open', async () => {
    // given: a user who takes 1.6 s — past the 1 s interval, so a loop that
    //        snapshotted once and then merely waited cannot reach two
    //        SUCCESSFUL reads. The bound is 4 s so that loop FAILS here in
    //        ~4 s rather than hanging for the production ten minutes.
    pw.closeAfterMs = 1_600;
    // when:  login runs
    const outcome = await runHeadedLogin({
      profile: 'cadence',
      announce: () => undefined,
      timeoutMs: 4_000
    });
    // then:  more than one read SUCCEEDED. `snapshots` counts asks — the
    //        post-close read is a failing ask — so only `captures` can show the
    //        interval actually fired again, which is the staleness bound the
    //        module docstring promises.
    expect(outcome.ok).toBe(true);
    expect(pw.captures).toBeGreaterThanOrEqual(2);
    expect(outcome.cookies).toBe(1);
  });

  it('when the browser is already gone, should fail fast instead of running out the deadline', async () => {
    // given: a browser that disconnected before the wait began. `disconnected`
    //        is not replayed, so only an `isConnected()` pre-check can see it.
    pw.closed = true;
    const started = performance.now();
    // when:  login runs against a 5 s bound
    const outcome = await runHeadedLogin({
      profile: 'dead',
      announce: () => undefined,
      timeoutMs: 5_000
    });
    // then:  it does not spend the bound waiting on a browser that is gone —
    //        nothing was read, so nothing is published
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_NO_SNAPSHOT');
    expect(existsSync(outcome.storageStatePath)).toBe(false);
  });

  it('when the browser dies while the page is being created, should not run out the deadline', async () => {
    // given: a browser that disconnects DURING `context.newPage()` — the window
    //        in which a listener registered after that await would miss the
    //        event entirely (code review F3)
    pw.disconnectOnPageOpen = true;
    const started = performance.now();
    // when:  login runs
    const outcome = await runHeadedLogin({
      profile: 'died',
      announce: () => undefined,
      timeoutMs: 5_000
    });
    // then:  the wait ends with the browser rather than ten minutes later
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_NO_SNAPSHOT');
  });

  it('when the browser will not launch, should throw rather than return an outcome', async () => {
    // given: a launch that fails — the one failure with no browser to tear down
    pw.launchFails = true;
    // when:  login runs
    // then:  the caller sees the throw, not a made-up outcome
    await expect(
      runHeadedLogin({ profile: 'nolaunch', announce: () => undefined })
    ).rejects.toThrow(/WEB_LAUNCH_FAILED/);
  });

  it('when the published state is unparseable, should not echo any part of it', async () => {
    // given: a file whose FIRST BYTES are a cookie value — `JSON.parse` quotes
    //        the head of its input into the error message
    pw.stateRaw = SECRET_COOKIE_VALUE;
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'fragment', announce: () => undefined });
    // then:  the warning names the reason and the size, never the parser's snippet
    expect(outcome.bytes).toBeGreaterThan(0);
    expect(outcome.warnings.join('\n')).toContain('could not be read back');
    expect(outcome.warnings.join('\n')).not.toContain('COOKIE-VAL');
  });

  it('when the published state cannot be read back, should mark the outcome unverified', async () => {
    // given: a snapshot that lands something unparseable at the resolved path
    pw.stateRaw = 'not a storage state';
    pw.closeAfterMs = 10;
    // when:  login runs
    const outcome = await runHeadedLogin({ profile: 'unverified', announce: () => undefined });
    // then:  the publish is not downgraded to a failure, but the outcome carries a
    //        code an ok-only consumer cannot read as a clean success
    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe('WEB_LOGIN_STATE_UNREADABLE');
  });

  it('when the wall clock steps backwards, should still expire the bound', async () => {
    // given: a frozen clock — the shape a backward NTP/DST/VM-resume step
    //        produces, against which a wall-clock deadline is unreachable
    vi.spyOn(Date, 'now').mockReturnValue(1_600_000_000_000);
    const started = performance.now();
    // when:  login runs with a 120 ms bound and a window that never closes
    const outcome = await runHeadedLogin({
      profile: 'frozen',
      announce: () => undefined,
      timeoutMs: 120
    });
    // then:  the bound expired anyway: it is monotonic, not wall-clock, and it
    //        was waited out rather than cut short
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('WEB_LOGIN_NOT_CLOSED');
    expect(performance.now() - started).toBeGreaterThanOrEqual(120);
    expect(performance.now() - started).toBeLessThan(3_000);
  });
});

describe('integration — the launch boundary', () => {
  it('when the headed login launches, should launch a non-persistent headed browser', async () => {
    // given: a login the user ends by closing the window (decision C1 forbids
    //        launchPersistentContext)
    pw.closeAfterMs = 10;
    // when:  the runner launches
    await runHeadedLogin({ profile: 'headed', announce: () => undefined });
    // then:  exactly one plain launch, headed, and no persistent context
    expect(pw.launches).toBe(1);
    expect(pw.launchOptions[0]?.['headless']).toBe(false);
  });
});

describe('a11y — what the human sees', () => {
  it('when the browser is open, should tell the human that closing it saves the session', async () => {
    // given: a login the user will close the window on
    pw.closeAfterMs = 10;
    // when:  login runs
    const captured = await runWeb(['login', '--profile', 'hinted', '--json']);
    // then:  the instruction the human needs is on stderr, not buried in JSON,
    //        and it does not ask for a file the protocol no longer uses
    expect(captured.stderrText()).toContain('log in there yourself');
    expect(captured.stderrText()).toContain('Close the browser window');
    expect(captured.stderrText()).toContain(statePathFor('hinted'));
  });

  it('when the profile name was folded, should instruct with the canonical name', async () => {
    // given: an upper-case --profile the guard folds to `work`
    pw.closeAfterMs = 10;
    // when:  login runs in human mode
    const captured = await runWeb(['login', '--profile', 'Work']);
    // then:  the name the human is shown, and the path they are told to look at,
    //        are the canonical ones — what they typed never diverges on screen
    expect(captured.stderrText()).toContain('profile "work"');
    expect(captured.stderrText()).toContain(statePathFor('work'));
  });

  it('when the capture is empty, should exit non-zero rather than report a saved login', async () => {
    // given: a window closed before a real login
    pw.cookies = 0;
    pw.origins = 0;
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'nologin', '--json']));
    // then:  exit 0 here WAS the success report for a login that did not happen
    //        (S4 R3) — the user-visible half of the empty-capture contract
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_LOGIN_EMPTY_SNAPSHOT');
    expect(process.exitCode).toBe(1);
    expect(existsSync(statePathFor('nologin'))).toBe(false);
  });

  it('when login is refused, should exit non-zero and offer a next action', async () => {
    // given: a profile-less invocation
    // when:  login runs in human mode
    const captured = await runWeb(['login']);
    // then:  the failure and the way forward are on stderr, and the exit code is non-zero
    expect(process.exitCode).toBe(1);
    expect(captured.stderrText()).toContain('WEB_PROFILE_REQUIRED');
    expect(captured.stderrText()).toContain('Re-run');
  });

  it('when the login succeeds, should never print a stored cookie value', async () => {
    // given: a captured session whose values are secret
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    const captured = await runWeb(['login', '--profile', 'private', '--json']);
    // then:  counts are reported and the values are not
    expect(captured.text()).toContain('"cookies": 1');
    expect(captured.text()).not.toContain(SECRET_COOKIE_VALUE);
    expect(captured.stderrText()).not.toContain(SECRET_COOKIE_VALUE);
  });

  it('when a failed login also left a browser open, should print the teardown warning', async () => {
    // given: the only shape that fails AND warns — the context never opens, and
    //        the browser then refuses to close (a browser `stop` cannot reach,
    //        because `stop` is daemon-scoped)
    pw.contextFails = true;
    pw.closeFails = true;
    // when:  login runs in human mode
    const captured = await runWeb(['login', '--profile', 'leaky']);
    // then:  the warning is not discarded by the failure branch
    expect(process.exitCode).toBe(1);
    expect(captured.stderrText()).toContain('did not close cleanly');
  });

  it('when a failed login carries a warning, should carry it in the JSON envelope', async () => {
    // given: the same failed-and-warned shape, read by a machine
    pw.contextFails = true;
    pw.closeFails = true;
    // when:  login runs with --json
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'leaky', '--json']));
    // then:  `fail()` hard-codes `warnings: []`, so it had to be spread back over
    //        the envelope to survive
    expect(parsed.ok).toBe(false);
    expect(parsed.warnings.join('\n')).toContain('did not close cleanly');
  });

  it('when the browser will not launch, should render WEB_LOGIN_FAILED', async () => {
    // given: a launch failure — thrown before any outcome exists
    pw.launchFails = true;
    // when:  login runs
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'nolaunch', '--json']));
    // then:  the CLI renders it with the code the runner's contract names
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_LOGIN_FAILED');
    expect(process.exitCode).toBe(1);
  });

  it('when the launch fails after a folded --profile, should still report the fold', async () => {
    // given: an upper-case name that resolves and then a launch that throws —
    //        a failure AFTER the name was resolved, which is the one path the
    //        fold used to be silent on (security S5 / code F5)
    pw.launchFails = true;
    // when:  login runs
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'Work', '--json']));
    // then:  the canonical name is reported here like everywhere else
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('WEB_LOGIN_FAILED');
    expect(parsed.warnings.join('\n')).toContain('"Work" resolved to the profile "work"');
  });

  it('when the published state cannot be read back, should carry the unreadable code', async () => {
    // given: a login whose published state file cannot be parsed
    pw.stateRaw = 'not a storage state';
    pw.closeAfterMs = 10;
    // when:  login runs with --json
    const parsed = asEnvelope(await runWeb(['login', '--profile', 'unverified', '--json']));
    // then:  the envelope is not a clean success — it names the capture unreadable
    //        — and the artifact it names really is on disk, so this code cannot
    //        be produced by a publish that simply never happened (test review F2)
    expect(parsed.ok).toBe(true);
    expect(parsed.code).toBe('WEB_LOGIN_STATE_UNREADABLE');
    expect(existsSync(statePathFor('unverified'))).toBe(true);
    expect(Number(parsed.data['bytes'])).toBeGreaterThan(0);
  });

  it('when the profile name is invalid, should print its code exactly once', async () => {
    // given: a name the guard refuses, read in human mode
    // when:  login runs
    const captured = await runWeb(['login', '--profile', '..']);
    // then:  the helper's own prefix is not doubled by `fail()`
    expect(captured.stderrText().split('WEB_PROFILE_NAME_INVALID').length - 1).toBe(1);
  });

  it('when the gate refuses an oversized --profile, should cap what it echoes', async () => {
    // given: the gate on and a 500-character name that never reached validation
    process.env['PEAKS_WEB_DISABLED'] = '1';
    // when:  login runs
    try {
      const parsed = asEnvelope(await runWeb(['login', '--profile', 'x'.repeat(500), '--json']));
      // then:  the refusal echoes a bounded value, not the raw flag
      const args = parsed.data['args'] as Record<string, string>;
      expect((args['profile'] ?? '').length).toBeLessThanOrEqual(65);
    } finally {
      delete process.env['PEAKS_WEB_DISABLED'];
    }
  });
});
