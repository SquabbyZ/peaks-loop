/**
 * The persistent login profile — its name guard, and the headed login that
 * produces it (slice S4, file 20; design §2/§5/§10.2, orchestrator decision C1).
 *
 * Two halves, one responsibility ("a profile the user explicitly asked to keep"):
 *
 *   1. The PATH GUARD. `~/.peaks/web-profiles/<name>/storageState.json`, where
 *      `<name>` must match `PROFILE_NAME_RE` after lower-case folding, must not
 *      be a dot segment, must not BEGIN with a dot (`.con` has an empty stem, so
 *      the device-name test cannot see it, and `..foo` is a dot segment the
 *      charset lets through), must not end in a dot or a space (see
 *      `hasTrailingDotOrSpace`), must not be a Windows device name, and must
 *      resolve under the profile root. Re-derived from `resolveUserDataDir`
 *      (`src/cli/commands/playwright-commands.ts:462`), whose prefix-plus-separator
 *      containment test is what stops `/home/A/prof2` passing for `/home/A/prof`.
 *      The charset test alone is NOT the guard: `..` matches
 *      `^[a-z0-9._-]{1,64}$` — the dot-segment rejection is what catches it.
 *
 *   2. The HEADED LOGIN. C1 is binding: never `launchPersistentContext`, which
 *      would create one browser PROCESS per dispatch and violate Q8. One
 *      `chromium.launch({ headless: false })` the user drives, and the profile is
 *      captured as a Playwright storage state — not a Chromium `userDataDir`.
 *
 * This is the ONLY path in the feature that persists a login (PRD R7), so it is
 * reached only from an explicit `peaks web login --profile <name>`. The daemon's
 * browser is headless and its own; `login` neither needs a session binding nor
 * goes through `routeOp`.
 *
 * THE INTERACTION PROTOCOL (user decision, 2026-09-10 — it REPLACED an explicit
 * `login.confirmed` file):
 *
 *   - "Done" is the user CLOSING THE HEADED WINDOW. It is the only signal that
 *     does not ask the user to do something they would not otherwise do, and
 *     `browser.on('disconnected')` is what the wait ends on.
 *   - The capture is IN MEMORY, and that is a hard constraint, not a preference:
 *     with a non-persistent context — which C1 mandates — the context is gone
 *     the moment the browser disconnects. Verified on the pinned
 *     playwright@1.63.0: `context.storageState()` after disconnect throws
 *     "Target page, context or browser has been closed". So the state is read
 *     INTO THIS PROCESS every `LOGIN_SNAPSHOT_MS` while the window is open
 *     (`storageState()` with no `path`, which returns the object), and written to
 *     `storageState.json` EXACTLY ONCE, at the moment of disconnect.
 *   - The publish is ATOMIC (user decision UD-7, 2026-09-10); it lives in
 *     `web-login-staging.ts`. The bytes land in a staging sibling IN THE SAME
 *     PROFILE DIRECTORY and a `renameSync` linearizes them onto
 *     `storageState.json`, so the previous profile is untouched unless that
 *     rename succeeds. That is the fix for what a single `writeFileSync` did:
 *     its default flag `w` is `O_TRUNC`, so it emptied the artifact AT OPEN —
 *     before the first byte — and a mid-write `ENOSPC`/`EIO` destroyed a working
 *     login while the failure message called it "unchanged". The staging name is
 *     PER-RUN (`storageState.json.<pid>.staging`, S4 R5) because a fixed one let
 *     two concurrent logins on one profile install each other's bytes.
 *     `browser-workflow.md` names the staging file as a carve-out with three
 *     conditions, all kept: it lives in the profile directory, it is deleted on
 *     every failure path, and nothing ever reads it as a profile. An unclosed or
 *     never-captured login publishes NOTHING at all.
 *   - An EMPTY capture is not a session. A run that captured NOTHING — no
 *     cookies AND no origins — writes nothing and fails, rather than replacing a
 *     working profile with an empty one and reporting a login that did not
 *     happen as a success. A state that holds only `origins` (a session kept in
 *     localStorage) IS a session and is published (S4 R5).
 *   - The persisted state can be up to one snapshot interval STALE: a cookie set
 *     in the last second before the window is closed may be missing. The capture
 *     is never exact and is never described as exact.
 *   - The wait is bounded by a MONOTONIC deadline (`LOGIN_TIMEOUT_MS`) taken
 *     BEFORE the launch — so launch, context and page creation SPEND that budget
 *     rather than sitting outside it — and the teardown is bounded too, so
 *     neither an abandoned login nor a `browser.close()` that never settles can
 *     hold the process (or a browser process) open for the rest of the machine's
 *     uptime. The residual, stated rather than implied: those setup steps are
 *     inside the budget but are NOT individually raced, so a `launch()` that
 *     never settles would still hang. Bounding it would mean abandoning a
 *     browser this code has no handle on yet.
 */
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { getErrorMessage } from 'peaks-loop-shared/result';

