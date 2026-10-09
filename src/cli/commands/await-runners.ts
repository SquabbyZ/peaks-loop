/**
 * The `await` action body for `peaks sub-agent`, moved out of
 * `share-commands.ts` so that registrar file stays under the line cap.
 *
 * The registrar keeps the command shape and delegates here. The per-IDE
 * dispatcher is INJECTED (`resolveIde`) rather than imported: the module that
 * consumes the IDE registry is `share-commands.ts`, which is the file the
 * vendor-neutral identity guard measures — so this module never names the
 * registry and never becomes a second consumer.
 */
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type {
  SubAgentAwaitBatchInput,
  SubAgentBatchResult,
  SubAgentDispatcher
} from '../../services/dispatch/sub-agent-dispatcher-types.js';
import { summarizeBatchResults, type AwaitOptions } from './sub-agent-shared.js';
import { awaitErrorNextActions } from './share-error-hints.js';
import { resolveSessionId } from './share-identity.js';
import { resolveBatchRecords } from './share-record-paths.js';

/** The per-IDE dispatcher resolution the await CLI needs, plus the id it named. */
export interface AwaitIdeResolution {
  readonly ide: string;
  readonly dispatcher: SubAgentDispatcher;
}

/** Injected resolver so this module never imports the IDE registry itself. */
export type ResolveIdeDispatcher = (projectRoot: string) => Promise<AwaitIdeResolution>;

