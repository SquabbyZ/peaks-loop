/**
 * Slice 2026-06-14-cc-connect-weixin (slice 3 + change-1 + BUG 8) — `peaks companion setup`
 * orchestration. Two pipelines are supported:
 *
 * Path A (legacy, the default — peaks config has no ilink token yet):
 *   1. (Optional) Confirm overwrite when `~/.cc-connect/config.toml`
 *      already exists (AC7: zero state pollution).
 *   2. Render + write the weixin-only `config.toml` from the typed
 *      `CompanionConfig` block in `~/.peaks/config.json` (change-1:
 *      peaks config is the source of truth).
 *   3. Spawn the cc-connect weixin setup flow in the background
 *      (the binary handles iLink QR generation + state-machine
 *      progress). peaks polls `~/.cc-connect/state.json` to map
 *      the binary's internal state to user-friendly progress text.
 *   4. On `logged-in` we close the foreground spawn, hand off to
 *      `peaks companion start` (the daemon), and return success.
 *   5. On timeout (default 60s, configurable via `--timeout`; the
 *      canonical default lives in `companion.weixin.loginTimeoutSec`
 *      and may be overridden here for one-off flows) we close the
 *      foreground spawn, leave the binary in its current state,
 *      and return a recoverable error per AC10.
 *
 * Path B (BUG 8 — `--token <bearer>` short-circuit):
 *   The QR scan path (Path A) is unreliable for new users because
 *   WeChat's liteapp webview rejects the `ilink://` scheme and
 *   the iLink backend is intermittently unreachable. When the user
 *   already has an iLink bearer token (from OpenClaw, a friend's
 *   installation, a previous successful scan, etc.), they can skip
 *   the QR entirely:
 *   1. Skip the config-render step (`bindToken` already implies the
 *      config exists or will be written by `cc-connect weixin
 *      setup` when given `--token`).
 *   2. Spawn `cc-connect weixin setup --project <p> --token <bearer>`
 *      in a single shot — no polling for "logged-in" (cc-connect
 *      with `--token` does not produce a login state machine; it
 *      writes the token and exits).
 *   3. Hand off to `peaks companion start`.
 *
 * The QR is rendered via `qrcode-terminal` (per the PRD: "use
 * qrcode-terminal for the iLink QR"). The QR payload is the
 * `companion.weixin.ilinkQrPayload` from peaks config (change-1).
 * Path B does NOT render the QR (it would be wasted output; the
 * user is skipping the scan).
 */
import { spawn, type StdioOptions } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { renderCompanionConfig, renderWeixinConfig, writeCcConnectConfig, readCcConnectConfig, detectNonWeixinPlatforms, ccConnectConfigFile } from './config-template.js';
import { readCcConnectState } from './state-parser.js';
import { COMPANION_PAIRING_LABELS, type CompanionPairingState } from './companion-types.js';
import { probeCcConnect } from './cc-connect-resolver.js';
import { writeBinaryPathCache, companionHomeDir } from './binary-cache.js';
import { startCcConnect } from './lifecycle-service.js';
import { bindWeixinToken } from './bind-service.js';
import { DEFAULT_COMPANION_CHANNEL, type CompanionChannel } from './companion-types.js';
import { getErrorMessage } from '../../shared/result.js';
import type { CompanionConfig } from '../config/config-types.js';
import { resolveQrRenderer } from './qr-renderers.js';
import { openInDefaultApp, type OpenResult } from './qr-autoopen.js';

export const DEFAULT_SETUP_TIMEOUT_MS = 60_000;
const PROGRESS_POLL_INTERVAL_MS = 1_000;
export const DEFAULT_QR_IMAGE_FILENAME = 'qr.png';
/**
 * cc-connect's weixin-setup prints an iLink URL line alongside the QR
 * (e.g. `iLink URL: ilink://peaks-cli?project=...`). Capturing it lets
 * peaks-cli surface the URL in non-TTY / --json mode so the user (or
 * an LLM driving the slice) can copy/paste it.
 */
