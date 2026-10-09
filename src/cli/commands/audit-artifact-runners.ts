/**
 * `peaks audit artifact` runners — first-class CLI surface for the 4 audit
 * artifact types. Replaces the 2026-06-22 "hand `git add` into
 * .peaks/memory/" anti-pattern that left 4 orphan files. Each kind routes to
 * exactly one writer in artifact-writer.ts; the writer enforces canonical
 * frontmatter, so the memory-shape guard never fires for new writes.
 *
 * The action body moved out of `audit-commands.ts` verbatim; the registrar now
 * only wires the commands and delegates. Every envelope, error code and hint
 * string is unchanged.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  writeDecision,
  writeMachineOutput,
  writeNarrative,
  writePrompt,
  type ArtifactKind,
  type ArtifactWriteRecord
} from '../../services/audit/artifact-writer.js';
import {
  parseRedLineAuditInput,
  RedLineAuditInputError
} from '../../services/audit/red-line-audit-input.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  isSupportedArtifactKind,
  PROJECT_PATH_HINT,
  SUPPORTED_ARTIFACT_KINDS,
  validateProjectRoot,
  type ArtifactWriteOptions
} from './audit-command-shared.js';
import { emptyArtifactWriteRecord } from './audit-refusal-data.js';

export const ARTIFACT_GROUP_DESCRIPTION =
  'Manage audit artifacts (decision / prompt / machine-output / narrative) under .peaks/memory/';

export const ARTIFACT_WRITE_DESCRIPTION =
  'Persist a single audit artifact to .peaks/memory/ via the artifact-writer (canonical frontmatter)';

const INPUT_PATH_HINT = 'Verify the --input path is correct (relative paths resolve against cwd)';

/** Length of the `YYYY-MM-DD` prefix of an ISO timestamp. */
const ISO_DATE_LENGTH = 10;

/** The `--kind` switch: one writer per artifact kind, nothing else. */
type ArtifactWriteRequest = {
  readonly kind: ArtifactKind;
  readonly inputAbs: string;
  readonly baseName: string;
  readonly description: string;
  readonly projectRoot: string;
  readonly dryRun: boolean;
  readonly rid?: string;
};

/** The accepted request plus the I/O it reports through, once the guards pass. */
type ArtifactPersistRequest = ArtifactWriteRequest & {
  readonly io: ProgramIO;
  readonly json: boolean | undefined;
};

type ArtifactWriteRefusal = {
  readonly io: ProgramIO;
  readonly json: boolean | undefined;
  readonly kind: ArtifactKind;
  readonly code: string;
  readonly message: string;
  readonly nextActions: string[];
};

/**
 * Names the unreachable `--kind` without tripping the template-expression rule:
 * by the time the `default` arm runs, the narrowing has reduced `kind` to
 * `never`, so the message is built from a `string` parameter instead.
 */
function unreachableKindError(kind: string): Error {
  return new Error(`unreachable: kind=${kind}`);
}

function refuseArtifactWrite(refusal: ArtifactWriteRefusal): void {
  printResult(
    refusal.io,
    fail<ArtifactWriteRecord>(
      'audit.artifact.write',
      refusal.code,
      refusal.message,
      emptyArtifactWriteRecord(refusal.kind),
      refusal.nextActions
    ),
    refusal.json
  );
  process.exitCode = 1;
}

function writeByKind(request: ArtifactWriteRequest): ArtifactWriteRecord {
  const writeOpts = {
    projectRoot: request.projectRoot,
    dryRun: request.dryRun,
    ...(request.rid ? { rid: request.rid } : {})
  };
  switch (request.kind) {
    case 'prompt': {
      const body = readFileSync(request.inputAbs, 'utf8');
      return writePrompt(
        { name: request.baseName, description: request.description, body },
        writeOpts
      );
    }
    case 'machine-output': {
      const json = readFileSync(request.inputAbs, 'utf8');
      return writeMachineOutput(
        { name: request.baseName, description: request.description, json },
        writeOpts
      );
    }
    case 'narrative': {
      const body = readFileSync(request.inputAbs, 'utf8');
      return writeNarrative(
        { name: request.baseName, description: request.description, body },
        writeOpts
      );
    }
    case 'decision': {
      // `--input` is a RedLineAudit JSON document — typically
      // an archived `peaks audit static` result — validated field by field
      // before it reaches the writer, because the writer renders whatever
      // it is given into a memory record with no further checks.
      // `--name` and `--description` do not apply: the decision slug and
      // title come from the scan date (and `--rid`), exactly as
      // `peaks audit static --record` derives them.
      const audit = parseRedLineAuditInput(readFileSync(request.inputAbs, 'utf8'));
      return writeDecision(audit, writeOpts);
    }
    default: {
      // Unreachable: isSupportedArtifactKind already filtered.
      throw unreachableKindError(request.kind);
    }
  }
}

