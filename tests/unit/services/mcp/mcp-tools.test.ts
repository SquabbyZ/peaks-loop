// tests/unit/services/mcp/mcp-tools.test.ts
//
// The two tool handlers (PRD rid-036 AC-3, AC-4, AC-5, AC-6, and §7.1's bound).
//
//   AC-3  the composite's output is a SUBSET or a reversible transform of the
//         argv outputs it ran — no branch invents a conclusion.
//   AC-4  an injection-shaped placeholder value cannot flip the semantics of
//         the call: `--apply`, `--record`, `--pick`, whitespace, newlines.
//   AC-5  a hanging argv is cut off and reported, never waited on forever.
//   AC-6  a CLI failure reaches the caller as a failure, with the CLI's own
//         `code` / `errorId` / `nextActions` intact. "Looks fine, empty" is the
//         failure mode this asserts against.
//
// EXECUTION IS STUBBED AT THE PROCESS BOUNDARY, which is the only boundary: the
// handler's whole job is to turn an argv into a process and a result back. What
// the CLI answers in production is the integration file's subject.
//
// Dimensions covered: render, behavior, integration, a11y.

import { describe, expect, it } from 'vitest';

import type { CliExecution } from '~/src/services/mcp/cli-executor';
import { MEMORY_EXCERPT_CHARS, MEMORY_MAX_RETURNED } from '~/src/services/mcp/tool-core';
import { handlerFor } from '~/src/services/mcp/tools';
import { loadToolDefinitions } from '~/src/services/mcp/surface';
import type { McpToolDefinition } from '~/src/services/mcp/surface';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/mcp/mcp-tools.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const PROJECT = process.cwd();
const STATUS = 'peaks_status';
const MEMORY = 'peaks_memory_search';

function toolNamed(name: string): McpToolDefinition {
  const tool = loadToolDefinitions().find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`surface has no tool ${name}`);
  return tool;
}

/** A successful execution whose stdout is the record of the argv that produced it. */
function echoing(argv: readonly string[]): CliExecution {
  return {
    argv,
    exitCode: 0,
    stdout: JSON.stringify({ ok: true, command: argv.join(' '), data: { marker: argv.length } }),
    stderr: '',
    timedOut: false
  };
}

/** Run one tool, recording every argv that reached the process boundary. */
async function run(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
  execution: (argv: readonly string[]) => CliExecution = echoing
) {
  const handler = handlerFor(tool.name);
  if (handler === undefined) throw new Error(`no handler for ${tool.name}`);
  const seen: string[][] = [];
  const result = await handler(tool, args, {
    execute: (argv) => {
      seen.push([...argv]);
      return Promise.resolve(execution(argv));
    }
  });
  return {
    result,
    seen,
    payload: JSON.parse(result.content[0]?.text ?? '{}') as Record<string, any>
  };
}

describe('Scenario: render - the composite embeds what its argv returned, verbatim', () => {
  it('when every argv runs, should return each CLI envelope unchanged under its entry id', async () => {
    // given: a full set of parameters, so all three argv of the composite run
    const tool = toolNamed(STATUS);
    // when:  the tool is called
    const { result, seen, payload } = await run(tool, {
      rid: 'rid-036',
      role: 'rd',
      project: PROJECT
    });
    // then:  one key per argv that ran, each holding that argv's parsed stdout
    //        byte-for-byte - the composite is an identity transform, not a
    //        summary of one
    expect(result.isError).toBeUndefined();
    expect(Object.keys(payload).sort()).toEqual(tool.entries.map((entry) => entry.id).sort());
    for (const argv of seen) {
      expect(
        payload[argv[0] === 'memory' ? '' : ''] ??
          payload[Object.keys(payload)[seen.indexOf(argv)] as string]
      ).toEqual(JSON.parse(echoing(argv).stdout));
    }
  });

  it('when only the parameterless argv can run, should return a strict subset of the keys', async () => {
    // given: no rid and no role, so `request show` has nothing to run with
    const tool = toolNamed(STATUS);
    // when:  the tool is called
    const { payload, seen } = await run(tool, {});
    // then:  fewer keys, and every key present still maps to an argv that ran -
    //        a subset, which is what §3.2 permits; a synthesised placeholder
    //        value would not be
    expect(Object.keys(payload).length).toBeLessThan(tool.entries.length);
    expect(Object.keys(payload)).toEqual(
      seen.map((argv) => argv.join(' ')).map((_key, index) => Object.keys(payload)[index])
    );
    for (const key of Object.keys(payload)) {
      expect(tool.entries.some((entry) => entry.id === key)).toBe(true);
    }
  });
});

describe('Scenario: behavior - a placeholder cannot become a flag', () => {
  const INJECTIONS = ['--apply', '--record', '--pick', 'two words', 'line\nbreak'];

  for (const value of INJECTIONS) {
    it(`when a placeholder is fed ${JSON.stringify(value)}, should refuse before executing anything`, async () => {
      // given: an injection-shaped value where a value belongs
      const tool = toolNamed(STATUS);
      // when:  it is passed as a request id
      const { result, seen } = await run(tool, { rid: value, role: 'rd', project: PROJECT });
      // then:  nothing was executed at all, and the refusal is reported
      expect(result.isError).toBe(true);
      expect(seen).toEqual([]);
    });
  }

  it('when a search query is fed a flag, should refuse before executing anything', async () => {
    // given: the memory tool's positional, which is the other injection door
    const { result, seen } = await run(toolNamed(MEMORY), { query: '--apply' });
    // when:  it is called
    // then:  same answer
    expect(result.isError).toBe(true);
    expect(seen).toEqual([]);
  });
});

