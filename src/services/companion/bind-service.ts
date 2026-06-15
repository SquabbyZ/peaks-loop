/**
 * Slice 2026-06-14-cc-connect-weixin (BUG 8) — manual token injection
 * for cc-connect's weixin platform.
 *
 * Background
 * ----------
 * Path A (QR scan) is unreliable for new installations because:
 *
 *   1. WeChat's liteapp webview shows `无法打开页面` with
 *      `net::ERR_UNKNOWN_URL_SCHEME` when cc-connect hands it the
 *      `ilink://...` URL.
 *   2. iLink (`ilinkai.weixin.qq.com`) is intermittently unreachable
 *      with `net/http: TLS handshake timeout` from some regions.
 *   3. The QR session expires in ~2 minutes, which is often too
 *      short for a user to scan + tap "确认" + debug network errors.
 *
 * Path B is the existing escape hatch: pass a previously-acquired
 * iLink bearer token (`<botid>@im.bot:<secret>`) to
 * `cc-connect weixin bind --token <bearer>`, and cc-connect writes
 * `token = "<bearer>"` into `[projects.platforms.options]` of
 * `~/.cc-connect/config.toml`. The user's daemon then connects
 * immediately, no QR required.
 *
 * Until now path B was only reachable by a user who already knew
 * the `cc-connect weixin bind` subcommand. This service makes path B
 * a first-class peaks CLI surface so new users can:
 *
 *   - `peaks companion token <bearer>` — bind a token to the
 *     canonical `~/.cc-connect/config.toml` (or whatever home
 *     peaks-cli is configured for).
 *   - `peaks companion token` (no arg) — read the current token
 *     (masked by default; `--reveal` to dump the raw bearer).
 *   - `peaks companion setup --token <bearer>` — short-circuit the
 *     QR render path; bind and skip directly to `peaks companion
 *     start`.
 *
 * What this service does NOT do
 * -----------------------------
 *   - It does not modify `~/.peaks/config.json#companion` itself
 *     (peaks config is the source of truth for *binary* path /
 *     enabled / ilink QR payload; the ilink token belongs to
 *     `~/.cc-connect/config.toml` because that's where cc-connect
 *     reads it from).
 *   - It does not spawn a daemon. `peaks companion start` is the
 *     daemon owner (slice 2 / BUG 6). After `bindWeixinToken`
 *     succeeds, the user runs `peaks companion start` (or the
 *     short-circuit path in `setup-service.ts` does it for them).
 *   - It does not validate that `<bearer>` is a real iLink token.
 *     cc-connect will reject bogus tokens on its next getUpdates
 *     call (and we surface the exit code). Use `--skip-verify` to
 *     bypass getUpdates (rare; mostly for tests).
 *
 * File size
 * ---------
 * Per the peaks-cli style guide (`.claude/rules/common/coding-style.md`),
 * this file is kept under the 800-line hard cap. It is split into
 * the four public functions below plus a small spawn helper.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolveCcConnectAny } from './cc-connect-resolver.js';
import { ccConnectConfigFile } from './config-template.js';

/**
 * Public result of a bind attempt. Returned by
 * `bindWeixinToken` and surfaced verbatim by
 * `peaks companion token --json` and
 * `peaks companion setup --token ... --json`.
 *
 * Field semantics:
 *   - `ok`           : true when cc-connect exited 0 AND the
 *                       `token = "..."` line was found in
 *                       `~/.cc-connect/config.toml` after the
 *                       bind. This is a strict post-condition; we
 *                       verify on disk, not just on exit code
 *                       (cc-connect can exit 0 but never write the
 *                       token if it failed earlier in argv parse).
 *   - `bound`        : mirrors `ok` for callers that want a
 *                       dedicated field (the contract spec asked
 *                       for `bound: true` in the success JSON).
 *   - `binaryPath`   : absolute path to the cc-connect binary
 *                       (the resolver's choice; null on failure).
 *   - `configPath`   : absolute path to
 *                       `~/.cc-connect/config.toml` (the file the
 *                       token was written to).
 *   - `stdout`       : cc-connect's stdout (trimmed). Useful for
 *                       debugging failed binds; not surfaced in
 *                       --json (too noisy).
 *   - `stderr`       : cc-connect's stderr (trimmed). Same.
 *   - `error`        : human-readable error string; null on success.
 *   - `code`         : cc-connect's exit code (-1 on spawn error).
 *   - `nextActions`  : the standard "what now?" hints; empty on
 *                       success.
 */
