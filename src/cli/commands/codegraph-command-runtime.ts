// src/cli/commands/codegraph-command-runtime.ts
//
// Shared invocation runtime for every `peaks codegraph <verb>`: the option
// shape they all extend, the failure envelope they all print, the hint
// rewriter that keeps upstream's bare `codegraph …` hints runnable, and the
// upstream proxy itself.
//
// Extracted verbatim from `codegraph-commands.ts` (rid
// 2026-09-17-oversize-and-scale, D1 — the 800-line file-size cap). Every moved
// line is byte-identical and no behaviour changed; `codegraph-commands.ts`
// re-exports `rewriteBareCodegraphHints` so the public surface is stable.
//
// This module is the BOTTOM of the codegraph CLI's import graph. It must not
// import `codegraph-commands.ts` or `codegraph-status-command.ts`, or the
// extraction would introduce a cycle.

import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphInvocationOptions
} from '../../services/codegraph/codegraph-service.js';
import { fail } from 'peaks-loop-shared/result';

import {
  getErrorMessage,
  printResult,
  redactSensitiveErrorMessage,
  type ProgramIO
} from '../cli-helpers.js';

export interface CommonCodegraphOptions {
  project: string;
  peaksJson?: boolean;
}

export function printCodegraphFailure(
  io: ProgramIO,
  command: string,
  error: unknown,
  asJson?: boolean,
  exitCode = 1
): void {
  printResult(
    io,
    fail(
      command,
      'CODEGRAPH_COMMAND_FAILED',
      redactSensitiveErrorMessage(getErrorMessage(error)),
      {},
      ['Check the codegraph command options and project path before retrying']
    ),
    asJson
  );
  process.exitCode = exitCode;
}

/**
 * Rewrites bare upstream `codegraph <subcommand>` hints to the peaks-loop
 * equivalent (`peaks codegraph <subcommand>`). The upstream binary is a
 * nested transitive dependency and is NOT on PATH, so an LLM that follows
 * a bare hint like `Run "codegraph init" to initialize` would hit
 * "command not found". Already-prefixed `peaks codegraph ...` hints and
 * other `codegraph` references (e.g. `@colbymchenry/codegraph`) are left
 * untouched.
 */
export function rewriteBareCodegraphHints(text: string): string {
  return text.replace(
    /(?<![\w-])(?<!peaks\s)codegraph(?=\s+(?:status|init|index|query|files|context|affected)\b)/g,
    'peaks codegraph'
  );
}

/**
 * Proxy one upstream invocation. Returns whether UPSTREAM FAILED — the
 * caller needs that to rank the exit-code precedence (an upstream failure
 * outranks every localized integrity verdict: see the tail of
 * `runCodegraphStatusCommand`), and it cannot re-derive it from
 * `process.exitCode` once a later branch has overwritten it.
 *
 * Callers that do not rank precedence (every command but `status`) simply
 * ignore the return value.
 */
export async function runCodegraphCommand(
  io: ProgramIO,
  command: string,
  options: CodegraphInvocationOptions,
  asJson?: boolean,
  attributeStdout?: (text: string) => string
): Promise<boolean> {
  try {
    const invocation = createCodegraphInvocation(options);
    const result = await executeCodegraphInvocation(invocation);

    if (result.exitCode !== null && result.exitCode !== 0 && asJson === true) {
      printCodegraphFailure(
        io,
        command,
        new Error(
          result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`
        ),
        true,
        result.exitCode
      );
      return true;
    }

    const didFail = result.exitCode !== null && result.exitCode !== 0;
    const rewritten = rewriteBareCodegraphHints(result.stdout);
    const stdout = attributeStdout === undefined ? rewritten : attributeStdout(rewritten);
    const stderr = rewriteBareCodegraphHints(result.stderr);

    if (stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(stdout) : stdout).trimEnd());
    }

    if (stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(stderr) : stderr).trimEnd());
    }

    if (didFail) {
      process.exitCode = result.exitCode;
    }

    return didFail;
  } catch (error) {
    printCodegraphFailure(io, command, error, asJson);
    return true;
  }
}
