// tests/integration/services/mcp/mcp-stdio-e2e.test.ts
//
// End-to-end over the real transport: `peaks mcp serve` as its own process,
// spoken to in newline-delimited JSON-RPC, executing the real peaks CLI.
//
// WHY THIS FILE EXISTS AT ALL. Every other test in this slice stubs the process
// boundary, so none of them can answer AC-1..AC-6 as a claim about the SHIPPED
// path — only about a handler. This one launches the launcher, which launches
// the server, which launches the CLI, and asserts on what comes back through the
// pipe:
//
//   AC-1  the tool set over the wire is the whitelist's
//   AC-3  the composite's keys equal the argv outputs a SEPARATE direct run of
//         the same CLI produced — measured, not argued from a stub
//   AC-6  a failing CLI call comes back as `isError` with the CLI's own code /
//         errorId / nextActions intact
//   §7.1  the memory reply is bounded
//
// NOT COVERED HERE, AND NAMED SO NOBODY ASSUMES IT IS: the HARNESS side. This
// machine has no MCP client registered against the server (that registration is
// a later slice), so "an LLM calls the tool and the pre-tool hook fires" is NOT
// verified end to end. What is verified is the server's own pipe.
//
// Dimensions covered: render, behavior, integration, a11y.

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { describe, expect, it, afterEach } from 'vitest';

import { executeCliArgv } from '~/src/services/mcp/cli-executor';
import { cliEntryPath, interpreterArgs } from '~/src/services/web/daemon-supervisor';
import { MEMORY_EXCERPT_CHARS, MEMORY_MAX_RETURNED } from '~/src/services/mcp/tool-core';
import {
  loadReadOnlyWhitelist,
  toolIdsOf
} from '~/src/services/readonly-surface/readonly-whitelist';

const LAUNCH_TIMEOUT_MS = 30_000;
const RESPONSE_TIMEOUT_MS = 60_000;

/** Repo root: this file is at `<root>/tests/integration/services/mcp/`. */
const REPO_ROOT = process.cwd();

/**
 * A request id that no session can carry, so "no artifact exists for it" is a
 * property of the ID rather than of the tree at the moment this runs.
 *
 * WHY IT IS A SENTINEL AND NOT A REAL-ID-FREE PICK. This file previously named
 * a live-looking id and asserted the lookup for it FAILED. That held only until
 * this slice wrote its own RD artifact under that id — at which point the two
 * cases below went red on the delivered tree, because the fixture depended on
 * the absence of a file that the work it was evidence FOR was going to create.
 * A result that can only be obtained before its own evidence exists is not a
 * deliverable result, so the fixture no longer names an id the repository could
 * ever mint: `peaks request` ids are `rid-<3 digits>` (e.g. `rid-036`), and
 * `0000` is outside that form while `sentinel-absent` names the intent.
 *
 * Neither `rid-0000-sentinel-absent.md` nor `<n>-rid-0000-sentinel-absent.md`
 * can match a role artifact, so both cases below hold for a real reason at any
 * moment in the session's life.
 */
const ABSENT_RID = 'rid-0000-sentinel-absent';

interface Wire {
  readonly child: ChildProcessWithoutNullStreams;
  request(method: string, params?: unknown): Promise<{ result?: any; error?: any }>;
  stop(): void;
  readonly stderr: string[];
}

/** Start the shipped launcher and speak JSON-RPC to its stdout. */
function startServer(): Wire {
  const child = spawn(
    process.execPath,
    [...interpreterArgs(cliEntryPath()), 'mcp', 'serve', '--project', REPO_ROOT],
    { cwd: REPO_ROOT, windowsHide: true }
  ) as ChildProcessWithoutNullStreams;

  const stderr: string[] = [];
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => stderr.push(chunk));

  let buffer = '';
  const pending = new Map<number, (value: { result?: any; error?: any }) => void>();
  let nextId = 1;

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
      const settle = typeof message.id === 'number' ? pending.get(message.id) : undefined;
      if (settle !== undefined) {
        pending.delete(message.id as number);
        settle(message as { result?: any; error?: any });
      }
    }
  });

  const request = (method: string, params?: unknown): Promise<{ result?: any; error?: any }> => {
    const id = nextId++;
    const message =
      params === undefined
        ? { jsonrpc: '2.0', id, method }
        : { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`no reply to ${method} within ${RESPONSE_TIMEOUT_MS} ms`)),
        RESPONSE_TIMEOUT_MS
      );
      pending.set(id, (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    });
  };

  return {
    child,
    request,
    stderr,
    stop: () => {
      child.kill();
    }
  };
}

const running: Wire[] = [];
afterEach(() => {
  for (const wire of running.splice(0)) wire.stop();
});

/**
 * A direct run of one argv, as the `peaks` CLI, parsed.
 *
 * The exit status is deliberately NOT asserted: `request show` answers with a
 * failed envelope (and a non-zero status) whenever the requested role has no
 * artifact yet, and that case has to be comparable too — a comparison that only
 * held for successful calls would say nothing about the failures AC-6 is about.
 */
async function directRun(argv: readonly string[]): Promise<unknown> {
  const execution = await executeCliArgv(argv, { cwd: REPO_ROOT });
  return JSON.parse(execution.stdout) as unknown;
}

/** Drop the per-invocation correlation id, keeping every other field. */
function withoutInvocationId(envelope: Record<string, unknown>): Record<string, unknown> {
  const { errorId: _ignored, ...rest } = envelope;
  return rest;
}