const ILINK_URL_REGEX = /iLink URL:\s*(\S+)/i;

export type QrRenderer = (qrPayload: string) => Promise<void> | void;

export type SetupState = {
  channel: CompanionChannel;
  binaryPath: string | null;
  configPath: string;
  configWritten: boolean;
  configPreserved: boolean;
  configWarnings: string[];
  qrRendered: boolean;
  /**
   * iLink URL captured from cc-connect's stdout (e.g.
   * `ilink://peaks-cli?project=team-bot`). Populated only when
   * peaks-cli captured cc-connect's stdio (non-TTY / --json mode);
   * in TTY mode the binary inherits the user's terminal directly
   * and this remains null.
   */
  iLinkUrl: string | null;
  /**
   * Path cc-connect was asked to write the QR PNG to (via
   * `--qr-image <path>`). The file is regenerated on every setup run;
   * users can AirDrop / scan it from this stable path.
   * Populated only when peaks-cli captured cc-connect's stdio
   * (non-TTY / --json mode); in TTY mode the binary inherits the
   * user's terminal directly and this remains null.
   */
  qrPath: string | null;
  pairing: CompanionPairingState;
  pairingLabel: string;
  startedDaemon: boolean;
  daemonPid: number | null;
  timeoutMs: number;
  durationMs: number;
  /**
   * BUG 8 (Path B): true when the orchestrator used the
   * `--token` short-circuit. When true, `qrRendered` is false,
   * `pairing` is `'logged-in'` (we never polled for it), and
   * `bindResult` carries the raw bind-service payload.
   */
  bound: boolean;
  bindError: string | null;
  error: string | null;
  nextActions: string[];
};

