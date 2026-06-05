import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { Command } from 'commander';
import chalk from 'chalk';
import ora, { type Ora } from 'ora';
import {
  clearSpawnRecord,
  isRecentSpawn,
  phaseAutoClosesSpawn,
  readSpawnRecord,
  readSubAgentProgress,
  resolveProgressProjectRoot,
  subAgentProgressPath,
  subAgentSpawnPath,
  writeSpawnRecord,
  writeSubAgentProgress,
  type SubAgentProgress,
  type SubAgentProgressPhase
} from '../../services/progress/progress-service.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { killSpawnedTerminal } from './progress-close-kill.js';
import { buildStartSpawn } from './progress-start-spawn.js';
import { WatchRenderer } from './progress-watch-render.js';

type ProgressStepOptions = {
  project?: string;
  requestId: string;
  role: string;
  step: string;
  phase: SubAgentProgressPhase;
  verdict?: 'pass' | 'return-to-rd' | 'blocked';
  apply?: boolean;
  reason?: string;
  json?: boolean;
};

type ProgressWatchOptions = {
  project?: string;
  once?: boolean;
  intervalMs?: number;
  json?: boolean;
};

type ProgressStartOptions = {
  project?: string;
  reason?: string;
  /** Suppress human-readable output; only emit JSON to stdout. The hook uses this so the LLM does not see ~500 tokens of spawn envelope per Task call. */
  quiet?: boolean;
  json?: boolean;
};