import { assertUnder, userWebProfilesDir } from './web-artifact-paths.js';
import { loadPlaywright, type PwBrowser, type PwContext } from './playwright-loader.js';
import { discardStaging, publishState } from './web-login-staging.js';

/**
 * A profile name is ONE path component: LOWER-case letters, digits, dot,
 * underscore and hyphen, 1–64 of them. `..` matches this charset (it is two
 * dots and nothing else), which is exactly why `resolveProfileName`'s
 * dot-segment rejection is not redundant.
 *
 * This describes the CANONICAL form. NTFS and default APFS fold case, so `Work`
 * and `work` are ONE directory on those filesystems; `resolveProfileName`
 * therefore lower-cases what the caller typed and uses the folded result, rather
 * than rejecting a name the caller means perfectly well. The fold is reported
 * back so it is never silent.
 */
export const PROFILE_NAME_RE = /^[a-z0-9._-]{1,64}$/;

/** `.` would collide with the profile ROOT; `..` would climb out of it. */
const DOT_SEGMENTS: ReadonlySet<string> = new Set(['.', '..']);

/**
 * Windows device names, reserved as a path component even with an extension
 * (`con.json` opens the device). A profile that lands on one writes nothing, so
 * a "successful" login would silently persist no session at all.
 */
const RESERVED_DEVICE_NAMES: ReadonlySet<string> = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  ...Array.from({ length: 9 }, (_unused, index) => `com${String(index + 1)}`),
  ...Array.from({ length: 9 }, (_unused, index) => `lpt${String(index + 1)}`)
]);

/**
 * How much of an unvalidated or caller-typed name a message may echo back. A
 * refusal is not a place to reproduce a 1 MB `--profile` (S1's bounded-output
 * invariant), so both the guard here and the CLI's gate refusal cap it with the
 * SAME function.
 */
const MAX_ECHOED_NAME_CHARS = 64;

/** Bound a caller-supplied name before it is embedded in a message. */
export function cappedEcho(raw: string): string {
  return raw.length > MAX_ECHOED_NAME_CHARS ? `${raw.slice(0, MAX_ECHOED_NAME_CHARS)}…` : raw;
}

/**
 * Whether `raw` ends in a dot or a space.
 *
 * Windows strips both, so `work.` has no stable name of its own there — it is
 * the `work` directory. Unlike case, which folds into a name the caller plainly
 * meant, trimming would silently rewrite the name, so this is REJECTED rather
 * than folded.
 */
function hasTrailingDotOrSpace(raw: string): boolean {
  return raw !== raw.replace(/[. ]+$/, '');
}

/** `<homedir>/.peaks/web-profiles/<name>/`. The name must be resolved first. */
export function webProfileDir(name: string): string {
  return join(userWebProfilesDir(), name);
}

