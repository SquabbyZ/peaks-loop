// The `--mode detached` short-circuit of `peaks sub-agent dispatch`. It is lazy
// (the handler is imported on first use) and it returns before the warm-path
// in-process pipeline runs, so it lives in its own module.
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { DispatchOptions } from './sub-agent-shared.js';
import type { dispatch as detachedDispatchType } from './sub-agent/detached.js';
import { buildScratchPathInjection } from './dispatch-scratch-path-block.js';

function resolveMaxConcurrent(options: DispatchOptions): number | undefined {
  return typeof options.maxConcurrent === 'string' && options.maxConcurrent.length > 0
    ? Number.parseInt(options.maxConcurrent, 10)
    : undefined;
}

type DetachedDispatchResult = Awaited<ReturnType<typeof detachedDispatchType>>;

function reportDetachedResult(
  io: ProgramIO,
  result: DetachedDispatchResult,
  asJson: boolean
): void {
  // The handler's `ok` is the launch outcome (a vendor CLI that is not
  // installed is a failure, not a footnote) — the caller must not
  // re-wrap it as `ok()` unconditionally, which is how `ok: true` with
  // `pid: -1` reached the orchestrator.
  if (result.ok) {
    printResult(
      io,
      ok(result.command, result.data, result.warnings ?? [], result.nextActions ?? []),
      asJson
    );
  } else {
    printResult(
      io,
      fail(
        result.command,
        'DISPATCH_DETACHED_SPAWN_FAILED',
        `Could not launch the vendor CLI for a detached dispatch; nothing was started.`,
        result.data as never,
        result.nextActions ?? []
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

function reportDetachedError(io: ProgramIO, role: string, error: unknown, asJson: boolean): void {
  printResult(
    io,
    fail(
      'sub-agent.dispatch',
      'DISPATCH_DETACHED_ERROR',
      getErrorMessage(error),
      {
        role,
        toolCall: null,
        dispatchRecordPath: null
      } as never,
      [
        'If --mode detached fails on import, the peaks-loop-internal-runtime package may be missing; reinstall and retry.',
        'For environments without a vendor CLI on PATH, drop --mode to fall back to the default in-process dry-run.'
      ]
    ),
    asJson
  );
  process.exitCode = 1;
}

/**
 * The brief the vendor CLI receives: the caller's prompt plus the scratch
 * block.
 *
 * The scratch path is pinned HERE, in the brief itself: the detached path does
 * not pass through the prompt composer, so without this the leaf would pick its
 * own redirect target, and a cwd-relative one lands at the repository root. The
 * session id is resolved the way the detached handler resolves it, so both name
 * one directory.
 */
function detachedBrief(options: DispatchOptions, role: string): string {
  const projectRoot = options.project ?? process.cwd();
  const sid = process.env.PEAKS_SESSION_ID ?? 'local';
  const scratch = buildScratchPathInjection({ projectRoot, sid, role });
  const prompt = typeof options.prompt === 'string' ? options.prompt : '';
  return `${prompt}\n\n${scratch.block}`;
}

export async function runDetachedDispatch(
  io: ProgramIO,
  role: string,
  options: DispatchOptions,
  asJson: boolean
): Promise<void> {
  try {
    const { dispatch: detachedDispatch } = await import('./sub-agent/detached.js');
    const projectRoot = options.project ?? process.cwd();
    const maxConcurrent = resolveMaxConcurrent(options);
    const result = await detachedDispatch({
      role,
      prompt: detachedBrief(options, role),
      requestId: options.requestId ?? 'unknown-rid',
      mode: 'detached',
      ...(typeof options.vendor === 'string' ? { vendor: options.vendor } : {}),
      project: projectRoot,
      json: asJson,
      ...(options.noThrottle === true ? { noThrottle: true } : {}),
      ...(typeof maxConcurrent === 'number' && Number.isInteger(maxConcurrent) && maxConcurrent > 0
        ? { maxConcurrent }
        : {})
    });
    reportDetachedResult(io, result, asJson);
  } catch (error: unknown) {
    reportDetachedError(io, role, error, asJson);
  }
}