export type SetupOptions = {
  /** Override the timeout (default 60_000 ms). */
  timeoutMs?: number;
  /** Skip the overwrite confirmation prompt (test seam). */
  forceOverwrite?: boolean;
  /** Custom QR renderer. Default uses qrcode-terminal. */
  qrRenderer?: QrRenderer;
  /**
   * 2026-06-15-qr-inline-display: explicit `--qr-inline` flag.
   * When true, forces the markdown-image renderer regardless of
   * env auto-detect. Wins over `qrAscii` and over CLAUDE_CODE.
   */
  qrInline?: boolean;
  /**
   * 2026-06-15-qr-inline-display: explicit `--qr-ascii` flag.
   * When true, forces the legacy qrcode-terminal small-ASCII
   * renderer. Wins over CLAUDE_CODE.
   */
  qrAscii?: boolean;
  /**
   * 2026-06-15-qr-inline-display: process-env override used by
   * the renderer resolver. Defaults to `process.env`. Test seam.
   */
  env?: NodeJS.ProcessEnv;
  /** Custom spawn for the cc-connect weixin setup flow (test seam). */
  spawnSetup?: (binaryPath: string, args: readonly string[]) => { kill: () => void; pid: number | null; child?: unknown };
  /** Inject a custom state-reader (test seam). */
  stateReader?: (home?: string) => ReturnType<typeof readCcConnectState>;
  /** Inject probeCcConnect (test seam). */
  probe?: typeof probeCcConnect;
  /** Inject startCcConnect (test seam). */
  start?: typeof startCcConnect;
  /** Inject writeBinaryPathCache (test seam). */
  cacheWriter?: typeof writeBinaryPathCache;
  /** Inject render+writeCcConnectConfig (test seam). */
  configWriter?: typeof writeCcConnectConfig;
  /** Inject renderWeixinConfig (test seam). */
  configRenderer?: typeof renderWeixinConfig;
  /** Inject renderCompanionConfig (test seam). */
  companionRenderer?: typeof renderCompanionConfig;
  /** Inject the prompt function for overwrite confirmation (test seam). */
  prompt?: (question: string) => Promise<boolean>;
  /** Project name for the cc-connect config. */
  projectName?: string;
  /** Home dir for tests. */
  home?: string;
  /** Allow-list of WeChat user IDs. */
  allowFrom?: string;
  /** Typed peaks config (slice change-1). When supplied, peaks config is
   *  the source of truth and `projectName` / `allowFrom` are ignored. */
  companionConfig?: CompanionConfig;
  /**
   * Override the path passed to cc-connect's `--qr-image` argument.
   * When unset and `qrImageDisabled` is false, the CLI defaults to
   * `~/.peaks/companion/qr.png`. Pass `null` to skip the default
   * resolution; use `qrImageDisabled: true` to opt out entirely.
   */
  qrImagePath?: string | null;
  /**
   * Explicitly disable the QR PNG output (CLI `--no-qr-image`). When
   * true, no `--qr-image` argument is passed to cc-connect and
   * `state.qrPath` remains null.
   */
  qrImageDisabled?: boolean;
  /**
   * BUG 8 (Path B): when set, skip the QR render + pairing
   * poll loop and forward `--token <bindToken>` to
   * `cc-connect weixin setup --project <p> --token <bindToken>`
   * in a single shot. The QR PNG is also skipped (we don't have
   * a payload to encode; the user already has a token).
   */
  bindToken?: string;
  /**
   * BUG 8 (Path B): optional `--api-url <url>` forwarded to
   * cc-connect. Useful for users in regions where
   * `ilinkai.weixin.qq.com` is blocked; they can point at a
   * proxy or alternate endpoint.
   */
  bindApiUrl?: string;
  /**
   * BUG 8 (Path B): optional `--skip-verify` forwarded to
   * cc-connect. Skips the post-bind getUpdates check.
   */
  bindSkipVerify?: boolean;
  /**
   * BUG 8 (Path B, test seam): override the bind execution. The
   * default uses `bindWeixinToken` from `./bind-service.js`.
   * Tests inject a fake to avoid spawning cc-connect.
   */
  bindRunner?: (options: {
    token: string;
    project: string;
    apiUrl?: string;
    skipVerify?: boolean;
    home?: string;
  }) => Promise<{ ok: boolean; bound: boolean; error: string | null }>;
  /**
   * 2026-06-15 follow-up (auto-open QR): when true (default), the
   * orchestrator will auto-open the QR PNG produced by cc-connect
   * (the `--qr-image` file) in the user's default image viewer after
   * cc-connect has written it. On macOS this pops Preview; on Windows
   * it opens Photos / the default PNG handler; on Linux it invokes
   * xdg-open. Set to false for CI, headless servers, or test runs.
   *
   * Set `autoOpener` to a custom function to override the platform
   * `open` (test seam).
   */
  autoOpenQr?: boolean;
  /**
   * Test seam: override the auto-open implementation. Default uses
   * `openInDefaultApp` from `./qr-autoopen.js`. Tests inject a no-op
   * to avoid spawning a child process in unit tests.
   */
  autoOpener?: (filePath: string) => Promise<OpenResult>;
};

/** Default QR renderer: delegates to qrcode-terminal. */
export async function defaultQrRenderer(qrPayload: string): Promise<void> {
  const { default: qrcodeTerminal } = await import('qrcode-terminal');
  return new Promise<void>((resolve) => {
    qrcodeTerminal.generate(qrPayload, { small: true }, (qr: string) => {
      // eslint-disable-next-line no-console
      process.stdout.write(qr + '\n');
      resolve();
    });
  });
}

/**
 * Pick the stdio mode for the cc-connect setup spawn based on
 * whether peaks-cli is running in an interactive TTY.
 * BUG 2026-06-14-cc-connect-weixin#7: when running in a TTY,
 * inherit stdio so cc-connect's ASCII QR (qrcode-terminal) renders
 * directly to the user's terminal. When stdio is piped (CI, scripts,
 * --json), keep `pipe` so the orchestrator can still extract the
 * iLink URL via the regex scanner.
 */
export function setupStdioForTty(isTty: boolean | undefined): StdioOptions {
  return isTty === true
    ? ['ignore', 'inherit', 'inherit']
    : ['ignore', 'pipe', 'pipe'];
}