/**
 * Validate a caller-supplied `--profile` and return the CANONICAL name — the
 * input lower-cased, which is the one name the filesystem will actually store.
 * `--profile Work` resolves to `work`.
 *
 * The fold is deliberate (user decision, 2026-09-10) and is never silent: the
 * call site compares what it typed with what came back and reports the
 * difference. What has no sensible canonical form is still refused — see
 * `hasTrailingDotOrSpace`.
 *
 * Two refusals are DELIBERATE rather than incidental (S4 repair, security S6):
 *
 *   - a LEADING dot is refused, because it makes `folded.split('.')[0]` empty.
 *     `.con` is the Windows device under a name the stem test cannot see, and
 *     `..foo` is a dot segment that `PROFILE_NAME_RE` accepts — it used to be
 *     stopped by `assertUnder` instead, which surfaced `WEB_PATH_ESCAPE` under
 *     the wrong code. Both now carry this function's own message.
 *   - the caller's input is echoed CAPPED, like the CLI's gate refusal, so a
 *     huge `--profile` cannot be reproduced whole in a message.
 *
 * Throws `WEB_PROFILE_NAME_INVALID`, and returns the NAME rather than a path so
 * a call site cannot mistake one for the other.
 */
export function resolveProfileName(raw: string): string {
  const folded = raw.toLowerCase();
  const deviceName = folded.split('.')[0] ?? '';
  if (
    !PROFILE_NAME_RE.test(folded) ||
    DOT_SEGMENTS.has(folded) ||
    deviceName === '' ||
    hasTrailingDotOrSpace(raw) ||
    RESERVED_DEVICE_NAMES.has(deviceName)
  ) {
    throw new Error(
      `WEB_PROFILE_NAME_INVALID: ${JSON.stringify(cappedEcho(raw))} must match ` +
        `${PROFILE_NAME_RE.source} after lower-casing and must not begin with a dot, be a dot ` +
        'segment, be a Windows device name, or end in a dot or a space'
    );
  }
  assertUnder(webProfileDir(folded), userWebProfilesDir());
  return folded;
}

/**
 * `<homedir>/.peaks/web-profiles/<name>/storageState.json` — the persisted
 * artifact, and the only thing `login` writes.
 */
export function loginStorageStatePath(name: string): string {
  return join(webProfileDir(resolveProfileName(name)), 'storageState.json');
}

/**
 * How long one headed login may stay open. Bounded so an abandoned `login`
 * cannot leave a browser process behind indefinitely; ten minutes is generous
 * for a password plus an MFA round trip.
 */
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * How often the session is read into memory while the window is open. This IS
 * the staleness bound of what gets persisted (see the module docstring): a
 * cookie set after the last read is not in the saved profile.
 */
const LOGIN_SNAPSHOT_MS = 1_000;

/**
 * How long teardown may take before it is REPORTED instead of waited on. The
 * docstring promises an abandoned login cannot hold a browser open forever; an
 * unbounded `browser.close()` in the `finally` is exactly how that promise would
 * be broken (S4 R3). A close that loses this race is not silent — the caller is
 * told the browser may still be running.
 */
const TEARDOWN_TIMEOUT_MS = 5_000;

/**
 * The profile DIRECTORY's mode. The tree holds live session cookies, so it gets
 * the same owner-only treatment the daemon token does
 * (`daemon-registry.ts:24-33`), for a strictly more valuable file. The
 * ARTIFACT's mode — and the plain statement of what these calls are worth on
 * Windows, where they are inert — lives with the write, in
 * `web-login-staging.ts`.
 *
 * On POSIX this one is what it looks like: `mkdirSync(…, {mode: 0o700})` yields
 * 0700 for any umask.
 */
const PROFILE_DIR_MODE = 0o700;

/** The code a completed-but-unreadable capture carries on an `ok` outcome. */
const STATE_UNREADABLE_CODE = 'WEB_LOGIN_STATE_UNREADABLE';