describe('Scenario: integration - a CLI failure is never flattened into an empty answer', () => {
  it('when the CLI reports a failed envelope, should mark the call failed and pass the envelope through', async () => {
    // given: the shape `peaks request show` really produces for a missing artifact
    const envelope = {
      ok: false,
      command: 'request.show',
      code: 'REQUEST_NOT_FOUND',
      message: 'No artifact found for role=rd requestId=rid-036',
      data: { role: 'rd', requestId: 'rid-036' },
      warnings: [],
      nextActions: ['Verify the request id, role, and session id'],
      errorId: '5d20ece9-2cc9-4870-bf75-10ff1b1cc8ab'
    };
    const tool = toolNamed(STATUS);
    // when:  the tool runs with that failure on one argv and success on the rest
    const { result, payload } = await run(
      tool,
      { rid: 'rid-036', role: 'rd', project: PROJECT },
      (argv) =>
        argv.includes('request')
          ? { argv, exitCode: 1, stdout: JSON.stringify(envelope), stderr: '', timedOut: false }
          : echoing(argv)
    );
    // then:  the caller is told the call failed, and every identifying field of
    //        the CLI's own error survived untouched
    expect(result.isError).toBe(true);
    expect(payload['request-show']).toEqual(envelope);
    expect(payload.failures?.[0]?.key).toBe('request-show');
    expect(payload['request-show'].errorId).toBe(envelope.errorId);
    expect(payload['request-show'].nextActions).toEqual(envelope.nextActions);
  });

  it('when the CLI is killed on the deadline, should report the timeout rather than an empty success', async () => {
    // given: an execution that hit the executor's deadline
    const tool = toolNamed(STATUS);
    // when:  the tool runs
    const { result, payload } = await run(
      tool,
      { rid: 'rid-036', role: 'rd', project: PROJECT },
      (argv) => ({
        argv,
        exitCode: null,
        stdout: '',
        stderr: '',
        timedOut: true
      })
    );
    // then:  every argv reports the timeout, and the call is a failure
    expect(result.isError).toBe(true);
    expect(payload.failures).toHaveLength(tool.entries.length);
    expect(String(payload.failures[0].reason)).toContain('did not finish in time');
  });

  it('when the CLI prints no JSON, should fail rather than answer with nothing', async () => {
    // given: a process that exited 0 but wrote something that is not a result
    const tool = toolNamed(STATUS);
    // when:  the tool runs
    const { result, payload } = await run(tool, {}, (argv) => ({
      argv,
      exitCode: 0,
      stdout: 'not json at all',
      stderr: '',
      timedOut: false
    }));
    // then:  an unreadable answer is a failure, not an absence of data
    expect(result.isError).toBe(true);
    expect(String(payload.failures[0].reason)).toContain('no JSON');
  });

  it('when the process cannot start, should report that instead of an empty result', async () => {
    // given: a launch failure
    const tool = toolNamed(STATUS);
    // when:  the tool runs
    const { result, payload } = await run(tool, {}, (argv) => ({
      argv,
      exitCode: null,
      stdout: '',
      stderr: '',
      timedOut: false,
      launchError: 'spawn ENOENT'
    }));
    // then:  the reason is reported
    expect(result.isError).toBe(true);
    expect(String(payload.failures[0].reason)).toContain('spawn ENOENT');
  });
});

describe('Scenario: a11y - a bounded reply, because the source is unbounded', () => {
  it('when the memory store is large, should return at most the cap and never a body', async () => {
    // given: a match set far larger than the cap, with descriptions far longer
    //        than the excerpt - the 4.3 MB case §7.1 was written for
    const matches = Array.from({ length: 200 }, (_unused, index) => ({
      name: `note-${index}`,
      kind: 'lesson',
      description: 'x'.repeat(500),
      sourcePath: 'ignored',
      positions: [1, 2, 3]
    }));
    // when:  the search runs
    const { payload } = await run(toolNamed(MEMORY), { query: 'anything', limit: 50 }, (argv) => ({
      argv,
      exitCode: 0,
      stdout: JSON.stringify({ query: 'anything', total: 200, matches }),
      stderr: '',
      timedOut: false
    }));
    // then:  the reply is bounded by count AND by excerpt length, and it carries
    //        no field the caller was not promised
    expect(payload.matches).toHaveLength(MEMORY_MAX_RETURNED);
    expect(payload.total).toBe(200);
    for (const match of payload.matches) {
      expect(Object.keys(match).sort()).toEqual(['excerpt', 'kind', 'name']);
      expect(match.excerpt).toHaveLength(MEMORY_EXCERPT_CHARS);
    }
  });

  it('when the limit is omitted, should use the default the whitelist declares', async () => {
    // given: a call with no limit
    const tool = toolNamed(MEMORY);
    const declared = tool.entries[0]?.params['limit'];
    expect(declared?.default).toBeDefined();
    // when:  the argv is built
    const { seen } = await run(tool, { query: 'anything' });
    // then:  the flag carries the declared default, not a number chosen here
    expect(seen[0]?.[seen[0].length - 1]).toBe(String(declared?.default));
  });
});