export function registerProgressCommands(program: Command, io: ProgramIO): void {
  const progress = program.command('progress').description('Sub-agent progress surfacing (LLM-side step writes, user-side watch, auto-spawn new terminal)');

  // ─────────────────────────────────────────────────────────────────
  // peaks progress step
  // LLM-side: called by the LLM on phase transitions. Near-zero
  // token cost — one Bash call per phase change. Writes
  // `.peaks/<sid>/system/subagent-progress.json`. No auto-spawn
  // here; the LLM invokes `peaks progress start` separately when
  // the user-visible window needs to open.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    progress
      .command('step')
      .description('Record a sub-agent step / phase transition. Idempotent on (step, phase); transitions append to history.')
      .requiredOption('--request-id <rid>', 'the same <rid> used by peaks request init')
      .requiredOption('--role <role>', 'rd | qa | ui | sc | prd (the role of the sub-agent calling this)')
      .requiredOption('--step <text>', 'free-form human-readable step label, e.g. "running test/ut"')
      .requiredOption('--phase <phase>', 'starting | running | verifying | completing | finished | failed | idle')
      .option('--verdict <verdict>', 'pass | return-to-rd | blocked (only when phase is finished or failed)')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--reason <text>', 'human-readable reason for the step write, recorded in the response data')
  ).action((options: ProgressStepOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProgressProjectRoot(undefined, process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);
      const data = writeSubAgentProgress({
        projectRoot: canonical,
        requestId: options.requestId,
        role: options.role,
        step: options.step,
        phase: options.phase,
        ...(options.verdict !== undefined ? { verdict: options.verdict } : {}),
        ...(options.reason !== undefined ? { outerSessionId: options.reason } : {})
      });
      printResult(io, ok('progress.step', {
        projectRoot: canonical,
        path: subAgentProgressPath(canonical),
        sessionId: data.sessionId,
        requestId: data.requestId,
        role: data.role,
        phase: data.current.phase,
        step: data.current.step,
        startedAt: data.current.startedAt,
        updatedAt: data.current.updatedAt
      }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('progress.step', 'PROGRESS_STEP_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and that peaks workspace init has been run for it']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // peaks progress watch
  // User-side: run in a separate terminal. 1s poll + ASCII
  // spinner + elapsed. --once for a single snapshot.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    progress
      .command('watch')
      .description('Watch the sub-agent progress file in a loop (1s poll + ASCII spinner). --once for a single snapshot.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--once', 'print a single snapshot and exit (for use in scripts or statusline hooks)', false)
      .option('--interval-ms <ms>', 'poll interval in milliseconds (default 1000)', (value) => Number.parseInt(value, 10))
  ).action(async (options: ProgressWatchOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProgressProjectRoot(undefined, process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);
      const intervalMs = options.intervalMs !== undefined && Number.isFinite(options.intervalMs) && options.intervalMs > 0
        ? options.intervalMs
        : 1000;

      if (options.once === true) {
        const result = readSubAgentProgress({ projectRoot: canonical });
        if (!result.ok) {
          printResult(io, fail('progress.watch', 'NO_PROGRESS_DATA', `No progress file present yet (${result.reason})`, { projectRoot: canonical, path: subAgentProgressPath(canonical) }, ['Run peaks progress step once on the LLM side to bootstrap the file']), options.json);
          process.exitCode = 1;
          return;
        }
        printResult(io, ok('progress.watch.snapshot', {
          projectRoot: canonical,
          path: result.path,
          data: result.data
        }), options.json);
        return;
      }

      // Long-running watch loop. The render layer lives in
      // ./progress-watch-render.ts; the watch loop just polls
      // the file and calls renderer.tick(data, n). The renderer
      // owns cursor positioning and in-place overwrite so the
      // output does not grow line by line as it did in the
      // previous console.log-based implementation.
      const renderer = new WatchRenderer({
        projectRoot: canonical,
        progressFilePath: subAgentProgressPath(canonical)
      });
      renderer.start();
      // Hint line is painted once BELOW the dynamic block, so
      // it is not erased on each tick. The user sees the
      // spinner + bar above, the static hint at the bottom.
      io.stdout(chalk.gray('  press Ctrl-C to stop watching\n'));
      let tick = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = readSubAgentProgress({ projectRoot: canonical });
        const data = result.ok ? result.data : null;
        renderer.tick(data, tick);
        tick += 1;
        // Auto-close: when the sub-agent reaches a terminal
        // phase (finished or failed per phaseAutoClosesSpawn),
        // paint the final frame so the user can read the
        // verdict, then exit. Exiting the watch process makes
        // most terminal emulators close the window
        // (Terminal.app / gnome-terminal / konsole all do;
        // alacritty / kitty keep it). We also clear the
        // spawn record so a subsequent `peaks progress close`
        // reports "nothing to close" instead of "closed a
        // ghost record".
        //
        // We deliberately do NOT auto-close on `blocked` —
        // `blocked` means the user needs to read the watch
        // output and decide what to do.
        if (data !== null && phaseAutoClosesSpawn(data.current.phase)) {
          renderer.finalize(data);
          clearSpawnRecord(canonical);
          return;
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
      }
    } catch (error) {
      printResult(
        io,
        fail('progress.watch', 'PROGRESS_WATCH_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and that the progress file is readable']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // peaks progress start
  // The "auto-spawn a new terminal running watch" entry point.
  // Called by the LLM at the first phase transition of a slice,
  // once per session. Cross-platform: macOS uses osascript with
  // Terminal.app; Linux tries gnome-terminal / konsole /
  // xterm in order; Windows uses `start cmd`. The user can
  // close the new terminal at any time; re-invoking is a no-op
  // if a watch is already running in another terminal.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    progress
      .command('start')
      .description('Auto-spawn a new terminal running `peaks progress watch` for this project. Called by the LLM at the first phase transition; the user can close the new terminal at any time.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
      .option('--reason <text>', 'human-readable reason for the auto-spawn, recorded in the response data')
      .option('--quiet', 'suppress human-readable output (the Task-tool PreToolUse hook uses this to keep the LLM context clean)')
  ).action(async (options: ProgressStartOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProgressProjectRoot(undefined, process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);

      // Idempotency check: when the Task-tool PreToolUse hook fires
      // `peaks progress start` on every Task call, a fresh terminal
      // should NOT be spawned if a watch window was already opened for
      // this session within the last 5 minutes. The user closes the
      // window deliberately; we honor that until the record ages out.
      const recent = isRecentSpawn(canonical);
      if (recent.recent) {
        if (options.quiet !== true) {
          // Non-hook path: keep the human feedback (so an LLM running
          // peaks progress start manually understands the no-op).
        }
        printResult(
          io,
          ok(
            'progress.start',
            {
              projectRoot: canonical,
              spawned: false,
              idempotent: true,
              reason: recent.reason,
              ageMs: recent.ageMs,
              note: 'a recent spawn record exists; the watch window is presumed open. Re-run after 5 min (TTL) or `peaks progress close` to force a fresh spawn.'
            },
            [],
            recent.reason === 'recent-spawn'
              ? []
              : ['run `peaks progress close` to clear the stale record and force a fresh spawn']
          ),
          options.json
        );
        return;
      }

      const currentPlatform = platform();
      const peaksBin = process.argv[1] ?? 'peaks';
      const reasonSuffix = options.reason !== undefined ? ` — ${options.reason}` : '';
      // Window / tab title shared across platforms. The user
      // asked for visible "this is peaks-cli" branding so the
      // spawned terminal is identifiable at a glance; the title
      // also makes `peaks progress close` self-documenting.
      const windowTitle = `peaks-cli: sub-agent progress${reasonSuffix}`;
      const watchCommand = `${peaksBin} progress watch --project "${canonical}"`;
      // Build the platform-specific spawn command + args. This
      // is extracted to ./progress-start-spawn.ts so the three
      // platform branches can be unit-tested without spawning
      // a real terminal.
      const spawnSpec = buildStartSpawn({
        peaksBin,
        projectRoot: canonical,
        windowTitle,
        platform: currentPlatform
      });
      if (!spawnSpec.ok) {
        printResult(io, fail('progress.start', 'UNSUPPORTED_PLATFORM', `Cannot auto-spawn a terminal on platform "${currentPlatform}". Run \`peaks progress watch --project "${canonical}"\` in a new terminal yourself.`, { projectRoot: canonical }, ['macOS / Linux / Windows are supported; other platforms need a manual terminal']), options.json);
        process.exitCode = 1;
        return;
      }
      const spawnCommand = spawnSpec.command;
      const spawnArgs = spawnSpec.args;

      // Brief ora feedback while the terminal is launching.
      // Skipped entirely in non-TTY mode (the LLM calls this
      // from a Bash tool, where ora would just hang on
      // animation) and in --json mode (where the structured
      // response is the only signal the caller consumes).
      const showSpinner = process.stdout.isTTY === true && options.json !== true;
      const spinner: Ora | null = showSpinner
        ? ora(`auto-spawning ${spawnCommand}…`).start()
        : null;
      try {
        // spawn() with detached:true + unref() is the documented
        // Node.js way to start a long-lived child from a CLI
        // without blocking. We ignore stdio because the spawned
        // terminal owns the child process group from now on; the
        // peaks CLI exits and the terminal keeps running.
        const child = spawn(spawnCommand, spawnArgs, { detached: true, stdio: 'ignore' });
        child.unref();
        // Give the spawn a beat to surface EACCES/ENOENT. We do
        // not await the child (it is intentionally long-lived).
        await new Promise<void>((resolveSpawn, rejectSpawn) => {
          const timer = setTimeout(() => resolveSpawn(), 200);
          child.once('error', (spawnError) => {
            clearTimeout(timer);
            rejectSpawn(spawnError);
          });
          child.once('spawn', () => {
            clearTimeout(timer);
            resolveSpawn();
          });
        });
        if (spinner !== null) {
          spinner.succeed(`spawned ${spawnCommand} (new window is opening)`);
        }
        // Persist the spawn record so `peaks progress close` (and
        // the watch-side auto-exit) can find and kill the window
        // later. We write the record AFTER the spawn fires so a
        // failed spawn never leaves a stale record behind. The
        // record is per-session: a session rotation invalidates it
        // because the new session gets a fresh record path.
        const spawnRecord = writeSpawnRecord({
          projectRoot: canonical,
          pid: child.pid ?? 0,
          platform: currentPlatform,
          command: spawnCommand,
          args: spawnArgs,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          windowTitle
        });
        printResult(io, ok('progress.start', {
          projectRoot: canonical,
          platform: currentPlatform,
          spawned: `${spawnCommand} ${spawnArgs.join(' ')}`,
          watchCommand,
          ...(options.reason !== undefined ? { reason: options.reason } : {}),
          ...(spawnRecord === null
            ? {
                spawnRecord: null,
                warning: 'no peaks session binding — `peaks progress close` will not be able to find this window. Close it manually.'
              }
            : {
                spawnRecord: {
                  path: subAgentSpawnPath(canonical),
                  windowTitle: spawnRecord.windowTitle,
                  spawnedAt: spawnRecord.spawnedAt
                }
              }),
          autoClose: 'the watch window will close itself when the sub-agent hits `finished` or `failed`',
          note: 'A new terminal window is opening in the background. It will run `peaks progress watch` and refresh every second. Close the new terminal at any time, or run `peaks progress close` to programmatically close it.'
        }), options.json);
        return;
      } catch (spawnError) {
        if (spinner !== null) {
          spinner.fail(`auto-spawn failed: ${getErrorMessage(spawnError)}`);
        }
        printResult(io, fail('progress.start', 'TERMINAL_SPAWN_FAILED', `Auto-spawn failed: ${getErrorMessage(spawnError)}. Run \`peaks progress watch --project "${canonical}"\` in a new terminal yourself.`, { projectRoot: canonical, platform: currentPlatform, attempted: `${spawnCommand} ${spawnArgs.join(' ')}` }, ['Verify a terminal emulator is installed (e.g. gnome-terminal / Terminal.app)']), options.json);
        process.exitCode = 1;
        return;
      }
    } catch (error) {
      printResult(
        io,
        fail('progress.start', 'PROGRESS_START_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and a terminal emulator is available']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // peaks progress close
  // Manual escape hatch: kill the spawned watch window and
  // clear the spawn record. Idempotent — re-running is a no-op
  // once the record is gone, and the response distinguishes
  // "nothing to close" from "closed it" so callers / hooks can
  // tell the difference. The close is best-effort: if the
  // watch process has already exited but the record is stale,
  // we still clear the record.
  // ─────────────────────────────────────────────────────────────────
  addJsonOption(
    progress
      .command('close')
      .description('Close the spawned `peaks progress watch` window for this session. Idempotent: re-running when no window is open is a no-op.')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(async (options: { project?: string; json?: boolean }) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProgressProjectRoot(undefined, process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);
      const result = readSpawnRecord(canonical);
      if (!result.ok) {
        // Differentiate the failure modes so callers can decide
        // whether to surface a warning. no-binding means peaks
        // workspace init has not been run; no-spawn-record /
        // invalid-json means there is nothing to close (start
        // has not been called this session, or the window
        // already auto-closed and the record was cleared).
        if (result.reason === 'no-binding') {
          printResult(io, fail('progress.close', 'NO_BINDING', 'no peaks session binding — nothing to close', { projectRoot: canonical, path: subAgentSpawnPath(canonical) }, ['Run peaks workspace init for this project first']), options.json);
          process.exitCode = 1;
          return;
        }
        printResult(io, ok('progress.close', {
          projectRoot: canonical,
          closed: false,
          reason: result.reason,
          note: 'no spawn record found — nothing to close (start has not been called this session, or the window has already auto-closed)'
        }), options.json);
        return;
      }
      const record = result.data;
      // Best-effort close. We try three signals in order:
      //   (1) `pkill -f <watch command>` — the long-lived watch
      //       process. Killing it makes the terminal emulator
      //       close on most platforms (Terminal.app, gnome-
      //       terminal, konsole) but not all (alacritty, kitty
      //       keep the window).
      //   (2) macOS: AppleScript to close the Terminal.app
      //       window with the matching custom title.
      //   (3) Linux: wmctrl/xdotool by WM class as a fallback.
      //       Windows: taskkill /F /FI on the window title.
      // We never throw from the close path — a failed close is
      // a UX paper cut, not a correctness bug. The record is
      // still cleared so the next `progress start` does not
      // see a stale record.
      const closeResult = await killSpawnedTerminal(record, canonical, platform());
      clearSpawnRecord(canonical);
      printResult(io, ok('progress.close', {
        projectRoot: canonical,
        closed: closeResult.signals.length > 0,
        signals: closeResult.signals,
        warnings: closeResult.warnings,
        windowTitle: record.windowTitle,
        spawnedAt: record.spawnedAt,
        note: 'spawn record cleared. The next `peaks progress start` will spawn a fresh window.'
      }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('progress.close', 'PROGRESS_CLOSE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and that peaks workspace init has been run for it']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}

