/**
 * Slice 2026-06-14-cc-connect-weixin (slice 2 + 3 + BUG 8) — `peaks companion`
 * CLI surface. Wires the install / status / start / stop / restart
 * / setup / token subcommands into the existing program router.
 *
 * BUG 8 adds:
 *   - `peaks companion token [bearer]` — manual ilink token
 *     injection (Path B; escape hatch when path A's QR scan
 *     fails). With no arg, reads the current token (masked by
 *     default; `--reveal` for the raw bearer). With a bearer,
 *     binds via `cc-connect weixin bind --token <bearer>`.
 *   - `peaks companion setup --token <bearer>` — short-circuits
 *     the QR render / pairing poll loop, binds the token, and
 *     hands off to the daemon.
 *
 * The default channel is `weixin` (per AC1/AC2/AC6). Passing
 * `--channel=<other>` exits with EX_USAGE (64) immediately.
 */
import { Command, InvalidArgumentError } from 'commander';
import { installCcConnect, scanCcConnect } from '../../services/companion/install-service.js';
import {
  startCcConnect,
  stopCcConnect,
  restartCcConnect,
  statusCcConnect
} from '../../services/companion/lifecycle-service.js';
import { runCompanionSetup, DEFAULT_SETUP_TIMEOUT_MS } from '../../services/companion/setup-service.js';
import { bindWeixinToken, readBoundToken } from '../../services/companion/bind-service.js';
import {
  CHANNEL_UNSUPPORTED_EXIT_CODE,
  COMPANION_CHANNELS,
  DEFAULT_COMPANION_CHANNEL,
  type CompanionChannel
} from '../../services/companion/companion-types.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

function parseChannel(value: string): CompanionChannel {
  if (COMPANION_CHANNELS.indexOf(value as CompanionChannel) === -1) {
    throw new InvalidArgumentError(
      `channel not supported in this slice; only ${COMPANION_CHANNELS.join(', ')} is implemented (got "${value}"). Run \`peaks companion --help\` for details.`
    );
  }
  return value as CompanionChannel;
}

function rejectChannel(provided: CompanionChannel | undefined): { ok: true; channel: CompanionChannel } | { ok: false; code: number; message: string } {
  if (provided === undefined) {
    return { ok: true, channel: DEFAULT_COMPANION_CHANNEL };
  }
  if (COMPANION_CHANNELS.indexOf(provided) === -1) {
    return {
      ok: false,
      code: CHANNEL_UNSUPPORTED_EXIT_CODE,
      message: `channel not supported in this slice; only ${COMPANION_CHANNELS.join(', ')} is implemented (got "${provided}"). Run \`peaks companion --help\` for details.`
    };
  }
  return { ok: true, channel: provided };
}

