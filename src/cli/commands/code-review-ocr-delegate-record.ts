/**
 * `peaks code-review ocr-delegate-record` — phase 2 of the no-credential path.
 *
 * Takes the host agent's findings envelope, validates it against the packet it
 * names, and records the findings with `ocr-delegate` attribution. No LLM call
 * and no provider key: the review already happened in the agent's own model.
 *
 * Split from the phase-1 verb along the same seam as the services: this file
 * never spawns OCR and never resolves a session.
 */
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  recordDelegateFindings,
  type RecordDelegateResult
} from '../../services/lint/ocr-18-delegate-record.js';

const COMMAND = 'code-review.ocr-delegate-record';

type Refusal = { readonly code: string; readonly message: string };

type RecordOptions = { packet: string; envelope: string; project?: string; json?: boolean };

function isRefusal(value: object): value is Refusal {
  return 'code' in value;
}

function readEnvelope(envelopePath: string): { ok: true; text: string } | Refusal {
  try {
    return { ok: true, text: readFileSync(envelopePath, 'utf8') };
  } catch (error: unknown) {
    return {
      code: 'ENVELOPE_INVALID',
      message: `--envelope must be a path to a readable JSON file: ${envelopePath} (${getErrorMessage(error)})`
    };
  }
}

function printRecorded(
  io: ProgramIO,
  options: RecordOptions,
  result: Extract<RecordDelegateResult, { ok: true }>
): void {
  printResult(
    io,
    ok(
      COMMAND,
      {
        state: result.document.state,
        attribution: result.document.attribution,
        packet: result.document.packet,
        findingsPath: result.findingsPath,
        findings: result.document.findings,
        summary: result.document.summary
      },
      result.replaced ? ['An earlier findings file for this packet was replaced.'] : [],
      [`Cite ${result.findingsPath} in the RD code-review artifact.`]
    ),
    options.json
  );
}

function recordAction(io: ProgramIO, options: RecordOptions): void {
  const envelope = readEnvelope(options.envelope);
  if (isRefusal(envelope)) {
    printResult(
      io,
      fail(COMMAND, envelope.code, envelope.message, { state: 'record-refused' }, [
        'Write the findings envelope first, then re-run this verb.'
      ]),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  const result = recordDelegateFindings({
    projectRoot: options.project ?? process.cwd(),
    packetPath: options.packet,
    envelopeText: envelope.text
  });
  if (!result.ok) {
    printResult(
      io,
      fail(COMMAND, result.code, result.message, { state: 'record-refused' }, [
        'Nothing was recorded — this is not a clean review.'
      ]),
      options.json
    );
    process.exitCode = 1;
    return;
  }
  printRecorded(io, options, result);
}

export function registerOcrDelegateRecordCommand(codeReview: Command, io: ProgramIO): void {
  addJsonOption(
    codeReview
      .command('ocr-delegate-record')
      .description(
        'Validate a host-agent findings envelope against its delegation packet and record it ' +
          'with `ocr-delegate` attribution. No LLM call and no provider key.'
      )
      .requiredOption(
        '--packet <path>',
        'the packet written by `run-ocr-18 --delegate --rid <rid>`'
      )
      .requiredOption(
        '--envelope <path>',
        'path to the JSON findings envelope file authored by the host agent'
      )
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: RecordOptions) => {
    recordAction(io, options);
  });
}