export interface WebLoginOutcome {
  readonly ok: boolean;
  /**
   * `''` when `ok` AND the capture verified; a code when the outcome is a
   * failure, and also when a write landed but could not be read back — an
   * `ok: true` with `bytes > 0` is not the same thing as a usable profile.
   */
  readonly code: string;
  readonly message: string;
  readonly profile: string;
  readonly storageStatePath: string;
  /** Size of the persisted file. 0 whenever nothing was written. */
  readonly bytes: number;
  /** Cookie/origin COUNTS only — never the values (see `readStateCounts`). */
  readonly cookies: number;
  readonly origins: number;
  /** Never silent: a teardown or read-back problem lands here (S1's F1). */
  readonly warnings: readonly string[];
}

export interface WebLoginOptions {
  /** A name that already passed `resolveProfileName`; re-validated here. */
  readonly profile: string;
  /**
   * Called once, with the headed browser already open and before the wait
   * begins. IO belongs to the CLI layer, so the human instruction ("log in,
   * then close the window") is composed there.
   */
  readonly announce: () => void;
  /** Defaults to `LOGIN_TIMEOUT_MS`. A test shortens it; nothing else does. */
  readonly timeoutMs?: number;
}

/**
 * Open the headed browser, read the session into memory while the user works,
 * and persist it when the user closes the window.
 *
 * Everything that happens once the browser is up comes back as `ok: false` with
 * a code rather than a throw. A failure BEFORE that point — an invalid name, an
 * unresolvable Playwright, a launch that will not start — does throw, because
 * there is no browser to tear down and no outcome to describe; the CLI renders
 * it with the same code and the same envelope shape, so the caller sees one
 * contract either way.
 */