export function registerCompanionCommands(program: Command, io: ProgramIO): void {
  const companion = program
    .command('companion')
    .description(
      'Manage the cc-connect companion binary (weixin channel only in this slice). ' +
        'Subcommands: install | scan | status | start | stop | restart | setup. ' +
        '`--channel=<value>` only accepts `weixin`; other channels exit with EX_USAGE (64). ' +
        'Tip: ask your AI agent to run /peaks-companion to walk through the full setup.'
    );

  addJsonOption(
    companion
      .command('install')
      .description('Verify the cc-connect binary resolves from peaks-cli node_modules (or PATH) and cache its path under ~/.peaks/companion/. cc-connect is a peaks-cli `dependencies` entry; `pnpm install` already pulled the binary, so this is a verify pass.')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported in this slice)`, parseChannel)
  ).action(async (options: { channel?: CompanionChannel; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.install', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    try {
      const result = await installCcConnect({});
      if (!result.installed) {
        printResult(
          io,
          fail('companion.install', 'INSTALL_FAILED', result.error ?? 'install failed', { attempts: result.attempts, resolvedSource: result.resolvedSource }, result.nextActions),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.install', result, [], result.nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('companion.install', 'INSTALL_THREW', getErrorMessage(error), {}, ['see `peaks companion install --help` for usage']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // BUG FIX (2026-06-14 dogfood): add `peaks companion scan` —
  // dry-run probe of the cc-connect binary. Reads only; never
  // writes the binary-path cache. Aliased with `peaks scan
  // companion-binary` (slice 1) so the CLI surface matches the
  // PRD's AC8 forward claim.
  addJsonOption(
    companion
      .command('scan')
      .description('Dry-run probe of the cc-connect binary (read-only; does NOT write the binary-path cache).')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
  ).action(async (options: { channel?: CompanionChannel; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.scan', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    try {
      const result = await scanCcConnect({});
      if (!result.ok) {
        printResult(
          io,
          fail('companion.scan', 'SCAN_FAILED', result.error ?? 'binary probe failed', { binaryPath: result.binaryPath, version: result.version, resolvedSource: result.resolvedSource }, result.nextActions),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.scan', result, [], result.nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('companion.scan', 'SCAN_THREW', getErrorMessage(error), {}, ['see `peaks companion scan --help` for usage']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    companion
      .command('status')
      .description('Show cc-connect companion status (running/pid/binary-path/pairing).')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
  ).action(async (options: { channel?: CompanionChannel; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.status', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    try {
      const status = await statusCcConnect();
      if (options.json === true) {
        printResult(io, ok('companion.status', status, [], []), true);
      } else {
        io.stdout(`  running        : ${status.running}`);
        io.stdout(`  channel        : ${status.channel}`);
        io.stdout(`  pid            : ${status.pid ?? '-'}`);
        io.stdout(`  binary-path    : ${status.binaryPath ?? '-'}`);
        io.stdout(`  version        : ${status.version ?? '-'}`);
        io.stdout(`  started-at     : ${status.startedAt ?? '-'}`);
        io.stdout(`  pairing        : ${status.pairing.state}`);
        io.stdout(`  pid-file       : ${status.pidFile}`);
        io.stdout(`  log-file       : ${status.logFile}`);
      }
    } catch (error) {
      printResult(io, fail('companion.status', 'STATUS_THREW', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    companion
      .command('start')
      .description('Start cc-connect in the background (idempotent). Writes pid to ~/.peaks/companion/cc-connect.pid.')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
  ).action(async (options: { channel?: CompanionChannel; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.start', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    try {
      const result = await startCcConnect();
      if (result.alreadyRunning === true) {
        printResult(io, ok('companion.start', result, [], result.nextActions), options.json);
        return;
      }
      if (!result.started) {
        printResult(io, fail('companion.start', 'START_FAILED', result.error ?? 'start failed', result, result.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.start', result, [], result.nextActions), options.json);
    } catch (error) {
      printResult(io, fail('companion.start', 'START_THREW', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    companion
      .command('stop')
      .description('Stop cc-connect (SIGTERM with 5s SIGKILL fallback). Removes the pid file.')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
      .option('--timeout <ms>', 'kill timeout in ms (default 5000)', '5000')
  ).action(async (options: { channel?: CompanionChannel; timeout?: string; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.stop', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    const timeout = Number.parseInt(options.timeout ?? '5000', 10);
    try {
      const result = await stopCcConnect({ timeoutMs: Number.isFinite(timeout) ? timeout : 5000 });
      if (!result.stopped) {
        printResult(io, fail('companion.stop', 'STOP_FAILED', result.error ?? 'stop failed', result, ['inspect the cc-connect log: `tail -n 50 ~/.peaks/companion/cc-connect.log`']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.stop', result, [], []), options.json);
    } catch (error) {
      printResult(io, fail('companion.stop', 'STOP_THREW', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    companion
      .command('restart')
      .description('Restart cc-connect (stop + start, force).')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
      .option('--timeout <ms>', 'kill timeout in ms (default 5000)', '5000')
  ).action(async (options: { channel?: CompanionChannel; timeout?: string; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.restart', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    const timeout = Number.parseInt(options.timeout ?? '5000', 10);
    try {
      const result = await restartCcConnect({ timeoutMs: Number.isFinite(timeout) ? timeout : 5000 });
      if (!result.restarted) {
        printResult(io, fail('companion.restart', 'RESTART_FAILED', result.error ?? 'restart failed', result, ['inspect `peaks companion status` and the cc-connect log']), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.restart', result, [], []), options.json);
    } catch (error) {
      printResult(io, fail('companion.restart', 'RESTART_THREW', getErrorMessage(error), {}, []), options.json);
      process.exitCode = 1;
    }
  });

  addJsonOption(
    companion
      .command('setup')
      .description('Render the weixin-only config.toml, print the iLink QR (qrcode-terminal), and poll pairing state. On "logged-in" we hand off to `peaks companion start`. BUG 8: with --token <bearer>, skip the QR render and bind an existing iLink token directly (Path B; escape hatch when path A fails).')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
      .option('--timeout <ms>', `pairing timeout in ms (default ${DEFAULT_SETUP_TIMEOUT_MS})`, String(DEFAULT_SETUP_TIMEOUT_MS))
      .option('--force', 'overwrite an existing ~/.cc-connect/config.toml without prompting', false)
      .option('--project <name>', 'cc-connect project name (default: "default")', 'default')
      .option('--allow-from <id>', 'restrict the weixin platform to a specific WeChat user id (optional)')
      .option('--qr-image <path>', 'path cc-connect writes the QR PNG to (default ~/.peaks/companion/qr.png; overwritten each run)')
      .option('--no-qr-image', 'do not pass --qr-image to cc-connect (skip PNG output)')
      .option('--token <bearer>', 'BUG 8 (Path B): skip the QR path; bind an existing iLink bearer token (e.g. `<botid>@im.bot:<secret>`)')
      .option('--api-url <url>', 'BUG 8 (Path B): forwarded to cc-connect; overrides the default ilink base URL (useful when ilinkai.weixin.qq.com is region-blocked)')
      .option('--skip-verify', 'BUG 8 (Path B): forwarded to cc-connect; skip the post-bind getUpdates verification', false)
  ).action(async (options: { channel?: CompanionChannel; timeout?: string; force?: boolean; project?: string; allowFrom?: string; qrImage?: string | boolean; token?: string; apiUrl?: string; skipVerify?: boolean; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.setup', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    const timeout = Number.parseInt(options.timeout ?? String(DEFAULT_SETUP_TIMEOUT_MS), 10);
    // BUG 2026-06-14-cc-connect-weixin#7: surface --qr-image /
    // --no-qr-image. `--qr-image` defaults to
    // ~/.peaks/companion/qr.png (a stable path the user can
    // AirDrop / scan after the setup completes). `--no-qr-image`
    // is the opt-out (commander exposes the negated flag as
    // `qrImage === false` on the options bag).
    const qrImageDisabled = options.qrImage === false;
    const qrImagePath = !qrImageDisabled && typeof options.qrImage === 'string'
      ? options.qrImage
      : null;
    try {
      const state = await runCompanionSetup({
        ...(Number.isFinite(timeout) ? { timeoutMs: timeout } : {}),
        ...(options.force === true ? { forceOverwrite: true } : {}),
        ...(options.project !== undefined ? { projectName: options.project } : {}),
        ...(options.allowFrom !== undefined ? { allowFrom: options.allowFrom } : {}),
        ...(qrImageDisabled ? { qrImageDisabled: true } : {}),
        ...(qrImagePath !== null ? { qrImagePath } : {}),
        // BUG 8 (Path B): forward --token / --api-url / --skip-verify
        // to the orchestrator. When --token is non-empty, the
        // orchestrator short-circuits the QR render + pairing poll
        // and calls the bind service directly.
        ...(typeof options.token === 'string' && options.token.length > 0 ? { bindToken: options.token } : {}),
        ...(typeof options.apiUrl === 'string' && options.apiUrl.length > 0 ? { bindApiUrl: options.apiUrl } : {}),
        ...(options.skipVerify === true ? { bindSkipVerify: true } : {})
      });
      if (state.error !== null) {
        printResult(io, fail('companion.setup', 'SETUP_FAILED', state.error, state, state.nextActions), options.json);
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('companion.setup', state, [], state.nextActions), options.json);
    } catch (error) {
      printResult(io, fail('companion.setup', 'SETUP_THREW', getErrorMessage(error), {}, ['see `peaks companion setup --help`']), options.json);
      process.exitCode = 1;
    }
  });

  // BUG 2026-06-14-cc-connect-weixin#8: peaks companion token.
  // First-class surface for path B (manual ilink token injection).
  // With no arg, reads the current token (masked); with a bearer,
  // binds it via `cc-connect weixin bind`.
  addJsonOption(
    companion
      .command('token')
      .description('BUG 8 (Path B): manual ilink token injection. With no arg, read the current token (masked; use --reveal for the raw bearer). With a bearer, bind it via `cc-connect weixin bind --token <bearer>`. Use this when path A (QR scan) is unreliable: WeChat `ERR_UNKNOWN_URL_SCHEME`, iLink TLS timeout, or region-blocked.')
      .argument('[bearer]', 'iLink bearer token (e.g. `<botid>@im.bot:<secret>`). Omit to read the current bound token.')
      .option('--channel <name>', `channel (only ${COMPANION_CHANNELS.join(', ')} supported)`, parseChannel)
      .option('--project <name>', 'cc-connect project name (default: "default")', 'default')
      .option('--platform-index <n>', 'forwarded to cc-connect weixin bind (the platform entry index in the config)')
      .option('--api-url <url>', 'forwarded to cc-connect weixin bind; overrides the default ilink base URL')
      .option('--skip-verify', 'forwarded to cc-connect weixin bind; skip getUpdates verification', false)
      .option('--reveal', 'read mode only: include the raw bearer in the output (default: masked)', false)
  ).action(async (bearer: string | undefined, options: { channel?: CompanionChannel; project?: string; platformIndex?: string; apiUrl?: string; skipVerify?: boolean; reveal?: boolean; json?: boolean }) => {
    const check = rejectChannel(options.channel);
    if (!check.ok) {
      printResult(io, fail('companion.token', 'CHANNEL_UNSUPPORTED', check.message, { provided: options.channel ?? null }, ['this slice implements only the weixin channel']), options.json);
      process.exitCode = check.code;
      return;
    }
    try {
      if (typeof bearer === 'string' && bearer.length > 0) {
        // Bind path: forward to the bind service. parseFloat is
        // permissive enough for `--platform-index 0`; we floor it
        // to an integer inside the service.
        const platformIndex = options.platformIndex !== undefined
          ? Number.parseInt(options.platformIndex, 10)
          : undefined;
        const result = await bindWeixinToken({
          token: bearer,
          ...(options.project !== undefined ? { project: options.project } : {}),
          ...(Number.isFinite(platformIndex) && platformIndex !== undefined ? { platformIndex: platformIndex as number } : {}),
          ...(typeof options.apiUrl === 'string' && options.apiUrl.length > 0 ? { apiUrl: options.apiUrl } : {}),
          ...(options.skipVerify === true ? { skipVerify: true } : {})
        });
        if (!result.ok) {
          printResult(io, fail('companion.token', 'BIND_FAILED', result.error ?? 'bind failed', {
            binaryPath: result.binaryPath,
            configPath: result.configPath,
            code: result.code,
            stderr: result.stderr
          }, result.nextActions), options.json);
          process.exitCode = 1;
          return;
        }
        printResult(io, ok('companion.token', {
          bound: result.bound,
          channel: 'weixin',
          binaryPath: result.binaryPath,
          configPath: result.configPath
        }, [], result.nextActions), options.json);
        return;
      }
      // Read path: surface the masked token (or raw, with --reveal).
      const snapshot = readBoundToken({ reveal: options.reveal === true });
      if (options.json === true) {
        printResult(io, ok('companion.token', {
          bound: snapshot.bound,
          configPath: snapshot.configPath,
          configPresent: snapshot.configPresent,
          botid: snapshot.botid,
          maskedToken: snapshot.maskedToken,
          ...(options.reveal === true ? { rawToken: snapshot.rawToken } : {})
        }, [], []), true);
        return;
      }
      io.stdout(`  bound          : ${snapshot.bound}`);
      io.stdout(`  config         : ${snapshot.configPath}`);
      io.stdout(`  configPresent  : ${snapshot.configPresent}`);
      io.stdout(`  botid          : ${snapshot.botid ?? '-'}`);
      io.stdout(`  maskedToken    : ${snapshot.maskedToken ?? '-'}`);
      if (options.reveal === true) {
        io.stdout(`  rawToken       : ${snapshot.rawToken ?? '-'}`);
      } else {
        io.stdout(`  (pass --reveal to print the raw bearer)`);
      }
    } catch (error) {
      printResult(io, fail('companion.token', 'TOKEN_THREW', getErrorMessage(error), {}, ['see `peaks companion token --help`']), options.json);
      process.exitCode = 1;
    }
  });
}
