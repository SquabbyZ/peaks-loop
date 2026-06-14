/**
 * Slice 2026-06-14-cc-connect-weixin (slice 3 + change-1) — `peaks companion setup`
 * orchestration. Pipeline:
 *
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
 * The QR is rendered via `qrcode-terminal` (per the PRD: "use
 * qrcode-terminal for the iLink QR"). The QR payload is the
 * `companion.weixin.ilinkQrPayload` from peaks config (change-1).
 */
import { spawn } from 'node:child_process';
import { renderCompanionConfig, renderWeixinConfig, writeCcConnectConfig, readCcConnectConfig, detectNonWeixinPlatforms, ccConnectConfigFile } from './config-template.js';
import { readCcConnectState } from './state-parser.js';
import { COMPANION_PAIRING_LABELS, type CompanionPairingState } from './companion-types.js';
import { probeCcConnect } from './cc-connect-resolver.js';
import { writeBinaryPathCache } from './binary-cache.js';
import { startCcConnect } from './lifecycle-service.js';
import { DEFAULT_COMPANION_CHANNEL, type CompanionChannel } from './companion-types.js';
import { getErrorMessage } from '../../shared/result.js';
import type { CompanionConfig } from '../config/config-types.js';

export const DEFAULT_SETUP_TIMEOUT_MS = 60_000;
const PROGRESS_POLL_INTERVAL_MS = 1_000;

export type QrRenderer = (qrPayload: string) => Promise<void> | void;

export type SetupState = {
  channel: CompanionChannel;
  binaryPath: string | null;
  configPath: string;
  configWritten: boolean;
  configPreserved: boolean;
  configWarnings: string[];
  qrRendered: boolean;
  pairing: CompanionPairingState;
  pairingLabel: string;
  startedDaemon: boolean;
  daemonPid: number | null;
  timeoutMs: number;
  durationMs: number;
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
  /** Custom spawn for the cc-connect weixin setup flow (test seam). */
  spawnSetup?: (binaryPath: string, args: readonly string[]) => { kill: () => void; pid: number | null };
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

/** Default spawn for the cc-connect weixin setup flow. */
export function defaultSpawnSetup(binaryPath: string, args: readonly string[]): { kill: () => void; pid: number | null } {
  const child = spawn(binaryPath, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  return {
    kill: () => {
      try { child.kill('SIGTERM'); } catch { /* best-effort */ }
    },
    pid: typeof child.pid === 'number' ? child.pid : null
  };
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
  const qrRenderer = options.qrRenderer ?? defaultQrRenderer;
  const spawnSetup = options.spawnSetup ?? defaultSpawnSetup;

  const state: SetupState = {
    channel: DEFAULT_COMPANION_CHANNEL,
    binaryPath: null,
    configPath: ccConnectConfigFile(home),
    configWritten: false,
    configPreserved: false,
    configWarnings: [],
    qrRendered: false,
    pairing: 'unknown',
    pairingLabel: COMPANION_PAIRING_LABELS['unknown'],
    startedDaemon: false,
    daemonPid: null,
    timeoutMs,
    durationMs: 0,
    error: null,
    nextActions: []
  };

  const probe = await probeFn();
  if (!probe.ok || probe.binaryPath === null) {
    state.error = probe.error ?? 'cc-connect binary not on PATH';
    state.nextActions = ['run `peaks companion install` first, then re-run setup'];
    state.durationMs = Date.now() - started;
    return state;
  }
  state.binaryPath = probe.binaryPath;
  if (probe.version !== null) {
    const cached = cacheWriter(
      { binaryPath: probe.binaryPath, version: probe.version, resolvedAt: new Date().toISOString(), source: 'SETUP' },
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

  const setupProc = spawnSetup(probe.binaryPath, ['weixin', 'setup', '--project', options.projectName ?? 'default']);

  const deadline = Date.now() + timeoutMs;
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