export async function runHeadedLogin(options: WebLoginOptions): Promise<WebLoginOutcome> {
  const profile = resolveProfileName(options.profile);
  const dir = webProfileDir(profile);
  const statePath = join(dir, 'storageState.json');
  const timeoutMs = options.timeoutMs ?? LOGIN_TIMEOUT_MS;
  // Taken BEFORE the launch (S4 R3): the bound covers the whole command, not
  // just the wait. Launch, context and page creation are time the user is not
  // getting back, and a docstring claim about not holding a browser open forever
  // has to include them.
  const deadline = performance.now() + timeoutMs;

  const warnings: string[] = [];
  mkdirSync(dir, { recursive: true, mode: PROFILE_DIR_MODE });

  const playwright = await loadPlaywright();
  const browser = await playwright.chromium.launch({ headless: false });
  let closed = false;
  let captured = false;
  let emptyCapture = false;
  let failure: { code: string; message: string } | null = null;
  let state: LoginStateCounts | null = null;
  let readErrorWhileOpen: string | null = null;
  try {
    // The disconnect listener is attached BEFORE the first await (S4 repair,
    // code review F3): `disconnected` is not replayed, so a browser that dies
    // while the context or the page is being created would otherwise be missed,
    // `closed` would stay false, and the wait would spin out the full ten
    // minutes on a browser that is already gone. `isConnected()` is the same
    // defence for a browser that was already dead when the launch returned.
    const disconnect = watchDisconnect(browser);
    const context = await browser.newContext({ acceptDownloads: false });
    await context.newPage();
    options.announce();
    const result = await snapshotUntilClosed(context, disconnect, deadline);
    closed = result.closed;
    captured = result.captured;
    readErrorWhileOpen = result.readErrorWhileOpen;
    // What is in memory IS what was captured: a session never read is never
    // written, whatever else happened.
    if (result.closed && result.captured) {
      // The write site's own guard (tech-doc §7.2 rule 2), on top of the one
      // `resolveProfileName` already ran on the directory.
      assertUnder(statePath, userWebProfilesDir());
      // Nothing captured is not a session (S4 R3, both lenses): publishing it
      // would replace a working profile with an empty one AND report a login
      // that did not happen as a success. Nothing is written, and the outcome
      // below is a failure — so this cannot overwrite an existing profile
      // either. What counts as nothing is BOTH arrays empty (S4 R5): an
      // origins-only state is a localStorage session, not an empty capture.
      if (isEmptyCapture(result.snapshot)) {
        emptyCapture = true;
      } else {
        publishState(statePath, result.snapshot, warnings);
        state = readStateCounts(statePath);
        if (state.failure !== null) {
          warnings.push(`the storage state at ${statePath} could not be read back: ${state.failure}`);
        }
      }
    }
  } catch (error) {
    failure = { code: 'WEB_LOGIN_FAILED', message: getErrorMessage(error) };
    if (captured) {
      // The publish is what can fail here (a lock on the file, no space), and
      // the freshly captured session then lives only in this process's memory
      // and is dropped.
      //
      // The message claims only what this run can verify (S4 R5): our ONLY
      // artifact-touching operation is the rename, and it threw, so THIS RUN did
      // not modify the artifact. The older wording ("is unchanged") asserted
      // something about the file that a concurrent login on the same profile can
      // make false — and, before the staging publish, was false for a single
      // `writeFileSync`, which truncated the artifact at open (S4 R3).
      warnings.push(
        `the session captured for profile "${profile}" was NOT written; this run did not ` +
          `modify ${statePath}`
      );
    }
  } finally {
    // Teardown stays non-blocking but never silent (S1's F1): a browser that
    // will not close — or will not confirm that it did — is reported rather than
    // swallowed, and it is BOUNDED so a wedged close cannot pin the process.
    await closeBounded(browser, timeoutMs, warnings);
    // Every path out: published, refused, empty, timed out, never captured, or
    // thrown. A staging file holds live cookies and must never outlive this run.
    discardStaging(statePath, warnings);
  }

  const stats = state ?? { bytes: 0, cookies: 0, origins: 0, failure: null };
  if (failure !== null) {
    return {
      ok: false,
      code: failure.code,
      message: failure.message,
      profile,
      storageStatePath: statePath,
      ...zeroStats(),
      warnings
    };
  }
  if (!closed) {
    return {
      ok: false,
      code: 'WEB_LOGIN_NOT_CLOSED',
      message:
        `the headed browser for profile "${profile}" was not closed within ` +
        `${String(Math.round(timeoutMs / 1000))} s, so no storage state was written`,
      profile,
      storageStatePath: statePath,
      ...zeroStats(),
      warnings
    };
  }
  if (!captured) {
    // The window closed, but no snapshot was ever taken — nothing was captured,
    // so there is nothing to save and nothing that would make an empty file
    // look like a session.
    //
    // WHY, though, is not always "it closed" (S4 R3). A `storageState()` that
    // keeps failing while the browser is still up — a protocol error, a wedged
    // context — used to be swallowed by a bare `catch` and reported as a close,
    // forever, with the real cause never surfaced. `readErrorWhileOpen` is only
    // set for a read that failed with the browser STILL CONNECTED and with an
    // error that is not the close's own "Target … has been closed" (S4 R5), so a
    // close cannot be mistaken for it — in either ordering.
    const why =
      readErrorWhileOpen === null
        ? 'closed before its session could be read'
        : `never returned a readable session (every attempt failed while it was open: ${readErrorWhileOpen})`;
    return {
      ok: false,
      code: 'WEB_LOGIN_NO_SNAPSHOT',
      message: `the headed browser for profile "${profile}" ${why}, so no storage state was written`,
      profile,
      storageStatePath: statePath,
      ...zeroStats(),
      warnings
    };
  }
  if (emptyCapture) {
    // The window closed and a state WAS read, but it holds NOTHING — neither
    // cookies nor origins. For a verb whose whole purpose is persisting a
    // session that is not a success, and writing it would replace a working
    // profile with a useless one (S4 R3). Nothing was published: nothing was
    // written by this run.
    return {
      ok: false,
      code: 'WEB_LOGIN_EMPTY_SNAPSHOT',
      message:
        `the headed browser for profile "${profile}" was closed but the captured session holds ` +
        'neither cookies nor origins, so no storage state was written — that is not a login',
      profile,
      storageStatePath: statePath,
      ...zeroStats(),
      warnings
    };
  }
  return {
    ok: true,
    // The write landed, so this is not a failure — but an unreadable capture is
    // not a clean success either, and `ok: true, cookies: 0` alone reads as one
    // (R5). The code is what an ok-only consumer cannot miss.
    code: stats.failure === null ? '' : STATE_UNREADABLE_CODE,
    message: '',
    profile,
    storageStatePath: statePath,
    bytes: stats.bytes,
    cookies: stats.cookies,
    origins: stats.origins,
    warnings
  };
}

