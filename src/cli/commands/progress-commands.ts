import { spawn } from 'node:child_process';
import { platform } from 'node:os';
import { Command } from 'commander';
import {
  readSubAgentProgress,
  resolveProgressProjectRoot,
  subAgentProgressPath,
  writeSubAgentProgress,
  type SubAgentProgress,
  type SubAgentProgressPhase
} from '../../services/progress/progress-service.js';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

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
  json?: boolean;
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const PHASE_LABEL: Record<SubAgentProgressPhase, string> = {
  starting: 'starting',
  running: 'running',
  verifying: 'verifying',
  completing: 'completing',
  finished: 'finished',
  failed: 'failed',
  idle: 'idle'
};

function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function pickSpinnerFrame(tick: number): string {
  return SPINNER_FRAMES[Math.abs(tick) % SPINNER_FRAMES.length] as string;
}

/**
 * Render a single progress snapshot line to a TTY. Width is
 * bounded by `width` so the watch tool degrades gracefully in
 * narrow terminals (Claude Code integrated terminal is usually
 * 80-120 columns).
 */
function renderProgressLine(data: SubAgentProgress | null, tick: number, width = 100): string {
  if (data === null) {
    return `${pickSpinnerFrame(tick)}  peaks — sub-agent progress: (no progress file yet — sub-agent has not started)`;
  }
  const startedAtMs = new Date(data.current.startedAt).getTime();
  const nowMs = Date.now();
  const elapsedMs = nowMs - startedAtMs;
  const step = data.current.step.length > 60 ? data.current.step.slice(0, 57) + '...' : data.current.step;
  const phase = PHASE_LABEL[data.current.phase];
  const verdict = data.current.verdict ? `  verdict=${data.current.verdict}` : '';
  const counts = data.current.counts && Object.keys(data.current.counts).length > 0
    ? `  counts=${JSON.stringify(data.current.counts)}`
    : '';
  const role = data.role ? `  role=${data.role}` : '';
  const head = `${pickSpinnerFrame(tick)}  ${phase}  ${formatElapsed(elapsedMs)}  ${step}`;
  const tail = `${role}${verdict}${counts}`;
  const budget = width - head.length - 1;
  if (budget <= 0) return head;
  return `${head}  ${tail.slice(0, budget)}`;
}

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

      // Long-running watch loop. We deliberately do NOT wrap this
      // in printResult — the watch is a stream of one-line
      // refreshes and printResult would JSON-encode each one.
      // Instead we render directly to the TTY.
      const width = (process.stdout.columns ?? 120) - 1;
      io.stdout(`peaks progress watch — ${canonical}`);
      io.stdout(`path: ${subAgentProgressPath(canonical)}`);
      io.stdout('press Ctrl-C to stop watching');
      let tick = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = readSubAgentProgress({ projectRoot: canonical });
        const data = result.ok ? result.data : null;
        io.stdout(renderProgressLine(data, tick, width));
        tick += 1;
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
  ).action(async (options: ProgressStartOptions) => {
    try {
      const projectRoot = options.project !== undefined
        ? options.project
        : resolveProgressProjectRoot(undefined, process.cwd());
      const canonical = resolveCanonicalProjectRoot(projectRoot);

      const currentPlatform = platform();
      const peaksBin = process.argv[1] ?? 'peaks';
      const watchCommand = `${peaksBin} progress watch --project "${canonical}"`;
      let spawnCommand: string;
      let spawnArgs: string[];

      if (currentPlatform === 'darwin') {
        // macOS: open a new Terminal.app window. Escape the
        // command for the AppleScript string. osascript runs
        // synchronously; the new window outlives the CLI.
        const escaped = watchCommand.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
        spawnCommand = 'osascript';
        spawnArgs = [
          '-e',
          `tell application "Terminal" to do script "${escaped}"`,
          '-e',
          'tell application "Terminal" to activate'
        ];
      } else if (currentPlatform === 'linux') {
        // Linux: try common terminal emulators in order. We
        // pick the first one that exists on PATH; the spawn
        // is fire-and-forget because each terminal emulator
        // detaches the child.
        const { existsSync } = await import('node:fs');
        const candidates = ['gnome-terminal', 'konsole', 'xterm', 'tilix', 'xfce4-terminal', 'alacritty', 'kitty'];
        const terminal = candidates.find((c) => existsSync(`/usr/bin/${c}`)) ?? candidates[0]!;
        if (terminal === 'xterm' || terminal === 'alacritty' || terminal === 'kitty') {
          spawnCommand = terminal;
          spawnArgs = ['-e', watchCommand];
        } else {
          // gnome-terminal / konsole / tilix / xfce4-terminal all
          // accept -- /bin/bash -c '<command>' for a one-shot run.
          spawnCommand = terminal;
          spawnArgs = ['--', '/bin/bash', '-lc', watchCommand];
        }
      } else if (currentPlatform === 'win32') {
        // Windows: `start` opens a new console window. /k keeps
        // the window open after the command exits so the user
        // can see the final line.
        spawnCommand = 'cmd';
        spawnArgs = ['/c', 'start', '""', 'cmd', '/k', watchCommand];
      } else {
        printResult(io, fail('progress.start', 'UNSUPPORTED_PLATFORM', `Cannot auto-spawn a terminal on platform "${currentPlatform}". Run \`peaks progress watch --project "${canonical}"\` in a new terminal yourself.`, { projectRoot: canonical }, ['macOS / Linux / Windows are supported; other platforms need a manual terminal']), options.json);
        process.exitCode = 1;
        return;
      }

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
      } catch (spawnError) {
        printResult(io, fail('progress.start', 'TERMINAL_SPAWN_FAILED', `Auto-spawn failed: ${getErrorMessage(spawnError)}. Run \`peaks progress watch --project "${canonical}"\` in a new terminal yourself.`, { projectRoot: canonical, platform: currentPlatform, attempted: `${spawnCommand} ${spawnArgs.join(' ')}` }, ['Verify a terminal emulator is installed (e.g. gnome-terminal / Terminal.app)']), options.json);
        process.exitCode = 1;
        return;
      }

      printResult(io, ok('progress.start', {
        projectRoot: canonical,
        platform: currentPlatform,
        spawned: `${spawnCommand} ${spawnArgs.join(' ')}`,
        watchCommand,
        ...(options.reason !== undefined ? { reason: options.reason } : {}),
        note: 'A new terminal window is opening in the background. It will run `peaks progress watch` and refresh every second. Close the new terminal at any time to stop the watch.'
      }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('progress.start', 'PROGRESS_START_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and a terminal emulator is available']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