function artifactWriteNextActions(record: ArtifactWriteRecord): string[] {
  return [
    `Artifact written via ${record.kind} writer.`,
    record.indexSynced
      ? 'Memory index regenerated; entry will appear in `peaks project memories` on next read.'
      : 'Memory index NOT regenerated; run `peaks project memories --project <root>` to refresh.'
  ];
}

function persistArtifact(request: ArtifactPersistRequest): void {
  let record: ArtifactWriteRecord;
  try {
    record = writeByKind(request);
  } catch (err) {
    // A malformed decision input is the caller's document, not a write
    // failure: name it as input so the remedy reads as "fix the JSON field".
    refuseArtifactWrite({
      io: request.io,
      json: request.json,
      kind: request.kind,
      code: err instanceof RedLineAuditInputError ? 'AUDIT_ARTIFACT_INPUT_INVALID' : 'WRITE_FAILED',
      message: getErrorMessage(err),
      nextActions:
        err instanceof RedLineAuditInputError
          ? [
              'Inspect the named field; --kind decision takes the JSON shape `peaks audit static --json` prints.'
            ]
          : ['Inspect the error message; for --kind machine-output ensure --input is valid JSON']
    });
    return;
  }

  printResult(
    request.io,
    ok<ArtifactWriteRecord>('audit.artifact.write', record, [], artifactWriteNextActions(record)),
    request.json
  );
}

/** The accepted request, or the refusal that was already printed. */
type ArtifactPrecheck =
  | {
      readonly ok: true;
      readonly projectRoot: string;
      readonly kind: ArtifactKind;
      readonly inputAbs: string;
    }
  | { readonly ok: false };

/**
 * The three refusals `--project`, `--kind` and `--input` can earn, in the
 * order the original action checked them. Prints the envelope and sets the
 * exit code on failure.
 */
function precheckArtifactWrite(options: ArtifactWriteOptions, io: ProgramIO): ArtifactPrecheck {
  const validation = validateProjectRoot(options.project);
  if (!validation.ok) {
    refuseArtifactWrite({
      io,
      json: options.json,
      kind: 'narrative',
      code: validation.code,
      message: validation.message,
      nextActions: [PROJECT_PATH_HINT]
    });
    return { ok: false };
  }

  if (!isSupportedArtifactKind(options.kind)) {
    refuseArtifactWrite({
      io,
      json: options.json,
      kind: 'narrative',
      code: 'INVALID_KIND',
      message: `Unknown --kind "${options.kind}". Supported: ${SUPPORTED_ARTIFACT_KINDS.join(', ')}.`,
      nextActions: [
        `Re-run with --kind <one of ${SUPPORTED_ARTIFACT_KINDS.join(' | ')}>`,
        'See .peaks/memory/audit-artifact-convention.md for the 4 artifact types.'
      ]
    });
    return { ok: false };
  }

  const inputAbs = resolve(options.input);
  if (!existsSync(inputAbs)) {
    refuseArtifactWrite({
      io,
      json: options.json,
      kind: options.kind,
      code: 'INPUT_NOT_FOUND',
      message: `--input file not found: ${options.input}`,
      nextActions: [INPUT_PATH_HINT]
    });
    return { ok: false };
  }

  return { ok: true, projectRoot: validation.projectRoot, kind: options.kind, inputAbs };
}

export function runArtifactWrite(options: ArtifactWriteOptions, io: ProgramIO): void {
  const precheck = precheckArtifactWrite(options, io);
  if (!precheck.ok) {
    return;
  }

  const baseName = options.name ?? options.input.split(/[\\/]/).pop() ?? 'untitled';
  const description =
    options.description ??
    `Audit artifact (${precheck.kind}) archived via peaks audit artifact write on ${new Date().toISOString().slice(0, ISO_DATE_LENGTH)}.`;
  persistArtifact({
    io,
    json: options.json,
    kind: precheck.kind,
    inputAbs: precheck.inputAbs,
    baseName,
    description,
    projectRoot: precheck.projectRoot,
    dryRun: options.dryRun === true,
    ...(options.rid ? { rid: options.rid } : {})
  });
}