export type BindTokenResult = {
  ok: boolean;
  bound: boolean;
  binaryPath: string | null;
  configPath: string;
  stdout: string;
  stderr: string;
  error: string | null;
  code: number;
  nextActions: string[];
};

/**
 * Read-only snapshot of the current weixin token. Returned by
 * `readBoundToken`. The bearer is *masked* by default; the raw
 * bearer is only included when `reveal: true` is set, so a casual
 * `peaks companion token --json` won't leak the secret into
 * automation logs.
 *
 * Masking rules:
 *   - Take everything up to (but not including) the first colon
 *     (e.g. `825d03f9b830@im.bot:0600...`).
 *   - Append `':****'` (four stars) so the JSON consumer can tell
 *     the field is masked without losing the botid prefix.
 *
 * Why a prefix + `****`? Two reasons:
 *   1. The botid (`<id>@im.bot`) is the only piece the user
 *      needs to identify which WeChat bot is bound (handy when
 *      they have multiple installations on the same machine).
 *   2. The user can grep for their botid in any process list
 *      (e.g. `lsof | grep 825d03f9b830`) without ever seeing the
 *      secret.
 */
export type BoundTokenSnapshot = {
  bound: boolean;
  /** Resolved path to the config file we read from. */
  configPath: string;
  /** Bot-id prefix (`<botid>@im.bot`) when bound; null otherwise. */
  botid: string | null;
  /** Masked bearer (`<botid>@im.bot:****`) when bound; null otherwise. */
  maskedToken: string | null;
  /** Raw bearer — only set when `reveal: true` is passed. */
  rawToken: string | null;
  /** True when the file exists but no `token = "..."` line was found. */
  configPresent: boolean;
  error: string | null;
};

/** Default project name. Mirrors the slice 3 default in
 *  `config-template.ts#DEFAULT_PROJECT_NAME`. Kept inline so this
 *  service has no upward dependency on config-template. */
const DEFAULT_PROJECT_NAME = 'default';

/** Sentinel that we replace the bearer with in masked mode. */
const MASK_SUFFIX = ':****';

/** Substring scan: a `token = "..."` line inside the weixin
 *  platform options block. We do not parse the TOML fully because
 *  (a) it would pull a TOML parser into the bind path for a single
 *  string, and (b) cc-connect's own writer uses a stable
 *  `token = "<value>"` shape. The regex tolerates leading
 *  whitespace, single or double quotes, and the `token =` /
 *  `token=` spacing variants we have observed in cc-connect 1.3.x.
 *
 *  Group 1 captures the raw token value (without the surrounding
 *  quotes).*/
const TOKEN_LINE_REGEX = /^[ \t]*token[ \t]*=[ \t]*"([^"\n]+)"[ \t]*$/m;

/** Default spawn for `cc-connect weixin bind`. Inherits stdio so
 *  the user sees cc-connect's own progress lines on the terminal
 *  (no QR is rendered by `bind`, so the BUG 7 TTY-inherit pattern
 *  from setup-service.ts carries over verbatim). For a single
 *  short-lived bind call this is what the user wants. */
export type BindSpawnResult = { stdout: string; stderr: string; code: number };
export type BindSpawnFn = (binaryPath: string, args: readonly string[]) => Promise<BindSpawnResult>;

export function defaultBindSpawn(binaryPath: string, args: readonly string[]): Promise<BindSpawnResult> {
  return new Promise((resolve) => {
    // Capture stdout/stderr through pipes (instead of inherit) so
    // tests and JSON consumers can read the binary's output. The
    // setup-service uses `inherit` for its spawn (BUG 7) because
    // the user needs the ASCII QR in their terminal; the bind
    // subcommand does NOT render a QR, so piping is safe and
    // lets us still show the user a short progress line via
    // `io.stdout` from the CLI layer.
    const child = spawn(binaryPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    });
    child.on('error', (err) => {
      resolve({ stdout, stderr: `${stderr}${err.message}`, code: -1 });
    });
    child.on('close', (code) => {
      resolve({ stdout, stderr, code: code ?? -1 });
    });
  });
}

