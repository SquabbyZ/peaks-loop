// src/cli/commands/codegraph-proxy-commands.ts
//
// The `peaks codegraph` verbs that proxy one upstream invocation: `index`,
// `query`, `files`, `context` and `affected`. Split out of
// `codegraph-commands.ts`; the verb names, options and envelopes are
// unchanged.

import { resolve } from 'node:path';
import type { Command } from 'commander';
import { writeCodegraphAffectedContext } from '../../services/codegraph/codegraph-service.js';

import type { ProgramIO } from '../cli-helpers.js';
import { runCodegraphCommand, type CommonCodegraphOptions } from './codegraph-command-runtime.js';
import {
  addProjectOption,
  parsePositiveInteger,
  type CodegraphAffectedOptions,
  type CodegraphFilesOptions,
  type CodegraphIndexOptions,
  type CodegraphQueryOptions
} from './codegraph-command-options.js';

type AffectedEnvelope = ReturnType<typeof writeCodegraphAffectedContext>;

/**
 * The payload written into the codegraph-context envelope: the captured
 * upstream stdout, parsed as JSON when `--json` asked for JSON and the text
 * is parseable. A parse failure keeps the raw string, which the envelope
 * renderer handles cleanly.
 */
function resolveAffectedPayload(json: boolean | undefined, rawStdout: string): unknown {
  if (json !== true || rawStdout.length === 0) {
    return rawStdout;
  }
  try {
    return JSON.parse(rawStdout);
  } catch {
    return rawStdout;
  }
}

/** Report the envelope write on stdout, unless `--json` owns stdout. */
function reportAffectedEnvelope(
  io: ProgramIO,
  envelope: AffectedEnvelope,
  asJson: boolean | undefined
): void {
  if (asJson === true) return;
  io.stdout(
    envelope.written
      ? `[codegraph-context] wrote ${envelope.path}\n`
      : `[codegraph-context] skipped: ${envelope.warning}\n`
  );
}

/**
 * Probes `.codegraph/` for the peaks-loop marker before invoking the
 * upstream binary.
 *
 *   - fresh                          → proceed to upstream init
 *   - noop-already-peaks-loop        → skip upstream, emit warning
 *   - conflict-foreign-schema        → exit 73 + CODEGRAPH_INIT_CONFLICT envelope
 *
 * On a successful upstream init, write the marker so the next run
 * hits the noop branch instead of the conflict branch.
 *
 * Wraps the generic `runCodegraphCommand` and, after a successful
 * upstream invocation, calls `writeCodegraphAffectedContext` so the
 * RD / QA handoff can pick up `.peaks/_runtime/<sid>/rd/codegraph-context.md`
 * without re-running the (5-30 s) codegraph query.
 *
 * The envelope write is gated by `--write-envelope` (default off) so
 * ad-hoc CLI invocations don't silently mutate the user's session
 * directory. peaks-code's RD dispatch hook flips the flag on.
 *
 * On no-session-binding, we surface a `warning` field instead of
 * throwing — the upstream result is still printed so the caller
 * always sees the affected list.
 */
async function runCodegraphAffectedCommand(
  io: ProgramIO,
  files: string[],
  options: CodegraphAffectedOptions,
  asJson?: boolean
): Promise<void> {
  // Capture stdout so we can re-emit it into the envelope payload.
  // We still forward every line to the original `io.stdout` so the
  // user sees the affected list as if the wrapper were transparent.
  const capturedLines: string[] = [];
  const captureIo: ProgramIO = {
    stdout: (chunk: string) => {
      capturedLines.push(chunk);
      io.stdout(chunk);
    },
    stderr: (chunk: string) => io.stderr(chunk)
  };

  await runCodegraphCommand(
    captureIo,
    'codegraph.affected',
    {
      subcommand: 'affected',
      project: options.project,
      files,
      ...(options.json === true ? { json: true } : {})
    },
    asJson
  );

  if (!options.writeEnvelope) {
    return;
  }

  // The user opted in via --write-envelope. Run the envelope writer
  // unconditionally (graceful fallback when no session binding).
  const envelope = writeCodegraphAffectedContext({
    projectRoot: resolve(options.project),
    rid: options.rid ?? process.env.PEAKS_RD_RID ?? 'unknown-rid',
    files,
    affectedPayload: resolveAffectedPayload(options.json, capturedLines.join('\n'))
  });

  reportAffectedEnvelope(io, envelope, asJson);
}

export function registerCodegraphIndexCommands(codegraph: Command, io: ProgramIO): void {
  addProjectOption(
    codegraph
      .command('index')
      .description('Index a project with codegraph')
      .option('--force', 'force reindexing')
      .option('--quiet', 'reduce upstream output')
  ).action(async (options: CodegraphIndexOptions) => {
    // `runCodegraphCommand` returns "upstream failed" for the one caller
    // that ranks exit-code precedence (`status`); every other command just
    // awaits it, so it is discarded here rather than leaked to commander.
    await runCodegraphCommand(
      io,
      'codegraph.index',
      {
        subcommand: 'index',
        project: options.project,
        ...(options.force === true ? { force: true } : {}),
        ...(options.quiet === true ? { quiet: true } : {})
      },
      options.peaksJson
    );
  });

  addProjectOption(
    codegraph
      .command('query')
      .description('Query codegraph')
      .argument('<search>', 'search text')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--limit <n>', 'maximum result count', parsePositiveInteger)
  ).action(async (search: string, options: CodegraphQueryOptions) => {
    await runCodegraphCommand(
      io,
      'codegraph.query',
      {
        subcommand: 'query',
        project: options.project,
        search,
        ...(options.json === true ? { json: true } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {})
      },
      options.peaksJson
    );
  });
}

export function registerCodegraphFileCommands(codegraph: Command, io: ProgramIO): void {
  addProjectOption(
    codegraph
      .command('files')
      .description('List codegraph files')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--max-depth <n>', 'maximum traversal depth', parsePositiveInteger)
  ).action(async (options: CodegraphFilesOptions) => {
    await runCodegraphCommand(
      io,
      'codegraph.files',
      {
        subcommand: 'files',
        project: options.project,
        ...(options.json === true ? { json: true } : {}),
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {})
      },
      options.peaksJson
    );
  });

  addProjectOption(
    codegraph
      .command('context')
      .description('Build task context with codegraph')
      .argument('<task>', 'task text')
  ).action(async (task: string, options: CommonCodegraphOptions) => {
    await runCodegraphCommand(
      io,
      'codegraph.context',
      { subcommand: 'context', project: options.project, task },
      options.peaksJson
    );
  });
}

export function registerCodegraphAffectedCommand(codegraph: Command, io: ProgramIO): void {
  addProjectOption(
    codegraph
      .command('affected')
      .description('Find code affected by files')
      .argument('<files...>', 'project-relative file paths')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option(
        '--rid <rid>',
        'request id for the codegraph-context envelope (default: env PEAKS_RD_RID or "unknown-rid")'
      )
      .option('--write-envelope', 'write codegraph-context.md into the active session')
  ).action((files: string[], options: CodegraphAffectedOptions) =>
    runCodegraphAffectedCommand(io, files, options, options.peaksJson)
  );
}

/**
 * The proxy verbs in registration order. `index` / `query` and `files` /
 * `context` are paired because each pair shares a module-level helper set.
 */
export function registerCodegraphProxyCommands(codegraph: Command, io: ProgramIO): void {
  registerCodegraphIndexCommands(codegraph, io);
  registerCodegraphFileCommands(codegraph, io);
  registerCodegraphAffectedCommand(codegraph, io);
}
