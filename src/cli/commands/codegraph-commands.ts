import { Command, InvalidArgumentError } from 'commander';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  defaultCodegraphInitGuard,
  writeCodegraphMarker,
  writeCodegraphAffectedContext,
  CodegraphInitConflictError,
  type CodegraphInvocationOptions
} from '../../services/codegraph/codegraph-service.js';
import {
  CODEGRAPH_INTEGRITY_EXIT_CODE,
  inspectCodegraphExcludeIntegrity,
  isCodegraphExcludeConfigPresent,
  renderCodegraphExcludeIntegrityLines,
  type CodegraphExcludeIntegrityReport
} from '../../services/codegraph/codegraph-exclude-integrity.js';
import { repairCodegraphExcludeFromProject } from '../../services/codegraph/codegraph-exclude-repair.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { getErrorMessage, printResult, redactSensitiveErrorMessage, type ProgramIO } from '../cli-helpers.js';

interface CommonCodegraphOptions {
  project: string;
  peaksJson?: boolean;
}

interface CodegraphIndexOptions extends CommonCodegraphOptions {
  force?: boolean;
  quiet?: boolean;
}

interface CodegraphQueryOptions extends CommonCodegraphOptions {
  json?: boolean;
  limit?: number;
}

interface CodegraphFilesOptions extends CommonCodegraphOptions {
  json?: boolean;
  maxDepth?: number;
}

interface CodegraphAffectedOptions extends CommonCodegraphOptions {
  json?: boolean;
  rid?: string;
  writeEnvelope?: boolean;
}

function addPeaksJsonOption(command: Command): Command {
  return command.option('--peaks-json', 'print Peaks error envelope as machine-readable JSON');
}

function addProjectOption(command: Command): Command {
  return addPeaksJsonOption(command.requiredOption('--project <path>', 'target project root'));
}

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }

  return parsed;
}

