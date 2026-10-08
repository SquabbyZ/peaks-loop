// src/services/mcp/server-main.ts
//
// The process entry: a stdin pipe, a stdout pipe, and spec §6's L4 check before
// either is used.
//
// STDOUT CARRIES PROTOCOL AND NOTHING ELSE. Any diagnostic goes to stderr,
// because a harness reads stdout as the message stream and one stray line is a
// parse error that is indistinguishable from a broken server. That is also why
// the startup refusal below writes to stderr and exits non-zero rather than
// printing a JSON error: at that point there is no session to answer in.
//
// L4 REFUSES TO START. If the surface cannot be served as proven — a tool with
// no description, an argv the whitelist does not carry, a whitelisted argv
// reachable from no tool, or a tool with no handler — this process exits 1.
// A server that started anyway would be serving something nobody proved, and the
// failure would surface as data rather than as a refusal (spec §6, L4).

import { loadReadOnlyWhitelist } from '../readonly-surface/readonly-whitelist.js';
import { LineDecoder } from './json-rpc.js';
import { buildToolDefinitions, validateSurface } from './surface.js';
import { createMcpServer } from './server.js';
import { missingHandlers } from './tools.js';

function refuse(reason: string): never {
  process.stderr.write(`peaks mcp: ${reason}\n`);
  process.exit(1);
}

function start(): void {
  let tools;
  try {
    const whitelist = loadReadOnlyWhitelist();
    tools = buildToolDefinitions(whitelist);
    validateSurface(whitelist, tools);
  } catch (error) {
    refuse(`refusing to start: ${error instanceof Error ? error.message : String(error)}`);
  }
  const unserved = missingHandlers(tools);
  if (unserved.length > 0) {
    refuse(`refusing to start: no handler for tool(s) ${unserved.join(', ')}`);
  }

  const server = createMcpServer({ tools });
  const decoder = new LineDecoder();

  const write = (line: string | undefined): void => {
    if (line !== undefined) process.stdout.write(line);
  };
  const consume = (line: string): void => {
    void server.handleLine(line).then(write);
  };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk: string) => {
    for (const line of decoder.push(chunk)) consume(line);
  });
  process.stdin.on('end', () => {
    for (const line of decoder.flush()) consume(line);
  });
  // A read error on our own transport is not recoverable and not ours to
  // interpret: report it and stop, so the harness sees a dead server instead of
  // a live one that answers nothing.
  process.stdin.on('error', (error: Error) => {
    process.stderr.write(`peaks mcp: stdin error: ${error.message}\n`);
    process.exitCode = 1;
  });
}

start();