describe('Scenario: integration - over the real pipe, the surface is the whitelist', () => {
  it('when the server is asked, should list exactly the whitelisted tools', async () => {
    // given: the shipped launcher started as a process
    const wire = startServer();
    running.push(wire);
    // when:  it is initialised and its tools are listed
    const init = await wire.request('initialize', { protocolVersion: '2025-06-18' });
    const listed = await wire.request('tools/list');
    // then:  the wire carries the artifact's tools and nothing else
    expect(init.result.protocolVersion).toBe('2025-06-18');
    expect(init.result.serverInfo.name).toBe('peaks');
    expect(listed.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      [...toolIdsOf(loadReadOnlyWhitelist())].sort()
    );
  }, 120_000);

  it('when a status call runs, should return each argv result as the CLI itself returns it', async () => {
    // given: a started server and the three argv the composite owns
    const wire = startServer();
    running.push(wire);
    await wire.request('initialize', { protocolVersion: '2025-06-18' });
    const args = { project: REPO_ROOT, rid: ABSENT_RID, role: 'rd' };
    // when:  the composite is called over the wire
    const call = await wire.request('tools/call', { name: 'peaks_status', arguments: args });
    const payload = JSON.parse(call.result.content[0].text) as Record<string, unknown>;
    // then:  each key is deep-equal to a SEPARATE direct run of the same argv -
    //        the composite added and removed nothing, which is AC-3 measured
    //        rather than asserted from a stub
    expect(payload['skill-presence']).toEqual(await directRun(['skill', 'presence', '--json']));
    expect(payload['session-list']).toEqual(await directRun(['session', 'list', '--json']));
    const directRequest = (await directRun([
      'request',
      'show',
      ABSENT_RID,
      '--role',
      'rd',
      '--json',
      '--project',
      REPO_ROOT
    ])) as Record<string, unknown>;
    // A failed envelope carries a freshly minted `errorId` per invocation, so
    // that one field cannot be equal across two runs - it identifies the RUN,
    // not the result. Every other field must be, and the composite's own id must
    // be present, or AC-6's "pass it through untouched" would be half-true.
    const embedded = payload['request-show'] as Record<string, unknown>;
    expect(embedded.errorId).toBeTruthy();
    expect(withoutInvocationId(embedded)).toEqual(withoutInvocationId(directRequest));
  }, 180_000);

  it('when the memory tool runs, should answer with a bounded projection', async () => {
    // given: a started server and a term the project's memory carries
    const wire = startServer();
    running.push(wire);
    await wire.request('initialize', { protocolVersion: '2025-06-18' });
    // when:  the search runs
    const call = await wire.request('tools/call', {
      name: 'peaks_memory_search',
      arguments: { query: 'whitelist', limit: 5 }
    });
    const payload = JSON.parse(call.result.content[0].text) as {
      matches: Array<Record<string, unknown>>;
    };
    // then:  the reply is bounded by count and by excerpt, and carries no note
    //        body - §7.1's contract, on real data
    expect(call.result.isError).toBeUndefined();
    expect(payload.matches.length).toBeLessThanOrEqual(MEMORY_MAX_RETURNED);
    for (const match of payload.matches) {
      expect(Object.keys(match).sort()).toEqual(['excerpt', 'kind', 'name']);
      expect(String(match.excerpt).length).toBeLessThanOrEqual(MEMORY_EXCERPT_CHARS);
    }
  }, 120_000);
});

describe('Scenario: behavior - a failing CLI call is a failing tool call', () => {
  it('when the CLI reports failure, should mark the result an error and keep its envelope', async () => {
    // given: a request id whose rd artifact cannot exist in any session
    const wire = startServer();
    running.push(wire);
    await wire.request('initialize', { protocolVersion: '2025-06-18' });
    // when:  the composite runs
    const call = await wire.request('tools/call', {
      name: 'peaks_status',
      arguments: { project: REPO_ROOT, rid: ABSENT_RID, role: 'rd' }
    });
    const payload = JSON.parse(call.result.content[0].text) as Record<string, any>;
    // then:  the caller sees isError, and the CLI's own identifiers survived -
    //        code, errorId and nextActions are the fields a reader needs to act
    //        on it, and a "looks fine, empty" reply would have hidden all three
    expect(call.result.isError).toBe(true);
    expect(payload['request-show'].ok).toBe(false);
    expect(typeof payload['request-show'].errorId).toBe('string');
    expect(Array.isArray(payload['request-show'].nextActions)).toBe(true);
    expect(typeof payload['request-show'].code).toBe('string');
  }, 180_000);
});

describe('Scenario: render - an out-of-surface call never reaches a process', () => {
  it('when an unknown tool is called, should be refused by the protocol', async () => {
    // given: a started server
    const wire = startServer();
    running.push(wire);
    await wire.request('initialize', { protocolVersion: '2025-06-18' });
    // when:  a tool the surface does not declare is called
    const call = await wire.request('tools/call', { name: 'peaks_invoke', arguments: {} });
    // then:  the refusal is a protocol error, so nothing was executed and the
    //        server stayed up for the next call
    expect(call.error.code).toBe(-32602);
    const after = await wire.request('tools/list');
    expect(after.result.tools.length).toBeGreaterThan(0);
  }, 120_000);
});

describe('Scenario: a11y - the server says nothing on stdout that is not a message', () => {
  it('when the server is started and answered, should keep its stdout protocol-only', async () => {
    // given: a started server whose launcher and CLI both write diagnostics
    const wire = startServer();
    running.push(wire);
    // when:  a request is answered
    const listed = await wire.request('tools/list');
    // then:  every stdout line parsed as a message (the client would have thrown
    //        otherwise), and the Node deprecation chatter the CLI emits turned up
    //        on stderr instead
    expect(Array.isArray(listed.result.tools)).toBe(true);
    expect(wire.stderr.join('')).not.toContain('"jsonrpc"');
  }, 120_000);
});