/**
 * Validate the bearer shape. cc-connect's `--token` argument
 * expects a single string. We don't validate the format (cc-connect
 * itself is the source of truth on the iLink side) but we do refuse
 * empty strings and obviously-wrong values to fail fast at the
 * peaks CLI surface instead of waiting for cc-connect's argv parser
 * to complain.
 */
export function validateBearer(token: string): { ok: boolean; error: string | null } {
  if (typeof token !== 'string') {
    return { ok: false, error: 'bearer must be a string' };
  }
  if (token.length === 0) {
    return { ok: false, error: 'bearer is empty' };
  }
  if (token.length > 512) {
    return { ok: false, error: 'bearer is too long (>512 chars); this is almost certainly a copy/paste error' };
  }
  // Whitespace inside a token is a strong signal of a bad copy/paste.
  if (/\s/.test(token)) {
    return { ok: false, error: 'bearer contains whitespace; wrap the whole token in single quotes if you really mean to pass spaces' };
  }
  return { ok: true, error: null };
}

/**
 * Inject a weixin ilink bearer into `~/.cc-connect/config.toml` via
 * `cc-connect weixin bind --project <project> --token <bearer> [--api-url <url>] [--platform-index <n>] [--skip-verify]`.
 *
 * On success: re-reads the config to confirm the `token = "..."`
 * line was actually written, then returns `{ok: true, bound: true, ...}`.
 *
 * On failure: returns a structured error with cc-connect's exit
 * code, stderr, and the standard `nextActions` hints.
 */
