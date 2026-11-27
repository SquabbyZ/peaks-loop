/**
 * `peaks sub-agent verify-files` — the post-run merge gate for the fast lane.
 *
 * `--lane fast` refuses a DAG whose declared `files[]` sets are not pairwise
 * disjoint, but the static check cannot see where a sub-agent actually wrote.
 * This command reads the same DAG, unions its declared files, reads the
 * working tree's changed files from git, and reports `declared`, `changed`
 * and `outside`. A non-empty `outside` is an escaped write: the envelope is
 * refused with FAST_LANE_FILES_ESCAPED and the caller must abort the merge.
 *
 * Nested under the existing `sub-agent` verb — users never type it; the
 * orchestrating LLM runs it on their behalf.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { Command } from 'commander';
import { fail, getErrorMessage, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import { validateDag, type SliceDag } from '../../services/dispatch/slice-dag.js';
import {
  computeFileEscape,
  declaredFilesFromDag,
  parsePorcelainZ,
  type FileEscapeReport
} from '../../services/dispatch/fast-lane-verify.js';

export interface VerifyFilesOptions {
  dag?: string;
  project?: string;
  json?: boolean;
}

/** One named refusal, as the fields the envelope needs. */
interface VerifyFailure {
  readonly code: string;
  readonly message: string;
  readonly nextActions: readonly string[];
}

const COMMAND = 'sub-agent.verify-files';
/** Cap on `git status` stdout (64 MiB): a larger tree fails loudly instead of truncating. */
// eslint-disable-next-line no-magic-numbers -- a byte count, not a policy number
const MAX_GIT_STDOUT_BYTES = 64 * 1024 * 1024;

export function registerVerifyFilesCommand(parent: Command, io: ProgramIO): void {
  addJsonOption(
    parent
      .command('verify-files')
      .description(
        'Fast-lane merge gate: union the declared files[] of a `--lane fast` DAG, read the ' +
          'working tree changes from git, and report declared/changed/outside. A non-empty ' +
          'outside triggers FAST_LANE_FILES_ESCAPED and must abort the merge.'
      )
      .option('--dag <file>', 'the same SliceDag JSON file used for the fast-lane dispatch')
      .option('--project <path>', 'target project root (defaults to cwd)')
  ).action((options: VerifyFilesOptions) => {
    verifyFiles(options, io);
  });
}

function verifyFiles(options: VerifyFilesOptions, io: ProgramIO): void {
  const asJson = options.json === true;
  const dagPath = options.dag;
  if (typeof dagPath !== 'string' || dagPath.length === 0) {
    refuse(io, asJson, {
      code: 'MISSING_DAG',
      message: 'pass --dag <file>',
      nextActions: ['Pass the same DAG file used for `peaks sub-agent dispatch --lane fast`.']
    });
    return;
  }
  const dag = loadDagOrFail(dagPath, io, asJson);
  if (dag === null) return;
  const projectRoot = options.project ?? process.cwd();
  const changed = readChangedOrFail(projectRoot, io, asJson);
  if (changed === null) return;
  emitEscapeGate(computeFileEscape(declaredFilesFromDag(dag), changed), io, asJson);
}

function loadDagOrFail(dagPath: string, io: ProgramIO, asJson: boolean): SliceDag | null {
  try {
    const dag = JSON.parse(readFileSync(dagPath, 'utf8')) as SliceDag;
    validateDag(dag);
    return dag;
  } catch (err) {
    refuse(io, asJson, {
      code: 'INVALID_DAG',
      message: `failed to read or validate DAG from ${dagPath}: ${getErrorMessage(err)}`,
      nextActions: ['Check the JSON file; the DAG must have {nodes, edges} and pass validateDag().']
    });
    return null;
  }
}

function readChangedOrFail(projectRoot: string, io: ProgramIO, asJson: boolean): string[] | null {
  try {
    return readChangedFiles(projectRoot);
  } catch (err) {
    refuse(io, asJson, {
      code: 'FAST_LANE_GIT_FAILED',
      message: `git status failed in ${projectRoot}: ${getErrorMessage(err)}`,
      nextActions: [
        'verify-files reads the working tree with git; run it inside the repository the fast lane wrote to.'
      ]
    });
    return null;
  }
}

function emitEscapeGate(report: FileEscapeReport, io: ProgramIO, asJson: boolean): void {
  if (report.outside.length > 0) {
    printResult(
      io,
      fail(
        COMMAND,
        'FAST_LANE_FILES_ESCAPED',
        `the working tree changed ${report.outside.length} file(s) outside the declared union: ${report.outside.join(', ')}`,
        { ok: false, ...report },
        [
          'Abort the merge: keep the work in the main window and settle each outside file by hand.',
          'Add the file to a node files[] and re-dispatch only if the write was intended.'
        ]
      ),
      asJson
    );
    process.exitCode = 1;
    return;
  }
  printResult(
    io,
    ok(
      COMMAND,
      { ok: true, ...report },
      [],
      [
        'Every changed file is inside the declared union; the main window may make the single commit.'
      ]
    ),
    asJson
  );
}

function readChangedFiles(projectRoot: string): string[] {
  const stdout = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: MAX_GIT_STDOUT_BYTES,
    windowsHide: true
  });
  return parsePorcelainZ(stdout);
}

function refuse(io: ProgramIO, asJson: boolean, failure: VerifyFailure): void {
  printResult(
    io,
    fail(COMMAND, failure.code, failure.message, emptyReport(), [...failure.nextActions]),
    asJson
  );
  process.exitCode = 1;
}

function emptyReport(): FileEscapeReport & { readonly ok: false } {
  return { ok: false, declared: [], changed: [], outside: [] };
}
