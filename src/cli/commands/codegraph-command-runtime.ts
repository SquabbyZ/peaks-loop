// src/cli/commands/codegraph-command-runtime.ts
//
// Shared invocation runtime for every `peaks codegraph <verb>`: the option
// shape they all extend, the failure envelope they all print, the two text
// localizations upstream output needs before it reaches the reader (bare
// `codegraph …` hints, and the SQLite-backend advice for a dependency this
// project removed), and the upstream proxy itself.
//
// Extracted verbatim from `codegraph-commands.ts` (rid
// line is byte-identical and no behaviour changed; `codegraph-commands.ts`
// re-exports the hint rewriter so its public surface is stable.
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
 * The control character that opens an SGR sequence, as a string constant:
 * `no-control-regex` refuses one inside a PATTERN literal, and an SGR sequence
 * begins with it by construction — so escape runs are found by scanning.
 */
const ESC = '\x1b';

function sgrRunLength(text: string, from: number): number {
  if (text[from] !== ESC || text[from + 1] !== '[') {
    return 0;
  }
  let index = from + 2;
  while (index < text.length && /[0-9;]/.test(text[index] ?? '')) {
    index += 1;
  }
  return (text[index] ?? '') === 'm' ? index + 1 - from : 0;
}

/** The text a terminal would actually show for this line. */
function withoutSgr(text: string): string {
  let out = '';
  for (let index = 0; index < text.length; index += 1) {
    const run = sgrRunLength(text, index);
    if (run > 0) {
      index += run - 1;
      continue;
    }
    out += text[index];
  }
  return out;
}

/** The 72-box-drawing rule upstream frames its blocks with. */
const RULE_LINE_PATTERN = /^─{20,}$/;
/** Opens the runtime SQLite-backend block. */
const BLOCK_INTRO_PATTERN = /^\[CodeGraph\]\s+WASM SQLite fallback active\b/i;
/** `Backend:   wasm …`, judged on the visible line. */
const BACKEND_WASM_PATTERN = /^(\s*Backend:\s*)wasm\b/i;

/**
 * The rewritten status line. The yellow upstream wrapped it in goes away with
 * the warning it was coloring: the fallback is not a warning here.
 */
function rewriteWasmStatusLine(visible: string): string | undefined {
  const match = BACKEND_WASM_PATTERN.exec(visible);
  return match === null ? undefined : `${match[1]}${WASM_STATUS_TEXT}`;
}

const WASM_STATUS_TEXT =
  'wasm (slower fallback — by design: peaks-loop ships no native SQLite addon)';

/**
 * The one line the runtime block collapses to. The advice it replaces told
 * the reader to install a C toolchain and rebuild `better-sqlite3`, which
 * this project removed deliberately: the stores run on Node's built-in
 * `node:sqlite`, so upstream falling back to wasm is a chosen, permanent
 * state rather than a degradation the reader can fix.
 */
const WASM_BACKEND_NOTE =
  'note: codegraph is on its wasm SQLite backend (5-10x slower than native). ' +
  "This is intentional: peaks-loop ships no native addon and uses Node's built-in node:sqlite. " +
  'No action needed.';

/** One line of the block, judged on the text the terminal shows. */
function isBackendAdvice(raw: string): boolean {
  const text = withoutSgr(raw).trim();
  if (text.length === 0) {
    return true;
  }
  if (text.includes('better-sqlite3')) {
    return true;
  }
  // The native loader's search paths, and the wrapped command lines.
  if (text.startsWith('→') || text.startsWith('npm ') || text.startsWith('sudo ')) {
    return true;
  }
  return /xcode-select|build-essential|apt install|yum groupinstall|^Indexing and sync will be |^Fix on (?:macOS|Linux):|^Or force-include as a hard dependency|^Verify after fix:|^Native load error:/i.test(
    text
  );
}

function isRuleLine(raw: string | undefined): boolean {
  return raw !== undefined && RULE_LINE_PATTERN.test(withoutSgr(raw).trim());
}

/** The index of the last line the block owns, starting after its intro. A
 * rule belongs to the block only when block content follows it; otherwise it
 * frames something else and stays exactly where it was. */
function blockBodyEnd(lines: string[], introIndex: number): number {
  let index = introIndex + 1;
  while (index < lines.length) {
    const raw = lines[index] ?? '';
    if (isBackendAdvice(raw) || (isRuleLine(raw) && isBackendAdvice(lines[index + 1] ?? ''))) {
      index += 1;
      continue;
    }
    break;
  }
  return index - 1;
}

/**
 * Localizes upstream's SQLite-backend advice: rewrites the `Backend:  wasm`
 * status line and collapses the `WASM SQLite fallback active` block to
 * `WASM_BACKEND_NOTE`. The match is anchored — a run of block lines ends at
 * the first line that is not a block shape. Output with no wasm advice
 * (notably a `Backend:   native` index) passes through byte-for-byte, and the
 * transform is idempotent.
 */
export function rewriteSqliteBackendAdvice(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const visible = withoutSgr(line);
    const statusLine = rewriteWasmStatusLine(visible);
    if (statusLine !== undefined) {
      out.push(statusLine);
      continue;
    }

    if (!BLOCK_INTRO_PATTERN.test(visible)) {
      out.push(line);
      continue;
    }

    // The framing rule the block opens with was already emitted: take it back.
    if (isRuleLine(out[out.length - 1])) {
      out.pop();
    }
    out.push(WASM_BACKEND_NOTE);
    index = blockBodyEnd(lines, index);
  }

  return out.join('\n');
}

/**
 * Both localizations upstream output needs before it reaches the reader, in
 * the order the shipped pipeline applies them.
 */
export function localizeUpstreamCodegraphText(text: string): string {
  return rewriteSqliteBackendAdvice(rewriteBareCodegraphHints(text));
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
    const rewritten = localizeUpstreamCodegraphText(result.stdout);
    const stdout = attributeStdout === undefined ? rewritten : attributeStdout(rewritten);
    const stderr = localizeUpstreamCodegraphText(result.stderr);

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