function printCodegraphFailure(io: ProgramIO, command: string, error: unknown, asJson?: boolean, exitCode = 1): void {
  printResult(
    io,
    fail(command, 'CODEGRAPH_COMMAND_FAILED', redactSensitiveErrorMessage(getErrorMessage(error)), {}, ['Check the codegraph command options and project path before retrying']),
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

const ANSI_SGR_PATTERN = /\x1b\[[0-9;]*m/g;

/**
 * Upstream `status` answers a different question than peaks-loop's
 * integrity gate: upstream says "the on-disk graph matches the last scan"
 * (true), peaks says "that graph covers the repository" (false when rules
 * exclude tracked files). Both verdicts are correct, but an unqualified
 * `[OK] Index is up to date` printed above our `[FAIL] ...` reads as
 * "nothing to see here" — and the OK is the line the eye lands on first.
 * The exit code and the JSON envelope are already right; only this line
 * lies by juxtaposition.
 *
 * So: keep upstream's wording — the line stays recognizable, and the
 * Files/Nodes counts around it are untouched — but drop the bare OK
 * marker and name the only question it answers. Clean runs never reach
 * this, so their output stays byte-identical.
 *
 * The match is anchored to THAT line. An earlier version keyed on
 * `includes('up to date')`, which is content-blind: upstream prints other
 * `[OK] ... are up to date` lines (a language-server or watcher line is the
 * observed one), and each of those was rewritten into a claim about the
 * INDEX — a misattribution introduced by a change whose entire purpose was
 * to stop misleading output. Anything that is not the index line is passed
 * through byte-for-byte, tail note and all.
 */
const INDEX_UP_TO_DATE_RE = /^\[OK\]\s+Index is up to date\b/i;

export function attributeUpstreamUpToDateLine(stdout: string): string {
  return stdout
    .split('\n')
    .map((line) => {
      const visible = line.replace(ANSI_SGR_PATTERN, '').trim();
      if (!INDEX_UP_TO_DATE_RE.test(visible)) {
        return line;
      }

      // Only the OK marker is downgraded and the attribution appended: the
      // rest of the line — including whatever upstream wrote after it — is
      // preserved, so nothing upstream actually said is replaced.
      const withoutOk = visible.replace(/^\[OK\]\s*/, '');
      return `[i] ${withoutOk} (upstream: matches the last scan only; repository coverage is answered below)`;
    })
    .join('\n');
}

async function runCodegraphCommand(
  io: ProgramIO,
  command: string,
  options: CodegraphInvocationOptions,
  asJson?: boolean,
  attributeStdout?: (text: string) => string
): Promise<void> {
  try {
    const invocation = createCodegraphInvocation(options);
    const result = await executeCodegraphInvocation(invocation);

    if (result.exitCode !== null && result.exitCode !== 0 && asJson === true) {
      printCodegraphFailure(io, command, new Error(result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`), true, result.exitCode);
      return;
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
  } catch (error) {
    printCodegraphFailure(io, command, error, asJson);
  }
}

/**
 * `--peaks-json` machine report for `status`. Carries the upstream
 * result AND the peaks-loop integrity verdict as one JSON document so a
 * CI job can gate on `data.integrity.gap` / `data.integrity.rulesToRemove`
 * without scraping human text.
 */
async function runCodegraphStatusJson(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  integrity: CodegraphExcludeIntegrityReport | null,
  integrityWarning: string | null
): Promise<void> {
  let result;
  try {
    result = await executeCodegraphInvocation(
      createCodegraphInvocation({ subcommand: 'status', project: options.project })
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.status', error, true);
    return;
  }

  const upstream = {
    exitCode: result.exitCode,
    stdout: rewriteBareCodegraphHints(result.stdout).trimEnd(),
    stderr: redactSensitiveErrorMessage(rewriteBareCodegraphHints(result.stderr)).trimEnd()
  };
  const upstreamFailed = result.exitCode !== null && result.exitCode !== 0;

  if (integrity?.gap === true) {
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_INDEX_INCOMPLETE',
        `codegraph index is incomplete: ${integrity.excludedTrackedCount} of ${integrity.trackedSourceCount} tracked source files are excluded by ${integrity.rulesToRemove.length} rule(s).`,
        { upstream, integrity, integrityWarning },
        ['Run `peaks codegraph repair-exclude --project <root>` to drop the offending rules and rebuild the index.']
      ),
      true
    );
  } else if (upstreamFailed) {
    printResult(
      io,
      fail(
        'codegraph.status',
        'CODEGRAPH_COMMAND_FAILED',
        redactSensitiveErrorMessage(upstream.stderr || upstream.stdout || `codegraph exited with code ${String(result.exitCode)}`),
        { upstream, integrity, integrityWarning },
        ['Check the codegraph project path before retrying']
      ),
      true
    );
  } else {
    printResult(io, ok('codegraph.status', { upstream, integrity, integrityWarning }), true);
  }

  if (upstreamFailed) {
    process.exitCode = result.exitCode ?? 1;
  }
}

/**
 * `peaks codegraph status` with an integrity gate.
 *
 * The upstream status is still proxied verbatim (that is what the
 * command has always done), but a clean upstream "index is up to date"
 * is no longer sufficient: when git-tracked source files are being
 * excluded by the config, the command says so, names the rules and
 * files, and exits non-zero.
 *
 * Read-only by construction — it imports the integrity inspector, never
 * the repair writer. Fixing the config is `peaks codegraph init`
 * (fresh) or `peaks codegraph repair-exclude` (explicit).
 */
async function runCodegraphStatusCommand(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  asJson?: boolean
): Promise<void> {
  let integrity: CodegraphExcludeIntegrityReport | null = null;
  let integrityWarning: string | null = null;
  const projectRoot = resolve(options.project);
  try {
    // Never initialized here → no exclude list is in play, so there is
    // nothing to report. Staying silent keeps `status` honest and
    // unchanged for projects that do not use codegraph at all.
    integrity = isCodegraphExcludeConfigPresent(projectRoot)
      ? inspectCodegraphExcludeIntegrity(projectRoot)
      : null;
  } catch (error) {
    // Not a git work tree, no config yet, malformed config — the
    // upstream status is still worth printing, so degrade to a warning
    // instead of failing the whole command.
    integrityWarning = getErrorMessage(error);
  }

  if (asJson === true) {
    await runCodegraphStatusJson(io, options, integrity, integrityWarning);
  } else {
    // Only when the gate found a gap: upstream's `[OK] Index is up to
    // date` answers "consistent with the last scan", and printing it
    // unqualified right above our `[FAIL]` tells the reader two opposite
    // things at once. Clean runs get no transform and stay byte-identical.
    await runCodegraphCommand(
      io,
      'codegraph.status',
      { subcommand: 'status', project: options.project },
      false,
      integrity?.gap === true ? attributeUpstreamUpToDateLine : undefined
    );
    if (integrityWarning !== null) {
      io.stdout(`[WARN] codegraph exclude integrity not evaluated: ${integrityWarning}`);
    } else if (integrity !== null) {
      for (const line of renderCodegraphExcludeIntegrityLines(integrity)) {
        io.stdout(line);
      }
    }
  }

  if (integrity?.gap === true) {
    process.exitCode = CODEGRAPH_INTEGRITY_EXIT_CODE;
  }
}

/**
 * Explicit repair path: reconcile → drop offending rules → back up the
 * config → rebuild the index. Mirrors the automatic step `init` runs
 * after a fresh upstream init, for workspaces that were already
 * initialized before the integrity gate existed.
 */
async function runCodegraphRepairExcludeCommand(
  io: ProgramIO,
  options: CommonCodegraphOptions,
  asJson?: boolean
): Promise<void> {
  let projectRoot: string;
  try {
    const candidate = resolve(options.project);
    if (!statSync(candidate).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }
    projectRoot = candidate;
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.repair-exclude', error, asJson);
    return;
  }

  const report = await repairCodegraphExcludeFromProject(projectRoot);

  // Where the notes go matters: `printResult` renders every `warnings`
  // entry to stderr with a `warning: ` prefix, so a confirmation parked
  // in the third slot reads as a problem — and a real warning parked
  // there double-prefixes. Confirmations go to `nextActions`; only a
  // genuine `report.warning` reaches `warnings`, verbatim.
  const confirmations: string[] = [];
  if (report.applied) {
    confirmations.push(
      `Removed ${report.rulesRemoved.length} exclude rule(s), recovering ${report.filesRecovered} tracked source file(s). Config backed up to ${report.backupPath}.`
    );
  } else {
    confirmations.push('No tracked source file is excluded by the codegraph config; nothing to repair.');
  }
  if (report.applied) {
    confirmations.push('Re-run `peaks codegraph status --project <root>` to confirm the gap is closed.');
  }

  printResult(
    io,
    ok(
      'codegraph.repair-exclude',
      {
        applied: report.applied,
        rulesRemoved: report.rulesRemoved,
        filesRecovered: report.filesRecovered,
        trackedSourceCount: report.trackedSourceCount,
        configPath: report.configPath,
        backupPath: report.backupPath,
        reindexed: report.reindexed,
        warning: report.warning
      },
      report.warning === null ? [] : [report.warning],
      confirmations
    ),
    asJson
  );

  // A repair that could not run to completion (or could not reindex)
  // must not report success to a shell.
  if (report.warning !== null) {
    process.exitCode = 1;
  }
}

/**
 * rid-CG-006 — init conflict guard. Resolves the project root and
 * probes `.codegraph/` for the peaks-loop marker before invoking the
 * upstream binary.
 *
 *   - fresh                          → proceed to upstream init
 *   - noop-already-peaks-loop        → skip upstream, emit warning
 *   - conflict-foreign-schema        → exit 73 + CODEGRAPH_INIT_CONFLICT envelope
 *
 * On a successful upstream init, write the marker so the next run
 * hits the noop branch instead of the conflict branch.
 */
async function runCodegraphInitCommand(io: ProgramIO, options: CommonCodegraphOptions, asJson?: boolean): Promise<void> {
  let projectRoot: string;
  try {
    const candidate = resolve(options.project);
    if (!statSync(candidate).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }
    projectRoot = candidate;
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
    return;
  }

  const guardOutcome = defaultCodegraphInitGuard(projectRoot);

  if (guardOutcome.status === 'noop-already-peaks-loop') {
    printResult(
      io,
      ok(
        'codegraph.init',
        {
          guard: guardOutcome.status,
          codegraphDir: guardOutcome.codegraphDir,
          markerPresent: true
        },
        // A no-op init is a SUCCESS. This message used to sit in the
        // `warnings` slot and was therefore printed as
        // `warning: .codegraph/ is already managed by peaks-loop...`.
        [],
        [
          `.codegraph/ is already managed by peaks-loop; init is a no-op. Marker: ${guardOutcome.codegraphDir}/.peaks-loop-marker`,
          'Run `peaks codegraph index` to (re)build the index without touching the schema.'
        ]
      ),
      asJson
    );
    return;
  }

  if (guardOutcome.status === 'conflict-foreign-schema') {
    const conflict = new CodegraphInitConflictError(
      `Refusing to init: ${guardOutcome.codegraphDir} already exists with a non-peaks-loop schema. ` +
        'Move or rename the foreign directory, then re-run `peaks codegraph init`.',
      guardOutcome.codegraphDir
    );
    printResult(
      io,
      fail('codegraph.init', conflict.code, conflict.message, { codegraphDir: conflict.codegraphDir }, [
        'Move or rename the foreign .codegraph/ directory before retrying.',
        'Or remove .codegraph/ if you are sure no other tool owns it.',
        'Or run `peaks codegraph init --project <path> --force` once the foreign-tool safety flag ships (tracked in rid-CG-006).'
      ]),
      asJson
    );
    process.exitCode = conflict.exitCode;
    return;
  }

  // guardOutcome.status === 'fresh' — proceed.
  try {
    const invocation = createCodegraphInvocation({
      subcommand: 'init',
      project: options.project
    });
    const result = await executeCodegraphInvocation(invocation);
    const didFail = result.exitCode !== null && result.exitCode !== 0;

    if (result.stdout.length > 0) {
      io.stdout((didFail ? redactSensitiveErrorMessage(result.stdout) : result.stdout).trimEnd());
    }
    if (result.stderr.length > 0) {
      io.stderr((didFail ? redactSensitiveErrorMessage(result.stderr) : result.stderr).trimEnd());
    }

    if (didFail) {
      if (asJson === true) {
        printCodegraphFailure(
          io,
          'codegraph.init',
          new Error(result.stderr || result.stdout || `codegraph exited with code ${result.exitCode}`),
          true,
          result.exitCode ?? 1
        );
      }
      process.exitCode = result.exitCode ?? 1;
      return;
    }

    // Upstream succeeded — stamp the marker so the next run hits the
    // noop branch. Best-effort: a marker-write failure must NOT undo
    // the upstream init (peaks-loop still owns the schema logically).
    try {
      writeCodegraphMarker(guardOutcome.codegraphDir);
    } catch {
      // intentionally swallowed — surface as warning below
    }

    // Upstream `init` writes its 99-rule default `exclude` template,
    // some of which collide with real source directories in this
    // project. Left alone, a fresh clone / new machine gets an index
    // that silently omits tracked source files while `status` says it
    // is up to date. Reconcile now, drop the offending rules, and
    // rebuild the index — a fresh init is the one moment this is both
    // safe (nothing has been indexed yet) and necessary (`.codegraph/`
    // is gitignored, so every clone starts from the default template).
    //
    // Never throws: a failure here is reported as a warning, not a
    // failed init (the init itself already succeeded).
    const excludeRepair = await repairCodegraphExcludeFromProject(projectRoot);

    // These are confirmations, not warnings: `printResult` renders every
    // `warnings` entry to stderr behind a `warning: ` prefix, so a fully
    // successful init used to print a wall of `warning:` lines for what
    // were plain success messages.
    const initNotes: string[] = [
      `Stamped peaks-loop marker at ${guardOutcome.codegraphDir}/.peaks-loop-marker`
    ];
    if (excludeRepair.applied) {
      initNotes.push(
        `Removed ${excludeRepair.rulesRemoved.length} exclude rule(s) that blocked tracked source files, recovering ${excludeRepair.filesRecovered} file(s); config backed up to ${excludeRepair.backupPath}.`
      );
      if (excludeRepair.reindexed) {
        initNotes.push('Rebuilt the codegraph index over the recovered files.');
      }
    }

    printResult(
      io,
      ok(
        'codegraph.init',
        {
          guard: guardOutcome.status,
          codegraphDir: guardOutcome.codegraphDir,
          markerWritten: true,
          excludeRepair: {
            applied: excludeRepair.applied,
            rulesRemoved: excludeRepair.rulesRemoved,
            filesRecovered: excludeRepair.filesRecovered,
            reindexed: excludeRepair.reindexed,
            backupPath: excludeRepair.backupPath,
            warning: excludeRepair.warning
          }
        },
        // Verbatim: `printResult` supplies the `warning: ` prefix, so a
        // prefix added here would render as `warning: warning: ...`.
        excludeRepair.warning === null ? [] : [excludeRepair.warning],
        initNotes
      ),
      asJson
    );
  } catch (error) {
    printCodegraphFailure(io, 'codegraph.init', error, asJson);
  }
}

/**
 * rid-CG-002 — codegraph-affected envelope write.
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
  const rid = options.rid ?? process.env.PEAKS_RD_RID ?? 'unknown-rid';
  const rawStdout = capturedLines.join('\n');
  let affectedPayload: unknown = rawStdout;
  if (options.json === true && typeof affectedPayload === 'string' && affectedPayload.length > 0) {
    try {
      affectedPayload = JSON.parse(affectedPayload);
    } catch {
      // Keep the raw string when JSON parse fails; the envelope
      // renderer handles strings cleanly.
    }
  }

  const envelope = writeCodegraphAffectedContext({
    projectRoot: resolve(options.project),
    rid,
    files,
    affectedPayload
  });

  if (envelope.written) {
    if (asJson !== true) {
      io.stdout(`[codegraph-context] wrote ${envelope.path}\n`);
    }
  } else if (asJson !== true) {
    io.stdout(`[codegraph-context] skipped: ${envelope.warning}\n`);
  }
}

export function registerCodegraphCommands(program: Command, io: ProgramIO): void {
  const codegraph = program.command('codegraph').description('Run upstream codegraph commands through the Peaks launcher');

  addProjectOption(
    codegraph.command('status').description('Show codegraph status, including the exclude integrity gate')
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphStatusCommand(io, options, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('repair-exclude')
      .description('Drop codegraph exclude rules that block tracked source files, then rebuild the index')
  ).action((options: CommonCodegraphOptions) =>
    runCodegraphRepairExcludeCommand(io, options, options.peaksJson)
  );

  addProjectOption(codegraph.command('init').description('Initialize codegraph for a project')).action(
    (options: CommonCodegraphOptions) => runCodegraphInitCommand(io, options, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('index')
      .description('Index a project with codegraph')
      .option('--force', 'force reindexing')
      .option('--quiet', 'reduce upstream output')
  ).action((options: CodegraphIndexOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.index',
      {
        subcommand: 'index',
        project: options.project,
        ...(options.force === true ? { force: true } : {}),
        ...(options.quiet === true ? { quiet: true } : {})
      },
      options.peaksJson
    )
  );

  addProjectOption(
    codegraph
      .command('query')
      .description('Query codegraph')
      .argument('<search>', 'search text')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--limit <n>', 'maximum result count', parsePositiveInteger)
  ).action((search: string, options: CodegraphQueryOptions) =>
    runCodegraphCommand(
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
    )
  );

  addProjectOption(
    codegraph
      .command('files')
      .description('List codegraph files')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--max-depth <n>', 'maximum traversal depth', parsePositiveInteger)
  ).action((options: CodegraphFilesOptions) =>
    runCodegraphCommand(
      io,
      'codegraph.files',
      {
        subcommand: 'files',
        project: options.project,
        ...(options.json === true ? { json: true } : {}),
        ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {})
      },
      options.peaksJson
    )
  );

  addProjectOption(codegraph.command('context').description('Build task context with codegraph').argument('<task>', 'task text')).action(
    (task: string, options: CommonCodegraphOptions) =>
      runCodegraphCommand(io, 'codegraph.context', { subcommand: 'context', project: options.project, task }, options.peaksJson)
  );

  addProjectOption(
    codegraph
      .command('affected')
      .description('Find code affected by files')
      .argument('<files...>', 'project-relative file paths')
      .option('--json', 'forward JSON output flag to upstream codegraph')
      .option('--rid <rid>', 'request id for the codegraph-context envelope (default: env PEAKS_RD_RID or "unknown-rid")')
      .option('--write-envelope', 'write codegraph-context.md into the active session')
  ).action((files: string[], options: CodegraphAffectedOptions) =>
    runCodegraphAffectedCommand(
      io,
      files,
      options,
      options.peaksJson
    )
  );
}