/** Default spawn for the cc-connect weixin setup flow. */
export function defaultSpawnSetup(binaryPath: string, args: readonly string[]): { kill: () => void; pid: number | null; child?: unknown } {
  // BUG 2026-06-14-cc-connect-weixin#7: see `setupStdioForTty`.
  const stdio = setupStdioForTty(process.stdout.isTTY);
  const child = spawn(binaryPath, [...args], { stdio });
  // In pipe mode, capture the iLink URL by tailing stdout. We
  // attach a single data listener and stash the first URL match.
  // The listener does not interfere with the spawn lifecycle
  // (kill/SIGTERM still works the same way).
  if (process.stdout.isTTY !== true && child.stdout !== null) {
    let buffer = '';
    let captured: string | null = null;
    child.stdout.on('data', (chunk: Buffer | string) => {
      if (captured !== null) return;
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const match = ILINK_URL_REGEX.exec(buffer);
      if (match !== null && match[1] !== undefined) {
        captured = match[1];
      }
    });
    child.on('close', () => {
      // Best-effort: try the buffer one more time in case the URL
      // arrived in a final chunk we already consumed.
      if (captured === null) {
        const match = ILINK_URL_REGEX.exec(buffer);
        if (match !== null && match[1] !== undefined) {
          captured = match[1];
        }
      }
    });
    // Stash on the ChildProcess so callers that hold a reference
    // to it can read the captured URL. The orchestrator in
    // `runCompanionSetup` calls `readIlinkUrl` after the polling
    // loop to populate `state.iLinkUrl`.
    (child as { __ilinkUrl?: { value: string | null } }).__ilinkUrl = {
      get value(): string | null { return captured; }
    };
  }
  return {
    kill: () => {
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
    },
    pid: typeof child.pid === 'number' ? child.pid : null,
    child
  };
}

/**
 * Reads the captured iLink URL from a ChildProcess spawn handle
 * produced by `defaultSpawnSetup`. Returns null when no URL was
 * captured (TTY mode, no match yet, or non-default spawn seam).
 * Exported for the orchestrator in `runCompanionSetup` and for
 * tests that want to assert pipe-mode capture.
 */
export function readIlinkUrl(child: unknown): string | null {
  if (child === null || typeof child !== 'object') return null;
  const stash = (child as { __ilinkUrl?: { value: string | null } }).__ilinkUrl;
  return stash?.value ?? null;
}

const DEFAULT_PROMPT_QUESTION = 'About to overwrite the existing ~/.cc-connect/config.toml. Continue? [Y/n]';

/**
 * The default prompt. We resolve to `true` (continue) in a non-TTY
 * environment (CI, sub-process) so the setup flow remains
 * non-blocking. The CLI overrides this with a real readline prompt.
 */
export async function defaultPrompt(_question: string): Promise<boolean> {
  return true;
}

/**
 * BUG 8 (Path B) — default bind runner used by `runCompanionSetup`
 * when the user passes `--token`. Wraps the bind-service call into
 * a small async signature that the orchestrator can swap out in
 * tests via the `bindRunner` SetupOption.
 */
export type BindRunnerOptions = {
  token: string;
  project: string;
  apiUrl?: string;
  skipVerify?: boolean;
  home?: string;
};
export type BindRunnerResult = { ok: boolean; bound: boolean; error: string | null };
export type BindRunner = (options: BindRunnerOptions) => Promise<BindRunnerResult>;
export async function defaultBindRunner(options: BindRunnerOptions): Promise<BindRunnerResult> {
  const result = await bindWeixinToken({
    token: options.token,
    project: options.project,
    ...(options.apiUrl !== undefined ? { apiUrl: options.apiUrl } : {}),
    ...(options.skipVerify === true ? { skipVerify: true } : {}),
    ...(options.home !== undefined ? { home: options.home } : {})
  });
  return { ok: result.ok, bound: result.bound, error: result.error };
}

/**
 * Top-level orchestrator. Returns a SetupState (also used as the
 * JSON payload for `peaks companion setup --json`).
 */
