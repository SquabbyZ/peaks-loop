/**
 * In-place progress renderer for `peaks progress watch`.
 *
 * Goals (in order of importance):
 *   1. **In-place overwrite.** Every tick the dynamic rows
 *      (status line + progress bar) get rewritten, NOT
 *      appended. We bypass `io.stdout` (which is
 *      `console.log` and adds a trailing `\n` per call) and
 *      write directly to `process.stdout`. The cursor-up
 *      and erase-line escapes are the same ones terminal-kit
 *      emits; we do not need a terminal-kit dependency for
 *      them.
 *   2. **Clear PEAKS-CLI branding.** A static 3-line header
 *      with the brand bar, the project root, and the
 *      progress-file path is painted once. The user always
 *      sees what they are looking at, even after the
 *      watch loop has overwritten the dynamic rows a
 *      thousand times.
 *   3. **Graceful degrade.** When stdout is not a TTY
 *      (CI / pipe / `--json`), we fall back to a single
 *      static snapshot per tick (no cursor moves, no
 *      SGR colour) and a single newline. This keeps the
 *      tool scriptable without dropping into a wall of
 *      escape codes.
 *
 * Token-cost note: this module is rendered to the user's
 * terminal, never into LLM context. The watch side has
 * zero token cost.
 */

import chalk from 'chalk';
import type { SubAgentProgress, SubAgentProgressPhase } from '../../services/progress/progress-service.js';

// ─────────────────────────────────────────────────────────────────────
// Raw byte writes. We do NOT go through `io.stdout` because the
// default `io.stdout` is `console.log` and appends a trailing
// newline, which would defeat in-place overwrite.
// ─────────────────────────────────────────────────────────────────────

function rawWrite(text: string): void {
  process.stdout.write(text);
}

/**
 * Number of lines that the dynamic dashboard occupies. We
 * rewrite exactly this many rows per tick via cursor-up +
 * erase-line, so the static header above and the
 * `press Ctrl-C` footer below stay put.
 */
const DYNAMIC_LINES = 2;

/** ANSI: cursor up N rows. */
const CURSOR_UP_N = (n: number): string => `\x1b[${n}A`;

/** ANSI: erase the current row from cursor to end-of-line. */
const ERASE_LINE = '\x1b[2K';

/** ANSI: reset all SGR attributes. */
const RESET = '\x1b[0m';

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

const PHASE_COLOR: Record<SubAgentProgressPhase, (s: string) => string> = {
  starting: chalk.cyan,
  running: chalk.cyan,
  verifying: chalk.cyan,
  completing: chalk.cyan,
  finished: chalk.green,
  failed: chalk.red,
  idle: chalk.gray
};

function pickSpinnerFrame(tick: number): string {
  return SPINNER_FRAMES[Math.abs(tick) % SPINNER_FRAMES.length] as string;
}

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

/**
 * `elapsedMs` based fake progress, 0..1, capped at 1 after
 * 10 minutes. Visual cue that the watch is alive; NOT a real
 * percent-complete.
 */
function computeFakeProgress(data: SubAgentProgress | null): number {
  if (data === null) return 0;
  const startedAtMs = new Date(data.current.startedAt).getTime();
  if (Number.isNaN(startedAtMs)) return 0;
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const upperBoundMs = 10 * 60 * 1000;
  return Math.min(1, elapsedMs / upperBoundMs);
}

// ─────────────────────────────────────────────────────────────────────
// ASCII art for the PEAKS-CLI brand bar. Kept in code (not a
// dependency) so the user sees the brand even when terminal-kit
// is unavailable.
// ─────────────────────────────────────────────────────────────────────

/**
 * Two-row ASCII wordmark for PEAKS-CLI. The first row is the
 * top half of each glyph; the second is the bottom half.
 * We keep the letter shapes recognisable on a monospace grid
 * (most monospace fonts reserve 2x the cell width for full-block
 * glyphs). The result is 19 cells wide; the brand row wraps to
 * the right of it with `·` separators.
 */
const PEAKS_CLI_ASCII: ReadonlyArray<string> = [
  '█▀█ █▀▀ █▀▀ ▄▀█ ▀█▀ █▀▀   █▀ █▀▀ █▄█',
  '█▀█ ██▄ ██▄ █▀█  █  ██▄   ▄█ ██▄ █ █'
];