export async function bindWeixinToken(options: {
  token: string;
  project?: string;
  apiUrl?: string;
  platformIndex?: number;
  skipVerify?: boolean;
  /** Test seam. Override the spawn implementation. */
  spawn?: BindSpawnFn;
  /** Test seam. Override the resolver. */
  resolveBinary?: typeof resolveCcConnectAny;
  /** Test seam. Override the home dir used for the config path. */
  home?: string;
} = { token: '' }): Promise<BindTokenResult> {
  const home = options.home ?? homedir();
  const configPath = ccConnectConfigFile(home);
  const result: BindTokenResult = {
    ok: false,
    bound: false,
    binaryPath: null,
    configPath,
    stdout: '',
    stderr: '',
    error: null,
    code: -1,
    nextActions: []
  };

  // Bearer validation up front. cc-connect's argv parser will
  // reject empty / whitespace tokens, but it's friendlier to fail
  // here with a clear message and a single suggestion ("wrap in
  // single quotes").
  const check = validateBearer(options.token);
  if (!check.ok) {
    result.error = check.error;
    result.nextActions = ['pass a non-empty iLink bearer, e.g. `peaks companion token <botid>@im.bot:<secret>`'];
    return result;
  }

  const project = (options.project ?? DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME;
  const resolveFn = options.resolveBinary ?? resolveCcConnectAny;
  const resolved = resolveFn({});
  if (resolved === null) {
    result.error = 'cc-connect binary not found (checked node_modules/.bin, require.resolve, and PATH)';
    result.nextActions = ['run `peaks companion install` first, then re-run `peaks companion token`'];
    return result;
  }
  // `resolved` may be a ResolvedCcConnect or a fake; the only
  // required field for the bind path is `binaryPath`.
  result.binaryPath = resolved.binaryPath;

  // Build argv. Order matches the order cc-connect's `--help`
  // prints (subcommand, then subcommand flags), so it's stable
  // against cc-connect version drift.
  const args: string[] = ['weixin', 'bind', '--project', project, '--token', options.token];
  if (typeof options.platformIndex === 'number' && Number.isFinite(options.platformIndex) && options.platformIndex >= 0) {
    args.push('--platform-index', String(Math.floor(options.platformIndex)));
  }
  if (typeof options.apiUrl === 'string' && options.apiUrl.trim().length > 0) {
    args.push('--api-url', options.apiUrl.trim());
  }
  if (options.skipVerify === true) {
    args.push('--skip-verify');
  }

  const spawnFn = options.spawn ?? defaultBindSpawn;
  const spawned = await spawnFn(resolved.binaryPath, args);
  result.stdout = spawned.stdout.trim();
  result.stderr = spawned.stderr.trim();
  result.code = spawned.code;

  if (spawned.code !== 0) {
    result.error = spawned.stderr.trim().length > 0
      ? `cc-connect bind failed: ${spawned.stderr.trim()}`
      : `cc-connect bind failed with exit code ${spawned.code}`;
    result.nextActions = [
      'verify the bearer is correct (`peaks companion token` shows the bound botid prefix)',
      're-run with `--skip-verify` to bypass getUpdates if the network is blocked'
    ];
    return result;
  }

  // Strict post-condition: cc-connect exited 0, but did it actually
  // write the token? Re-read the config and look for the line.
  // (cc-connect writes the token before exiting 0, but a corrupt
  // --api-url or a pre-existing config with a different platform
  // index can swallow the write silently.)
  if (!existsSync(configPath)) {
    result.error = `cc-connect exited 0 but ${configPath} does not exist; the bind likely failed silently`;
    result.nextActions = ['check `peaks companion status` and inspect the cc-connect log'];
    return result;
  }
  const snapshot = readBoundTokenFromDisk(configPath, { reveal: false });
  if (snapshot.bound !== true) {
    result.error = `cc-connect exited 0 but no \`token = "..."\` line was found in ${configPath}; the bind likely failed silently`;
    result.nextActions = ['check `peaks companion status` and inspect the cc-connect log'];
    return result;
  }

  result.ok = true;
  result.bound = true;
  return result;
}

/**
 * Read the current weixin token from `~/.cc-connect/config.toml`.
 * Returns a snapshot with the botid prefix visible and the secret
 * masked. Pass `reveal: true` to include the raw bearer (intentionally
 * a separate, explicit flag — the user has to opt into the secret).
 *
 * The function is intentionally read-only and never throws. A
 * missing config file returns `{bound: false, error: null, ...}`
 * with `configPresent: false` so the CLI can render a friendly
 * "no token bound" state instead of an exception.
 */
export function readBoundToken(options: { home?: string; reveal?: boolean } = {}): BoundTokenSnapshot {
  const home = options.home ?? homedir();
  const configPath = ccConnectConfigFile(home);
  const reveal = options.reveal === true;
  if (!existsSync(configPath)) {
    return {
      bound: false,
      configPath,
      botid: null,
      maskedToken: null,
      rawToken: null,
      configPresent: false,
      error: null
    };
  }
  return readBoundTokenFromDisk(configPath, { reveal });
}

/** Lower-level disk reader; takes the resolved config path
 *  directly. Exported so tests can drive it with fixture files
 *  without touching the real `~/.cc-connect/`. */
export function readBoundTokenFromDisk(configPath: string, options: { reveal?: boolean } = {}): BoundTokenSnapshot {
  const reveal = options.reveal === true;
  const base: BoundTokenSnapshot = {
    bound: false,
    configPath,
    botid: null,
    maskedToken: null,
    rawToken: null,
    configPresent: existsSync(configPath),
    error: null
  };
  if (!existsSync(configPath)) {
    return { ...base, configPresent: false };
  }
  let body: string;
  try {
    body = readFileSync(configPath, 'utf8');
  } catch (err) {
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }
  const match = TOKEN_LINE_REGEX.exec(body);
  if (match === null || match[1] === undefined) {
    return { ...base, configPresent: true };
  }
  const token = match[1];
  const colon = token.indexOf(':');
  const botid = colon >= 0 ? token.slice(0, colon) : token;
  return {
    bound: true,
    configPath,
    botid,
    maskedToken: `${botid}${MASK_SUFFIX}`,
    rawToken: reveal ? token : null,
    configPresent: true,
    error: null
  };
}