export async function runCompanionSetup(options: SetupOptions = {}): Promise<SetupState> {
  const started = Date.now();
  const home = options.home;
  // Slice change-1: prefer the typed peaks-config timeout when no
  // explicit override is supplied. Falls back to the legacy
  // DEFAULT_SETUP_TIMEOUT_MS when neither is set.
  const timeoutMs = options.timeoutMs
    ?? (options.companionConfig !== undefined
      ? options.companionConfig.weixin.loginTimeoutSec * 1000
      : DEFAULT_SETUP_TIMEOUT_MS);
  const probeFn = options.probe ?? probeCcConnect;
  const startFn = options.start ?? startCcConnect;
  const cacheWriter = options.cacheWriter ?? writeBinaryPathCache;
  const configWriter = options.configWriter ?? writeCcConnectConfig;
  const configRenderer = options.configRenderer ?? renderWeixinConfig;
  const stateReader: (h?: string) => ReturnType<typeof readCcConnectState> = options.stateReader ?? ((h?: string) => readCcConnectState(h ?? process.env['HOME']));
  const promptFn = options.prompt ?? defaultPrompt;
  // 2026-06-15-qr-inline-display: prefer the test seam
  // (`options.qrRenderer`) when supplied; otherwise resolve via
  // flag > env > default. Path B (bindToken) bypasses this entirely
  // because the renderer call lives below the bind short-circuit.
  const qrRenderer = options.qrRenderer ?? resolveQrRenderer({
    ...(options.qrInline === true ? { qrInline: true } : {}),
    ...(options.qrAscii === true ? { qrAscii: true } : {}),
    ...(options.env !== undefined ? { env: options.env } : {})
  });
  const spawnSetup = options.spawnSetup ?? defaultSpawnSetup;

  const state: SetupState = {
    channel: DEFAULT_COMPANION_CHANNEL,
    binaryPath: null,
    configPath: ccConnectConfigFile(home),
    configWritten: false,
    configPreserved: false,
    configWarnings: [],
    qrRendered: false,
    iLinkUrl: null,
    qrPath: null,
    pairing: 'unknown',
    pairingLabel: COMPANION_PAIRING_LABELS['unknown'],
    startedDaemon: false,
    daemonPid: null,
    timeoutMs,
    durationMs: 0,
    error: null,
    nextActions: [],
    bound: false,
    bindError: null
  };

  // BUG 8 (Path B): when --token is supplied, short-circuit
  // the QR / config-render / polling pipeline. We bind the token
  // via the bind-service (single cc-connect spawn) and, on
  // success, hand off to the daemon. The QR / config renderer /
  // state-reader / prompt paths below are all skipped.
  if (typeof options.bindToken === 'string' && options.bindToken.length > 0) {
    const bindFn = options.bindRunner ?? defaultBindRunner;
    const bindResult = await bindFn({
      token: options.bindToken,
      project: options.projectName ?? 'default',
      ...(options.bindApiUrl !== undefined ? { apiUrl: options.bindApiUrl } : {}),
      ...(options.bindSkipVerify === true ? { skipVerify: true } : {}),
      ...(home !== undefined ? { home } : {})
    });
    // binaryPath comes from the bind-service's resolver; we surface
    // it on `state.binaryPath` so the JSON payload stays consistent
    // with the QR-path shape. The bind-service has already verified
    // the resolver succeeded (it returns ok=false otherwise).
    state.binaryPath = null;
    if (bindResult.ok) {
      const probe = await probeFn();
      if (probe.ok && probe.binaryPath !== null) {
        state.binaryPath = probe.binaryPath;
      }
    }
    if (!bindResult.ok) {
      state.error = bindResult.error ?? 'manual token bind failed';
      state.bindError = state.error;
      state.nextActions = [
        'verify the bearer is correct (should be `<botid>@im.bot:<secret>`)',
        're-run with `--skip-verify` to bypass getUpdates if the network is blocked'
      ];
      state.durationMs = Date.now() - started;
      return state;
    }
    state.bound = true;
    state.pairing = 'logged-in';
    state.pairingLabel = COMPANION_PAIRING_LABELS['logged-in'];
    // Hand off to the daemon (same path the QR flow uses on success).
    const startOptions: Parameters<typeof startFn>[0] = { force: true };
    if (home !== undefined) startOptions.home = home;
    const startedDaemon = await startFn(startOptions);
    if (startedDaemon.started) {
      state.startedDaemon = true;
      state.daemonPid = startedDaemon.pid;
    } else {
      state.nextActions.push('binding succeeded but the daemon did not start; run `peaks companion start` manually');
    }
    state.durationMs = Date.now() - started;
    return state;
  }

  const probe = await probeFn();
  if (!probe.ok || probe.binaryPath === null) {
    state.error = probe.error ?? 'cc-connect binary not on PATH';
    state.nextActions = ['run `peaks companion install` first, then re-run setup'];
    state.durationMs = Date.now() - started;
    return state;
  }
  state.binaryPath = probe.binaryPath;
  if (probe.version !== null) {
    // Use the probe's resolvedSource (uppercased) so the peaks-config
    // mirror via `sourceToCompanionBinarySource` lands on the right
    // enum value ('node-modules' or 'path'). The legacy literal
    // 'SETUP' is unknown to the enum and would wipe binaryPathSource
    // to null in ~/.peaks/config.json (bug 2026-06-14-cc-connect-weixin#3).
    // Fall back to NODE_MODULES when the probe couldn't tag a source
    // (rare; happens when the resolver returned null source but the
    // probe still produced a binary path).
    const sourceUpper = probe.resolvedSource === 'node-modules'
      ? 'NODE_MODULES'
      : probe.resolvedSource === 'path'
        ? 'PATH'
        : 'NODE_MODULES';
    const cached = cacheWriter(
      { binaryPath: probe.binaryPath, version: probe.version, resolvedAt: new Date().toISOString(), source: sourceUpper },
      home
    );
    if (!cached.ok) {
      state.nextActions.push(`cache write failed (${cached.error}); continuing without cache refresh`);
    }
  }

  const existing = home !== undefined ? readCcConnectConfig(home) : readCcConnectConfig();
  if (existing !== null && options.forceOverwrite !== true) {
    const offending = detectNonWeixinPlatforms(existing.body);
    if (offending.length > 0) {
      state.configWarnings.push(`existing config has non-weixin platform types: ${offending.join(', ')}; peaks-cli slice 1 will refuse them`);
    }
    const ok = await promptFn(DEFAULT_PROMPT_QUESTION);
    if (!ok) {
      state.error = 'user declined overwrite; setup aborted, no files written';
      state.configPreserved = true;
      state.nextActions = ['no changes made; run `peaks companion setup` again to retry'];
      state.durationMs = Date.now() - started;
      return state;
    }
  }

  // Slice change-1: when `companionConfig` is supplied, render the
  // TOML from the typed peaks config (the source of truth). When
  // omitted, fall back to the legacy free-form shape for callers
  // that haven't been migrated yet.
  const companionRenderer = options.companionRenderer ?? renderCompanionConfig;
  const body = options.companionConfig !== undefined
    ? companionRenderer(options.companionConfig)
    : configRenderer({
        projectName: options.projectName ?? 'default',
        ...(options.allowFrom !== undefined ? { allowFrom: options.allowFrom } : {})
      });
  const writeResult = home !== undefined ? configWriter(body, { home, overwrite: true }) : configWriter(body, { overwrite: true });
  if (!writeResult.ok) {
    state.error = writeResult.error ?? 'config write failed';
    state.nextActions = ['verify ~/.cc-connect/ is writable; rerun setup'];
    state.durationMs = Date.now() - started;
    return state;
  }
  state.configWritten = !writeResult.preserved;
  state.configPreserved = writeResult.preserved;

  // Slice change-1: the QR payload comes from peaks config when
  // supplied; otherwise fall back to the legacy inline payload.
  const qrPayload = options.companionConfig !== undefined
    ? options.companionConfig.weixin.ilinkQrPayload
    : `ilink://peaks-cli?project=${encodeURIComponent(options.projectName ?? 'default')}`;
  try {
    await qrRenderer(qrPayload);
    state.qrRendered = true;
  } catch (err) {
    state.error = `QR render failed: ${getErrorMessage(err)}`;
    state.nextActions = ['verify the iLink backend is reachable; rerun with --timeout 120'];
    state.durationMs = Date.now() - started;
    return state;
  }

  // Capture the deadline BEFORE the spawn so the --timeout clock
  // starts at setup entry, not after the spawn returns (bug
  // 2026-06-14-cc-connect-weixin#4: `--timeout` was occasionally
  // racing the spawn completion path).
  const deadline = Date.now() + timeoutMs;

  // BUG 2026-06-14-cc-connect-weixin#7: build the cc-connect argv,
  // threading `--qr-image <path>` when the user hasn't opted out
  // (`--no-qr-image`). The default lives at `~/.peaks/companion/qr.png`
  // so users have a stable path to AirDrop / scan after the setup
  // completes. We mkdir as needed; the file is overwritten on every
  // setup run. In pipe mode the path is also surfaced via
  // `state.qrPath` so --json consumers can locate the PNG.
  const setupArgs: string[] = ['weixin', 'setup', '--project', options.projectName ?? 'default'];
  let resolvedQrImagePath: string | null = null;
  if (options.qrImageDisabled !== true) {
    resolvedQrImagePath = options.qrImagePath !== undefined && options.qrImagePath !== null
      ? options.qrImagePath
      : join(companionHomeDir(home), DEFAULT_QR_IMAGE_FILENAME);
    try {
      mkdirSync(dirname(resolvedQrImagePath), { recursive: true });
    } catch (err) {
      // mkdir failure should not abort the flow; the QR still
      // renders via qrcode-terminal. Surface as a warning instead.
      state.configWarnings.push(`qr-image mkdir failed: ${getErrorMessage(err)}`);
      resolvedQrImagePath = null;
    }
    if (resolvedQrImagePath !== null) {
      setupArgs.push('--qr-image', resolvedQrImagePath);
    }
  }
  if (process.stdout.isTTY !== true) {
    state.qrPath = resolvedQrImagePath;
  }

  // 2026-06-15 follow-up (auto-open QR): schedule a fire-and-forget
  // auto-open of the QR PNG once cc-connect has finished writing it.
  // We don't await — the user can start scanning while the pairing
  // poll loop continues. On any failure (file not written, xdg-open
  // not installed, unsupported platform) we surface a soft warning
  // instead of failing the setup; the user can still scan manually.
  // The result is also printed to stdout so the user gets immediate
  // feedback (the auto-open is otherwise silent UX).
  if (resolvedQrImagePath !== null && options.autoOpenQr !== false) {
    const opener = options.autoOpener ?? openInDefaultApp;
    const targetPath = resolvedQrImagePath;
    void scheduleAutoOpenQr(targetPath, opener, (warning) => {
      state.configWarnings.push(warning);
      // Also surface to the user's terminal so they know what happened
      // (without this, a silent fail leaves the user wondering).
      // eslint-disable-next-line no-console
      console.log(`  auto-open     : ${warning}`);
    });
    // Pre-emptively surface a "trying to open" hint so the user
    // knows the auto-open path is engaged even before the file
    // appears (cc-connect takes 1-3s to write the PNG).
    // eslint-disable-next-line no-console
    console.log(`  auto-open     : opening QR PNG in default viewer (waiting for cc-connect to write it; up to 10s)`);
  }

  // The cc-connect weixin setup flow handles iLink QR generation +
  // pairing state-machine progression. argv is fixed: subcommand
  // `weixin setup` (per `cc-connect --help`); the binary writes its
  // own state to `~/.cc-connect/state.json` which the polling loop
  // reads below.
  const setupProc = spawnSetup(probe.binaryPath, setupArgs);

  // BUG 2026-06-14-cc-connect-weixin#7: when peaks-cli captured
  // cc-connect's stdout (non-TTY / --json / piped mode), the
  // default spawn attaches a stdout scanner that stashes the iLink
  // URL on the ChildProcess. We read the stash AFTER the polling
  // loop (below) once the async listener has had a chance to fire.
  // When the spawn was inherited (TTY) or the caller provided a
  // custom `spawnSetup` seam without a ChildProcess reference,
  // `iLinkUrl` stays null.
  const captureTarget = process.stdout.isTTY !== true && 'child' in setupProc
    ? (setupProc as { child?: unknown }).child
    : null;

  let latest: CompanionPairingState = 'unknown';
  try {
    while (Date.now() < deadline) {
      const snap = home !== undefined ? stateReader(home) : stateReader();
      latest = snap.state;
      state.pairing = latest;
      state.pairingLabel = COMPANION_PAIRING_LABELS[latest] ?? snap.error ?? 'Unknown';
      if (latest === 'logged-in') break;
      if (latest === 'error') {
        state.error = snap.error ?? 'cc-connect reported an error during pairing';
        break;
      }
      if (latest === 'expired') {
        state.error = 'iLink login expired before the user scanned the QR';
        break;
      }
      await new Promise((r) => setTimeout(r, PROGRESS_POLL_INTERVAL_MS));
    }
  } finally {
    setupProc.kill();
    // Read the captured iLink URL after the spawn is killed so the
    // async 'data' listener has had time to drain the buffered
    // stdout chunks. The 'close' listener inside `defaultSpawnSetup`
    // also runs at this point and performs a final regex pass.
    if (captureTarget !== null && captureTarget !== undefined) {
      const captured = readIlinkUrl(captureTarget);
      if (captured !== null) state.iLinkUrl = captured;
    }
  }

  if (state.error === null && latest !== 'logged-in') {
    state.error = `pairing did not reach "logged-in" within ${timeoutMs}ms (last state: ${latest})`;
  }

  if (state.error === null) {
    const startOptions: Parameters<typeof startFn>[0] = { force: true };
    if (home !== undefined) startOptions.home = home;
    const started = await startFn(startOptions);
    if (started.started) {
      state.startedDaemon = true;
      state.daemonPid = started.pid;
    } else {
      state.nextActions.push('pairing succeeded but the daemon did not start; run `peaks companion start` manually');
    }
  } else {
    state.nextActions.push('rerun with `--timeout 120` or fix the underlying issue above');
  }

  state.durationMs = Date.now() - started;
  return state;
}

