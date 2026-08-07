// tests/unit/cli/_statusline-rpc-helper.mjs
//
// Slice 2026-08-07-statusline-perf: long-running IPC server used by
// `statusline-cli-integration.test.ts` to amortize Node startup cost
// across 24 real CLI invocations. The test suite spawns this helper
// ONCE in `beforeAll` via `child_process.fork()`, then sends one JSON
// command per line on stdin and reads one JSON result per line from
// stdout for the lifetime of the suite.
//
// This helper is TEST INFRASTRUCTURE. It is not part of the production
// CLI binary. It deliberately loads `dist/cli/program.js` (the same
// compiled entrypoint the real CLI uses) so the in-process path is
// structurally identical to `node dist/cli/index.js <args>` — the only
// difference is that the Node process stays alive across commands instead
// of exiting.
//
// Protocol (one JSON object per line):
//   request:  { id, args, stdinPayload, env, timeoutMs }
//   response: { id, status, stdout, stderr }
//
// State management:
//   - `process.cwd()` restored after each call.
//   - `process.env` diffed and restored after each call.
//   - `process.exitCode` reset between calls.
//   - Stdin payload: a FRESH `Readable` stream is installed as
//     `process.stdin` for the duration of each call so each call
//     gets its own clean end-of-stream. The original `process.stdin`
//     is restored in `finally`. (The original `process.stdin` is
//     kept alive but ignored while a call is running; commands that
//     call `readStdin()` see only the per-call payload stream.)

import { Readable } from 'node:stream';
import { createProgram } from '../../../dist/cli/program.js';

const program = createProgram();

function captureIo() {
  const stdoutChunks = [];
  const stderrChunks = [];
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line no-restricted-syntax
  process.stdout.write = (chunk) => {
    stdoutChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  // eslint-disable-next-line no-restricted-syntax
  process.stderr.write = (chunk) => {
    stderrChunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
    return true;
  };
  return {
    stdout: () => stdoutChunks.join(''),
    stderr: () => stderrChunks.join(''),
    restore() {
      process.stdout.write = origStdoutWrite;
      process.stderr.write = origStderrWrite;
    },
  };
}

async function runOne(req) {
  const { args, stdinPayload, env, timeoutMs } = req;
  const io = captureIo();
  let status = 0;
  let timeoutHandle = null;
  const prevCwd = process.cwd();
  const prevEnvSnapshot = { ...process.env };
  // Build a fresh readable stream carrying ONLY this call's payload.
  // We will swap it in as `process.stdin` for the duration of the call
  // so `readStdin()` sees a clean end-of-stream and doesn't fight the
  // helper's persistent JSON-parser listener on the real stdin.
  const callStdin = new Readable({ read() {} });
  callStdin.isTTY = false;
  const realStdinDescriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  Object.defineProperty(process, 'stdin', { value: callStdin, configurable: true, writable: true });
  if (env !== undefined) {
    for (const [k, v] of Object.entries(env)) {
      process.env[k] = v;
    }
  }
  if (stdinPayload !== undefined && stdinPayload.length > 0) {
    callStdin.push(stdinPayload);
  }
  callStdin.push(null);
  try {
    const parsePromise = program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(
        () => reject(new Error(`__IPC_TIMEOUT__ after ${timeoutMs ?? 10000}ms`)),
        timeoutMs ?? 10000,
      );
    });
    try {
      await Promise.race([parsePromise, timeoutPromise]);
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? err.code : null;
      const isCommanderHelp =
        code === 'commander.helpDisplayed' || code === 'commander.help' || code === 'commander.version';
      if (isCommanderHelp) {
        status = 0;
      } else if (err && typeof err === 'object' && 'code' in err &&
                 (err.code === 'commander.unknownCommand' || err.code === 'commander.missingArgument' ||
                  err.code === 'commander.unknownOption')) {
        status = 1;
      } else if (err instanceof Error && err.message.startsWith('__IPC_TIMEOUT__')) {
        status = null;
        process.stderr.write(`__IPC_TIMEOUT__ ${timeoutMs ?? 10000}ms\n`);
      } else {
        status = 1;
        process.stderr.write(`__IPC_ERROR__ ${err && err.message ? err.message : String(err)}\n`);
      }
    }
    status = process.exitCode ?? status;
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    process.chdir(prevCwd);
    for (const k of Object.keys(env ?? {})) {
      if (k in prevEnvSnapshot) {
        process.env[k] = prevEnvSnapshot[k];
      } else {
        delete process.env[k];
      }
    }
    // Restore real stdin.
    if (realStdinDescriptor) {
      Object.defineProperty(process, 'stdin', realStdinDescriptor);
    } else {
      delete process.stdin;
    }
    process.exitCode = undefined;
    io.restore();
    // Reset commander option state so the NEXT call starts fresh.
    // Commander12.x persists `_optionValues` and `_optionValueSources`
    // across `parseAsync()` calls on the same program instance, which
    // means `--json` set by a previous call leaks into the next. This
    // is a known commander quirk. The fix is a structural reset of the
    // two private fields on EVERY command in the tree (root + every
    // subcommand + sub-subcommand), because the CLI registers `--json`
    // on the `statusline` parent via `addJsonOption()` and the
    // compact subcommand inherits the resolved value via
    // `command.optsWithGlobals()`. We do NOT touch `_args` or registered
    // subcommands — those are immutable across calls.
    function resetCmd(cmd) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cmd._optionValues = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cmd._optionValueSources = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cmd.args = [];
      for (const sub of cmd.commands) resetCmd(sub);
    }
    resetCmd(program);
  }
  return {
    status,
    stdout: io.stdout(),
    stderr: io.stderr(),
  };
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    if (line.trim().length === 0) continue;
    let req;
    try {
      req = JSON.parse(line);
    } catch (err) {
      process.stdout.write(JSON.stringify({ id: null, status: 1, stdout: '', stderr: `__IPC_BAD_REQUEST__ ${err.message}\n` }) + '\n');
      continue;
    }
    runOne(req).then((resp) => {
      process.stdout.write(JSON.stringify({ id: req.id ?? null, ...resp }) + '\n');
    }).catch((err) => {
      process.stdout.write(JSON.stringify({ id: req.id ?? null, status: 1, stdout: '', stderr: `__IPC_RUNONE_ERR__ ${err.message}\n` }) + '\n');
    });
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});