function zeroStats(): { bytes: number; cookies: number; origins: number } {
  return { bytes: 0, cookies: 0, origins: 0 };
}

/**
 * An empty capture — a parseable storage state that holds NOTHING: no cookies
 * AND no origins. It is not a session, so it is never published and never
 * reported as a success (S4 R3, both lenses).
 *
 * BOTH, not just cookies (S4 R5). A state that keeps its session in `origins`
 * (a localStorage token) is a real, valid storage state, and refusing it made
 * the persistent-login verb unable to persist a non-cookie session. The hazard
 * this refusal exists for is publishing *nothing* over a working profile.
 *
 * A raw-string capture (`stateRaw`) is not an empty one: `typeof` excludes it,
 * so the corrupt-artifact path still reaches the read-back check that reports
 * it. Nor is a MALFORMED one (`{"cookies": 1}`) — the read-back check is what
 * reports that, which is why this reads strictly for two empty arrays.
 */
function isEmptyCapture(snapshot: unknown): boolean {
  if (snapshot === null || typeof snapshot !== 'object') {
    return false;
  }
  const cookies = (snapshot as { cookies?: unknown }).cookies;
  const origins = (snapshot as { origins?: unknown }).origins;
  return (
    Array.isArray(cookies) &&
    cookies.length === 0 &&
    Array.isArray(origins) &&
    origins.length === 0
  );
}

interface DisconnectWatch {
  /** True once the browser has disconnected. */
  readonly closed: () => boolean;
  /** Resolves at the disconnect, so the wait can wake on it rather than on the interval. */
  readonly whenClosed: Promise<void>;
}

/**
 * Watch for the user closing the window (UD-4), from the moment the browser is
 * up — before any other await, because `disconnected` is not replayed.
 *
 * `isConnected()` is consulted FIRST: a browser that is already gone must fail
 * fast rather than run out the timeout, and there is no event left to wait for.
 * Both members are optional on `PwBrowser`, so a browser that cannot report
 * either is treated as never disconnecting — the pre-existing behaviour.
 */
function watchDisconnect(browser: PwBrowser): DisconnectWatch {
  let closed = browser.isConnected?.() === false;
  let settleClosed: () => void = () => undefined;
  const whenClosed = new Promise<void>((settle) => {
    settleClosed = settle;
  });
  if (closed) {
    settleClosed();
  } else {
    browser.on?.('disconnected', () => {
      closed = true;
      settleClosed();
    });
  }
  return { closed: () => closed, whenClosed };
}

/**
 * Read the session into memory every `LOGIN_SNAPSHOT_MS` until the user closes
 * the window, and report how it ended plus the last successful read.
 *
 * The read has to happen WHILE the window is open: once the browser disconnects
 * the non-persistent context (C1) cannot be read at all — `storageState()` then
 * throws "Target page, context or browser has been closed", verified on the
 * pinned playwright@1.63.0. So the state in memory at the moment of disconnect
 * is the LAST read, up to one interval old, and that is the honest staleness
 * bound of the saved profile.
 *
 * MONOTONIC deadline (R8): on wall-clock time a backward NTP/DST/VM-resume step
 * moves the deadline away faster than `now()` advances, `now() >= deadline`
 * never holds, and an abandoned login holds a headed browser open for the rest
 * of the machine's uptime — the opposite of what the bound is for.
 */