/**
 * Render the static 4-line header: the two-line PEAKS-CLI
 * wordmark, a separator, and the project path. Painted ONCE
 * at the top of the watch, then never touched again.
 */
function renderHeader(projectRoot: string, progressFilePath: string, isTty: boolean): string {
  if (!isTty) {
    // Non-TTY: emit a single header line, no colour. The
    // dashboard still emits 2 dynamic lines per tick, so
    // consumers that need to parse the output can rely on
    // a known line count.
    return [
      `PEAKS-CLI · sub-agent progress watch · project=${projectRoot}`,
      `path: ${progressFilePath}`
    ].join('\n') + '\n';
  }
  const brandLeft = PEAKS_CLI_ASCII[0] ?? '';
  const brandRight = PEAKS_CLI_ASCII[1] ?? '';
  const tagline = chalk.bold.cyan(' · sub-agent progress watch');
  const projLine = chalk.gray(`  project: ${projectRoot}`);
  const pathLine = chalk.gray(`  path:    ${progressFilePath}`);
  return (
    chalk.bold.cyan(`  ${brandLeft}${tagline}`) + '\n' +
    chalk.bold.cyan(`  ${brandRight}`) + '\n' +
    chalk.gray('  ' + '─'.repeat(60)) + '\n' +
    projLine + '\n' +
    pathLine + '\n'
  );
}

/**
 * Render the 2-line dynamic dashboard. Status row on top
 * (spinner + phase + elapsed + step), progress bar on the
 * bottom. When `data` is null (no progress file yet), we
 * still show a live spinner + a "waiting…" message so the
 * user knows the watch is alive.
 */
function renderDynamicRows(
  data: SubAgentProgress | null,
  tick: number,
  width: number,
  isTty: boolean
): { status: string; bar: string } {
  const progressFraction = computeFakeProgress(data);
  if (data === null) {
    return {
      status: isTty
        ? `  ${chalk.gray(pickSpinnerFrame(tick))}  ${chalk.gray('idle')}    ${chalk.gray('(no progress file yet — sub-agent has not started)')}`
        : `idle (no progress file yet)`,
      bar: isTty ? renderBar(0, width, isTty) : ''
    };
  }
  const startedAtMs = new Date(data.current.startedAt).getTime();
  const elapsedMs = Number.isNaN(startedAtMs) ? 0 : Math.max(0, Date.now() - startedAtMs);
  const phase = PHASE_LABEL[data.current.phase];
  const step = data.current.step.length > 60 ? data.current.step.slice(0, 57) + '...' : data.current.step;
  const verdict = data.current.verdict ? `  verdict=${data.current.verdict}` : '';
  const role = data.role ? `  role=${data.role}` : '';
  const spinner = pickSpinnerFrame(tick);
  if (!isTty) {
    return {
      status: `${spinner} ${phase} ${formatElapsed(elapsedMs)} ${step}${role}${verdict}`,
      bar: ''
    };
  }
  const colorize = PHASE_COLOR[data.current.phase] ?? chalk.cyan;
  const spinnerColor = phase === 'failed' ? chalk.red
    : phase === 'finished' ? chalk.green
    : chalk.cyan;
  const statusLine = `  ${spinnerColor(spinner)}  ${colorize(phase.padEnd(11))}  ${chalk.yellow(formatElapsed(elapsedMs))}  ${step}${chalk.gray(role)}${verdict ? chalk.gray(verdict) : ''}`;
  return {
    status: statusLine,
    bar: renderBar(progressFraction, width, isTty)
  };
}