export async function runAwait(
  options: AwaitOptions,
  io: ProgramIO,
  resolveIde: ResolveIdeDispatcher
): Promise<void> {
  const asJson = options.json === true;
  if (!options.batch) {
    printResult(
      io,
      fail('sub-agent.await', 'MISSING_BATCH', '--batch is required', { ok: false } as never, [
        'Re-run with --batch <batchId> from a dispatch envelope.'
      ]),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  const parsed = parseAwaitTimeout(options.timeout, io, asJson);
  if (!parsed.ok) return;
  const projectRoot = options.project ?? process.cwd();
  const sid = resolveSessionId(options, projectRoot);
  // Lazy-import IDE modules so `peaks sub-agent share` and
  // `peaks sub-agent shared-read` (the high-frequency G8.4 path) do not
  // pay for adapter resolution at module-load time.
  const resolved = await resolveIde(projectRoot);
  const awaitBatch = resolved.dispatcher.awaitBatch?.bind(resolved.dispatcher);
  if (typeof awaitBatch !== 'function') {
    reportIdeNotSupported(resolved.ide, io, asJson);
    return;
  }
  await runAwaitBatch({
    options,
    io,
    asJson,
    projectRoot,
    sessionId: sid,
    batch: options.batch,
    timeoutMs: parsed.timeoutMs,
    label: resolved.dispatcher.label,
    awaitBatch
  });
}

/**
 * Report a dispatcher with no `awaitBatch`. Every built-in adapter has one since
 * slice 1.3, so this names a custom adapter registered outside the built-in set.
 */
function reportIdeNotSupported(ide: string, io: ProgramIO, asJson: boolean): void {
  printResult(
    io,
    fail(
      'sub-agent.await',
      'IDE_NOT_SUPPORTED',
      `IDE ${ide} does not support awaitBatch`,
      { ok: false } as never,
      [
        'Every built-in adapter has an awaitBatch since slice 1.3; a dispatcher without one is a custom adapter registered outside the built-in set.'
      ]
    ),
    asJson
  );
  process.exitCode = 1;
}

/**
 * Validate `--timeout`. Absent means "no cap"; anything present must be a
 * positive integer. A rejected value prints `INVALID_TIMEOUT` and sets the
 * non-zero exit code exactly where the original inline check did.
 */
function parseAwaitTimeout(
  raw: string | undefined,
  io: ProgramIO,
  asJson: boolean
): { ok: true; timeoutMs: number | undefined } | { ok: false } {
  if (typeof raw === 'string' && raw.length > 0) {
    const n = Number.parseInt(raw, 10);
    if (!Number.isInteger(n) || n <= 0) {
      printResult(
        io,
        fail(
          'sub-agent.await',
          'INVALID_TIMEOUT',
          `--timeout must be a positive integer ms (got ${raw})`,
          { ok: false } as never,
          ['Pass an integer like --timeout 60000.']
        ),
        asJson
      );
      process.exitCode = 1;
      return { ok: false };
    }
    return { ok: true, timeoutMs: n };
  }
  return { ok: true, timeoutMs: undefined };
}

async function runAwaitBatch(input: {
  options: AwaitOptions;
  io: ProgramIO;
  asJson: boolean;
  projectRoot: string;
  sessionId: string;
  batch: string;
  timeoutMs: number | undefined;
  label: string;
  awaitBatch: (batchInput: SubAgentAwaitBatchInput) => Promise<readonly SubAgentBatchResult[]>;
}): Promise<void> {
  try {
    // session's dispatch directory. `recordPaths` used to be hardcoded to
    // `[]`, and `awaitBatch` short-circuits on an empty list
    // (await-batch.ts:134) — so `await` reported zero results and exited 0
    // for every batch, forever. A batch we cannot locate is now a failure,
    // not a success with nothing in it.
    const { readRecord } = await import('../../services/dispatch/dispatch-record-writer.js');
    const scan = resolveBatchRecords({
      projectRoot: input.projectRoot,
      sessionId: input.sessionId,
      batchId: input.batch,
      readOne: readRecord
    });
    if (scan.recordPaths.length === 0) {
      reportNoDispatchRecords(scan, input);
      return;
    }
    const batchInput: SubAgentAwaitBatchInput = {
      batchId: input.batch,
      dispatchCount: scan.recordPaths.length,
      recordPaths: scan.recordPaths,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {})
    };
    const results = await input.awaitBatch(batchInput);
    printAwaitSuccess(results, scan, input);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code ?? 'AWAIT_ERROR';
    printResult(
      input.io,
      fail('sub-agent.await', code, getErrorMessage(error), { ok: false } as never, [
        awaitErrorNextActions(code)
      ]),
      input.asJson
    );
    process.exitCode = 1;
  }
}

function reportNoDispatchRecords(
  scan: { sessionDir: string; unreadable: string[] },
  input: { batch: string; io: ProgramIO; asJson: boolean }
): void {
  const unreadableNote =
    scan.unreadable.length > 0
      ? ` ${scan.unreadable.length} dispatch record(s) there could not be read, so they could not be matched to this batch: ${scan.unreadable.join(', ')}`
      : '';
  printResult(
    input.io,
    fail(
      'sub-agent.await',
      'NO_DISPATCH_RECORDS',
      `No dispatch record with batchId=${input.batch} under ${scan.sessionDir}.${unreadableNote}`,
      {
        ok: false,
        batchId: input.batch,
        sessionDir: scan.sessionDir,
        unreadableRecords: scan.unreadable
      } as never,
      [awaitErrorNextActions('NO_DISPATCH_RECORDS')]
    ),
    input.asJson
  );
  process.exitCode = 1;
}

function printAwaitSuccess(
  results: readonly SubAgentBatchResult[],
  scan: { unreadable: string[] },
  input: { batch: string; label: string; io: ProgramIO; asJson: boolean }
): void {
  const summary = summarizeBatchResults(results);
  printResult(
    input.io,
    ok(
      'sub-agent.await',
      {
        envelopeVersion: '2.1.0',
        batchId: input.batch,
        ide: input.label,
        results,
        summary,
        unreadableRecords: scan.unreadable
      },
      scan.unreadable.length > 0
        ? [
            `${scan.unreadable.length} unreadable dispatch record(s) in this session were skipped and are NOT part of the results: ${scan.unreadable.join(', ')}`
          ]
        : [],
      [
        // four non-Claude IDEs would report `awaitByLlm: <ide> 1.2 fallback`,
        // the slice-1.2 marker that slice 1.3 replaced with a real
        // file-polling await. The text survived because nothing tested it —
        // no adapter produces that note any more (asserted in
        // sub-agent-dispatchers.test.ts), and the emitter that produced it,
        // `awaitByLlmFallback`, has since been removed.
        `Each non-claude-code IDE labels its own results (see the \`note\` field), so a timed-out slot is attributable to the adapter it came from.`
      ]
    ),
    input.asJson
  );
}