async function snapshotUntilClosed(
  context: PwContext,
  disconnect: DisconnectWatch,
  deadline: number
): Promise<CaptureResult> {
  let captured = false;
  let snapshot: unknown = null;
  let readErrorWhileOpen: string | null = null;
  for (;;) {
    const read = await readSession(context);
    if (read.ok) {
      captured = true;
      snapshot = read.state;
    }
    if (disconnect.closed()) {
      return { closed: true, captured, snapshot, readErrorWhileOpen };
    }
    // A failed read the CLOSE cannot explain: the browser is still connected
    // (S4 R3), and the error is not Playwright's own "it is gone" (S4 R5).
    //
    // The check is AFTER the read, not before it, because the rejection can land
    // before the `disconnected` event does — and with the check up front, that
    // ordering recorded a close as a read failure and the outcome blamed the
    // read. The wording check covers what the event still cannot: the error
    // itself says the target is closed (F3).
    if (!read.ok && !read.closedTarget) {
      readErrorWhileOpen = read.error;
    }
    if (performance.now() >= deadline) {
      return { closed: false, captured, snapshot, readErrorWhileOpen };
    }
    // Wakes on the disconnect rather than after the full interval, so closing
    // the window ends the wait (and publishes) without an extra second's delay.
    await Promise.race([sleep(LOGIN_SNAPSHOT_MS), disconnect.whenClosed]);
  }
}

interface CaptureResult {
  /** True when the wait ended because the user closed the window. */
  readonly closed: boolean;
  /** True when at least one in-memory read SUCCEEDED. */
  readonly captured: boolean;
  /** The last successful read. Meaningless unless `captured`. */
  readonly snapshot: unknown;
  /**
   * The last read failure that happened while the browser was STILL CONNECTED —
   * the one the disconnect cannot explain. Null when every failure coincided
   * with (or followed) the close.
   */
  readonly readErrorWhileOpen: string | null;
}

/**
 * One in-memory read of the live session.
 *
 * `storageState()` is called WITHOUT `path`, so the state comes back as an
 * object and is never written anywhere by this call — there is no second
 * on-disk artifact, by construction.
 *
 * A failure here is not news while the window is open — a context that is
 * mid-navigation, or already tearing down, simply keeps the previous snapshot —
 * and a run that never read one reports `WEB_LOGIN_NO_SNAPSHOT` rather than
 * writing an empty session.
 *
 * The error is CARRIED, not swallowed (S4 R3): a bare `catch {}` made a
 * persistent protocol error indistinguishable from the window closing, and the
 * caller was told the browser had closed forever. It is passed through
 * `cappedEcho` for the same reason a refused `--profile` is: it is text this
 * module did not author, and S1's bounded-output invariant does not stop at the
 * strings we write ourselves.
 */
interface SessionRead {
  readonly ok: boolean;
  readonly state: unknown;
  /** The failure as the caller may see it: CAPPED, per S1's bounded output. */
  readonly error: string | null;
  /**
   * Whether the failure is the close's own wording. Decided on the RAW message,
   * before `cappedEcho` cuts it: the wording sits past the cap in Playwright's
   * own `browserContext.storageState: Target page, context or browser has been
   * closed`, so a check on the capped string would miss it [caught by the F3
   * test].
   */
  readonly closedTarget: boolean;
}

async function readSession(context: PwContext): Promise<SessionRead> {
  try {
    return { ok: true, state: await context.storageState(), error: null, closedTarget: false };
  } catch (error) {
    const raw = getErrorMessage(error);
    return { ok: false, state: null, error: cappedEcho(raw), closedTarget: isClosedTargetError(raw) };
  }
}

/**
 * Whether a failed read is EXPLAINED BY THE CLOSE — Playwright's own wording for
 * "the target you asked about is gone" — rather than by a read that genuinely
 * failed while the browser was up.
 *
 * `disconnect.closed()` alone cannot separate the two: the `disconnected` event
 * can still be in flight when the rejection lands, which is how a close came to
 * be reported as "every attempt failed while it was open: Target … has been
 * closed" (S4 R5 / F3). The error's own text is the only other signal a rejected
 * `storageState()` gives, and this is what it says.
 */
function isClosedTargetError(raw: string): boolean {
  return /has been closed|Target closed/i.test(raw);
}