function renderBar(fraction: number, width: number, isTty: boolean): string {
  if (!isTty) return '';
  // 8ths-of-cell block characters: ░ (empty) U+2591, full blocks
  // U+2588..U+258F for the partial last cell.
  const barCells = Math.max(10, Math.min(50, Math.floor(width * 0.4)));
  const filled = Math.round(barCells * Math.max(0, Math.min(1, fraction)) * 8);
  const fullBlocks = Math.floor(filled / 8);
  const fracBlock = filled % 8;
  const emptyCells = barCells * 8 - filled;
  const fullStr = '█'.repeat(fullBlocks);
  const fracStr = fracBlock > 0 ? String.fromCharCode(0x2588 + (8 - fracBlock)) : '';
  const emptyStr = '░'.repeat(Math.floor(emptyCells / 8));
  const percent = String(Math.round(fraction * 100)).padStart(3, ' ');
  return `  ${chalk.green(fullStr + fracStr + emptyStr)}  ${chalk.gray(`${percent}%`)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Public renderer. Holds the cursor state and handles the
// in-place overwrite.
// ─────────────────────────────────────────────────────────────────────

export type WatchRendererOptions = {
  projectRoot: string;
  progressFilePath: string;
};

export class WatchRenderer {
  private readonly projectRoot: string;
  private readonly progressFilePath: string;
  private readonly width: number;
  private readonly isTty: boolean;
  private hasRenderedDynamic = false;

  constructor(options: WatchRendererOptions) {
    this.projectRoot = options.projectRoot;
    this.progressFilePath = options.progressFilePath;
    this.width = (process.stdout.columns ?? 120) - 1;
    this.isTty = process.stdout.isTTY === true;
  }

  /**
   * Paint the static header once at the top of the watch
   * (the PEAKS-CLI wordmark, separator, project, path). Then
   * paint the dynamic rows for the first tick. From here on
   * the dynamic rows are the only thing we touch.
   */
  start(): void {
    rawWrite(renderHeader(this.projectRoot, this.progressFilePath, this.isTty));
    this.paintDynamicOnce(null, 0);
  }

  /**
   * Repaint the 2 dynamic rows in place. First call moves
   * the cursor up N rows from the bottom of the previously
   * painted block; subsequent calls do the same.
   */
  tick(data: SubAgentProgress | null, tickCount: number): void {
    if (this.hasRenderedDynamic) {
      // Move cursor up to the top of the previously-painted
      // dynamic block.
      rawWrite(CURSOR_UP_N(DYNAMIC_LINES));
    }
    this.paintDynamicOnce(data, tickCount);
  }

  private paintDynamicOnce(data: SubAgentProgress | null, tick: number): void {
    const { status, bar } = renderDynamicRows(data, tick, this.width, this.isTty);
    // Erase-then-rewrite the status row.
    rawWrite(ERASE_LINE + status + '\n');
    // Erase-then-rewrite the bar row. (In non-TTY mode the
    // bar is empty; we still emit a newline so the line
    // count stays consistent.)
    rawWrite(ERASE_LINE + bar + '\n');
    this.hasRenderedDynamic = true;
  }

  /**
   * Paint a final 2-line verdict + a farewell line below the
   * dashboard, then return. The cursor stays at the bottom
   * of the farewell so the user's shell prompt lands on the
   * next row.
   */
  finalize(data: SubAgentProgress): void {
    // Rewrite the dynamic block one last time so the user can
    // read the verdict.
    if (this.hasRenderedDynamic) {
      rawWrite(CURSOR_UP_N(DYNAMIC_LINES));
    }
    this.paintDynamicOnce(data, Number.MAX_SAFE_INTEGER);
    // Then emit the farewell BELOW the dashboard, in green.
    const verdictSuffix = data.current.verdict !== undefined ? ` (verdict=${data.current.verdict})` : '';
    const farewell = this.isTty
      ? chalk.green(`✔ peaks progress watch: sub-agent reached phase=${data.current.phase}${verdictSuffix} at ${new Date().toISOString()}. Auto-closing watch window.`)
      : `peaks progress watch: sub-agent reached phase=${data.current.phase}${verdictSuffix} at ${new Date().toISOString()}. Auto-closing watch window.`;
    rawWrite(ERASE_LINE + farewell + '\n');
  }

  /**
   * Force a non-ANSI snapshot of the current state, used by
   * the `--once` mode and for fallback when stdout is not a
   * TTY. Does NOT touch the cursor state — safe to call from
   * any context.
   */
  static snapshot(data: SubAgentProgress | null): { status: string; bar: string } {
    return renderDynamicRows(data, 0, 80, false);
  }
}

/**
 * Strip ANSI escapes from a string. Used for visible-length
 * accounting; not for re-painting.
 */
export function stripAnsi(input: string): string {
  // eslint-disable-next-line no-control-regex
  return input.replace(/\x1b\[[0-9;]*m/g, '');
}

/** Reset terminal SGR — used on early-return error paths. */
export function resetTerminal(): void {
  rawWrite(RESET);
}
