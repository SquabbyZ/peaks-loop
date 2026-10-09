/**
 * The `share` action body for `peaks sub-agent`, moved out of
 * `share-commands.ts` so that registrar file stays under the line cap.
 *
 * The registrar keeps the command shape (name, description, options) and
 * delegates to `runShare` here. Every envelope field, error code, hint text and
 * log entry is byte-identical to the pre-split version.
 */
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';
import {
  SHARED_CHANNEL_SOFT_VALUE_WARN,
  writeSharedEntry,
  type WriteSharedEntryResult
} from 'peaks-loop-shared-channel';

import { printResult, type ProgramIO } from '../cli-helpers.js';
import { writeLogEntry } from '../../services/log/logger.js';
import type { ShareOptions } from './sub-agent-shared.js';
import { shareErrorNextActions } from './share-error-hints.js';
import { resolveSessionId } from './share-identity.js';

/** The identity fields a share stamps into its channel entry. */
interface ShareIdentity {
  readonly sid: string;
  readonly rid: string;
  readonly from: string;
}

export function runShare(options: ShareOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  if (!options.batch || !options.key || !options.value) {
    printResult(
      io,
      fail(
        'sub-agent.share',
        'MISSING_ARG',
        '--batch, --key, and --value are required',
        { ok: false } as never,
        ['Re-run with --batch <batchId> --key <key> --value <jsonObject>.']
      ),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  const parsed = parseShareValue(options.value);
  if (!parsed.ok) {
    printResult(
      io,
      fail(
        'sub-agent.share',
        'INVALID_VALUE',
        `value must be a JSON object: ${parsed.message}`,
        { ok: false } as never,
        ['Pass --value as a JSON object literal, e.g. --value \'{"reason":"x"}\'.']
      ),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  writeShareEntry({
    options,
    io,
    asJson,
    batch: options.batch,
    key: options.key,
    parsedValue: parsed.value
  });
}

/**
 * Parse `--value`, which must be a JSON object literal. Mirrors the original
 * inline parse: a parse failure and a non-object parse both surface as
 * `INVALID_VALUE` carrying the thrown message.
 */
function parseShareValue(
  raw: string
): { ok: true; value: Record<string, unknown> } | { ok: false; message: string } {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('value must be a JSON object');
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch (err) {
    return { ok: false, message: getErrorMessage(err) };
  }
}

function resolveShareIdentity(options: ShareOptions, projectRoot: string): ShareIdentity {
  return {
    sid: resolveSessionId(options, projectRoot),
    rid: options.requestId ?? 'unknown-rid',
    from: options.from ?? 'unknown-role'
  };
}

function writeShareEntry(input: {
  options: ShareOptions;
  io: ProgramIO;
  asJson: boolean;
  batch: string;
  key: string;
  parsedValue: Record<string, unknown>;
}): void {
  try {
    const projectRoot = input.options.project ?? process.cwd();
    const { sid, rid, from } = resolveShareIdentity(input.options, projectRoot);

    const result = writeSharedEntry({
      projectRoot,
      sid,
      rid,
      batchId: input.batch,
      key: input.key,
      from,
      value: input.parsedValue
    });

    if (!result.ok) {
      reportShareFailure(result, input.batch, input.io, input.asJson);
      return;
    }

    printShareSuccess({
      result,
      batch: input.batch,
      key: input.key,
      io: input.io,
      asJson: input.asJson
    });
    logShareWrite({
      sid,
      batchId: input.batch,
      key: input.key,
      valueSize: result.entry.valueSize,
      lastWriteWins: result.lastWriteWins
    });
  } catch (error: unknown) {
    reportShareError(error, input.batch, input.io, input.asJson);
  }
}

/** Report a thrown share failure, mapping a missing error code to `SHARE_ERROR`. */
function reportShareError(error: unknown, batch: string, io: ProgramIO, asJson: boolean): void {
  const code = (error as { code?: string }).code ?? 'SHARE_ERROR';
  printResult(
    io,
    fail('sub-agent.share', code, getErrorMessage(error), { ok: false, batchId: batch } as never, [
      shareErrorNextActions(code)
    ]),
    asJson
  );
  process.exitCode = 1;
}

function reportShareFailure(
  result: Extract<WriteSharedEntryResult, { ok: false }>,
  batch: string,
  io: ProgramIO,
  asJson: boolean
): void {
  const code = result.code;
  printResult(
    io,
    fail('sub-agent.share', code, result.message, { ok: false, batchId: batch } as never, [
      code === 'VALUE_TOO_LARGE'
        ? 'Reduce value size; 1KB is a soft warning, 64KB is a hard reject.'
        : 'See error message; check --batch, --key, --value arguments.'
    ]),
    asJson
  );
  process.exitCode = 1;
}

function printShareSuccess(input: {
  result: Extract<WriteSharedEntryResult, { ok: true }>;
  batch: string;
  key: string;
  io: ProgramIO;
  asJson: boolean;
}): void {
  const warnings: string[] = [];
  if (input.result.lastWriteWins) {
    warnings.push('LAST_WRITE_WINS');
  }
  if (input.result.softWarning) {
    warnings.push(
      `VALUE_SIZE_SOFT_WARN: ${input.result.entry.valueSize} > ${SHARED_CHANNEL_SOFT_VALUE_WARN} bytes`
    );
  }

  printResult(
    input.io,
    ok(
      'sub-agent.share',
      {
        envelopeVersion: '2.1.0',
        ok: true,
        batchId: input.batch,
        entryKey: input.key,
        writtenAt: input.result.entry.at,
        channelSize: input.result.channelSize,
        lastWriteWins: input.result.lastWriteWins,
        valueSize: input.result.entry.valueSize
      },
      warnings,
      [
        'Sub-agents in the same batch can read this entry via `peaks sub-agent shared-read --batch ' +
          input.batch +
          '`.'
      ]
    ),
    input.asJson
  );
}

function logShareWrite(input: {
  sid: string;
  batchId: string;
  key: string;
  valueSize: number;
  lastWriteWins: boolean;
}): void {
  try {
    writeLogEntry({
      ts: new Date().toISOString(),
      level: 'info',
      command: 'sub-agent.share',
      msg: 'shared',
      sessionId: input.sid,
      batchId: input.batchId,
      data: {
        batchId: input.batchId,
        key: input.key,
        valueSize: input.valueSize,
        lastWriteWins: input.lastWriteWins
      }
    });
  } catch {
    // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
    /* best-effort */
  }
}