interface LoginStateCounts {
  readonly bytes: number;
  readonly cookies: number;
  readonly origins: number;
  /** Non-null when the file was written but could not be read back. */
  readonly failure: string | null;
}

/**
 * Size plus cookie/origin COUNTS of the state just written.
 *
 * Counts only: the values are exactly what `browser-workflow.md` forbids putting
 * in an artifact, and they would be printed to a terminal here. A read-back that
 * fails is REPORTED rather than swallowed — the write already happened, so the
 * caller must not be told the profile is fine when nothing could be read (S1's
 * F1). It returns zero counts instead of throwing for the same reason: an
 * unreadable file is news, not a reason to lose the path.
 *
 * "Unreadable" includes JSON that parses but is NOT a storage state: a file
 * holding `null`, a string or `{"cookies": 1}` is not a capture, and reporting
 * it as `cookies: 0` with no failure would make a corrupt artifact read exactly
 * like a clean one that merely has no cookies.
 *
 * The failure text is OURS, never the parser's: V8 quotes the head of its input
 * into `JSON.parse`'s message, and that input is a live session cookie value —
 * so the message would carry a fragment of it to the terminal and the
 * transcript. The byte count is the diagnostic instead (S4-3).
 */
function readStateCounts(path: string): LoginStateCounts {
  let bytes = 0;
  try {
    // Kept outside the parse so an unparseable-but-present file still reports
    // the size it really has.
    bytes = statSync(path).size;
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      cookies?: unknown;
      origins?: unknown;
    };
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.cookies) ||
      !Array.isArray(parsed.origins)
    ) {
      return { bytes, ...unreadable(bytes) };
    }
    return { bytes, cookies: parsed.cookies.length, origins: parsed.origins.length, failure: null };
  } catch {
    return { bytes, ...unreadable(bytes) };
  }
}

/** The one refusal shape, so both unreadable branches read the same. */
function unreadable(bytes: number): { cookies: 0; origins: 0; failure: string } {
  return {
    cookies: 0,
    origins: 0,
    failure: `it is not a readable storage state (${String(bytes)} bytes on disk)`
  };
}

/**
 * Close the headed browser, but never wait on it forever.
 *
 * `browser.close()` is a promise the browser can fail to settle — a wedged
 * renderer, a process that was killed but not reaped — and an unbounded `await`
 * in the `finally` is exactly how the module docstring's "cannot hold a browser
 * open forever" would stop being true (S4 R3). So it is raced against a timer:
 * `min(timeoutMs, TEARDOWN_TIMEOUT_MS)` — a test that shortens the login bound
 * shortens teardown with it, a production run gets the constant.
 *
 * Losing the race is REPORTED, never silent. The caller has to know a browser
 * process may still be on the machine, and the close is not retried or waited
 * on: this command is over.
 */
async function closeBounded(browser: PwBrowser, timeoutMs: number, warnings: string[]): Promise<void> {
  const boundMs = Math.min(timeoutMs, TEARDOWN_TIMEOUT_MS);
  let expired = false;
  const bound = sleep(boundMs).then(() => {
    expired = true;
  });
  try {
    // The call is INSIDE the try: a synchronous throw from `close()` must be
    // reported as a teardown warning, not escape and replace the outcome.
    await Promise.race([browser.close(), bound]);
  } catch (error) {
    warnings.push(`the headed browser did not close cleanly: ${getErrorMessage(error)}`);
    return;
  }
  if (expired) {
    warnings.push(
      `the headed browser did not report closed within ${String(boundMs)} ms; it may still be running`
    );
  }
}

/**
 * The interval timer is `unref`'d: whenever the disconnect wins the race (the
 * common case) the timeout is orphaned, and an orphan that holds the event loop
 * would keep the `peaks web login` process alive up to one interval past the
 * command having logically finished (code review F4). It still fires normally
 * while the process is alive, which is all the race needs.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((settle) => {
    const timer = setTimeout(() => {
      settle();
    }, ms);
    timer.unref?.();
  });
}
