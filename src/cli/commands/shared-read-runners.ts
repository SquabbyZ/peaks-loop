/**
 * The `shared-read` action body for `peaks sub-agent`, split out of
 * `share-runners.ts` to keep each module under the line cap. The registrar in
 * `share-commands.ts` delegates here; the envelope, error code and hint text are
 * byte-identical to the pre-split version.
 */
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import { readSharedChannel } from 'peaks-loop-shared-channel';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import type { SharedReadOptions } from './sub-agent-shared.js';
import { sharedReadErrorNextActions } from './share-error-hints.js';
import { resolveSessionId } from './share-identity.js';

export function runSharedRead(options: SharedReadOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  if (!options.batch) {
    printResult(
      io,
      fail(
        'sub-agent.shared-read',
        'MISSING_BATCH',
        '--batch is required',
        { ok: false } as never,
        ['Re-run with --batch <batchId>.']
      ),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  try {
    printSharedReadSuccess(options, options.batch, io, asJson);
  } catch (error: unknown) {
    const code = (error as { code?: string }).code ?? 'SHARED_READ_ERROR';
    printResult(
      io,
      fail(
        'sub-agent.shared-read',
        code,
        getErrorMessage(error),
        { ok: false, batchId: options.batch } as never,
        [sharedReadErrorNextActions(code)]
      ),
      asJson
    );
    process.exitCode = 1;
  }
}

function printSharedReadSuccess(
  options: SharedReadOptions,
  batch: string,
  io: ProgramIO,
  asJson: boolean
): void {
  const projectRoot = options.project ?? process.cwd();
  const sid = resolveSessionId(options, projectRoot);
  const rid = options.requestId ?? 'unknown-rid';
  const channel = readSharedChannel({
    projectRoot,
    sid,
    rid,
    batchId: batch,
    ...(options.since !== undefined ? { since: options.since } : {}),
    ...(options.key !== undefined ? { keyPattern: options.key } : {})
  });
  printResult(
    io,
    ok(
      'sub-agent.shared-read',
      {
        envelopeVersion: '2.1.0',
        ok: true,
        batchId: batch,
        entries: channel.entries,
        totalEntries: Object.keys(channel.entries).length,
        channelSize: JSON.stringify(channel).length,
        updatedAt: channel.updatedAt
      },
      [],
      [
        'Shared channel is dispatcher-mediated; do not attempt to read sibling dispatch records directly.'
      ]
    ),
    asJson
  );
}