/**
 * 2026-06-15 follow-up: poll for cc-connect to write the QR PNG, then
 * call the auto-opener (default: `openInDefaultApp`). Fire-and-forget;
 * the returned promise resolves only for observability, callers MUST NOT
 * await it (the orchestrator continues immediately). On any failure
 * (file not written, OS error, unsupported platform) we surface a soft
 * warning via the `onWarning` callback so the user can still scan the
 * file manually from `state.qrPath`.
 *
 * Polling: 100ms interval, 10s ceiling. On slow systems where the
 * PNG takes longer, the user can re-run setup (or use `--no-auto-open-qr`
 * to silence this and open the file themselves).
 */
const AUTO_OPEN_POLL_INTERVAL_MS = 100;
const AUTO_OPEN_TIMEOUT_MS = 10_000;

export async function scheduleAutoOpenQr(
  filePath: string,
  opener: (filePath: string) => Promise<OpenResult>,
  onWarning: (warning: string) => void
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < AUTO_OPEN_TIMEOUT_MS) {
    try {
      await access(filePath);
      // eslint-disable-next-line no-await-in-loop
      const result = await opener(filePath);
      if (!result.ok) {
        onWarning(`auto-open failed: ${result.error}`);
      }
      return;
    } catch {
      // File not yet on disk; cc-connect is still writing. Wait and retry.
    }
    await new Promise((r) => setTimeout(r, AUTO_OPEN_POLL_INTERVAL_MS));
  }
  onWarning(`auto-open timed out after ${AUTO_OPEN_TIMEOUT_MS}ms: cc-connect did not write the QR PNG`);
}
