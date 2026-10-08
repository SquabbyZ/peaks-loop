// tests/unit/services/mcp/mcp-server.test.ts
//
// The MCP protocol core and the tool surface (PRD rid-036 AC-1, AC-2).
//
//   AC-1  the server implements only the tools the whitelist declares, every
//         argv of every tool comes from the whitelist, and a call outside it is
//         refused BEFORE anything executes.
//   AC-2  the server is a pipe: it keeps no state between messages and never
//         rewrites what the CLI said.
//
// THE TOOL SET IS ASSERTED AGAINST THE ARTIFACT, not against a literal list. A
// literal would still pass if the server grew a third tool and the whitelist did
// not, which is the drift this surface exists to make impossible.
//
// Dimensions covered: render, behavior, integration, a11y.

import { describe, expect, it } from 'vitest';

import { DEFAULT_PROTOCOL_VERSION, SERVER_NAME, createMcpServer } from '~/src/services/mcp/server';
import {
  buildToolDefinitions,
  loadToolDefinitions,
  validateSurface,
  McpSurfaceError
} from '~/src/services/mcp/surface';
import type { McpToolDefinition } from '~/src/services/mcp/surface';
import {
  loadReadOnlyWhitelist,
  toolIdsOf
} from '~/src/services/readonly-surface/readonly-whitelist';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/mcp/mcp-server.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A server over the real surface, with execution stubbed out. */
function makeServer() {
  return createMcpServer({
    tools: loadToolDefinitions(),
    context: {
      execute: () =>
        Promise.resolve({
          argv: [],
          exitCode: 0,
          stdout: '{"ok":true}',
          stderr: '',
          timedOut: false
        })
    }
  });
}

/** Send one line and decode the single reply line. */
async function call(server: ReturnType<typeof makeServer>, line: string) {
  const out = await server.handleLine(line);
  expect(out).toBeDefined();
  return JSON.parse(String(out)) as { id?: unknown; result?: any; error?: any };
}

function request(method: string, params?: unknown): string {
  return JSON.stringify(
    params === undefined
      ? { jsonrpc: '2.0', id: 1, method }
      : { jsonrpc: '2.0', id: 1, method, params }
  );
}

describe('Scenario: render - the messages the protocol defines, and nothing else', () => {
  it('when initialize arrives, should answer with version, capabilities and server info', async () => {
    // given: a client that names a protocol version
    const server = makeServer();
    // when:  initialize is answered
    const reply = await call(server, request('initialize', { protocolVersion: '2024-11-05' }));
    // then:  the requested version is echoed, tools are advertised, and the
    //        server names itself
    expect(reply.result.protocolVersion).toBe('2024-11-05');
    expect(reply.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(reply.result.serverInfo.name).toBe(SERVER_NAME);
    expect(typeof reply.result.serverInfo.version).toBe('string');
  });

  it('when initialize names no version, should answer with the server default', async () => {
    // given: a client that omits protocolVersion
    const server = makeServer();
    // when:  initialize is answered
    const reply = await call(server, request('initialize', {}));
    // then:  the fallback is used instead of an empty string
    expect(reply.result.protocolVersion).toBe(DEFAULT_PROTOCOL_VERSION);
  });

  it('when tools/list arrives, should return exactly the tools the whitelist declares', async () => {
    // given: the generated whitelist
    const expected = toolIdsOf(loadReadOnlyWhitelist());
    const server = makeServer();
    // when:  tools/list is answered
    const reply = await call(server, request('tools/list'));
    // then:  the set is the artifact's, each tool has a description and a schema,
    //        and no second list disagreed
    expect(reply.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
      [...expected].sort()
    );
    for (const tool of reply.result.tools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.inputSchema.additionalProperties).toBe(false);
      expect(tool.entries).toBeUndefined();
    }
  });
});

describe('Scenario: behavior - unknown surface is refused before anything runs', () => {
  it('when tools/call names a tool the surface does not declare, should answer an error', async () => {
    // given: a tool name no adapter or whitelist entry produced
    const server = makeServer();
    // when:  it is called
    const reply = await call(
      server,
      request('tools/call', { name: 'peaks_invoke', arguments: {} })
    );
    // then:  the call is refused at the protocol boundary
    expect(reply.result).toBeUndefined();
    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toContain('peaks_invoke');
  });

  it('when tools/call carries an undeclared argument, should refuse the call', async () => {
    // given: a declared tool and an argument its schema does not list
    const declared = loadToolDefinitions()[0];
    expect(declared).toBeDefined();
    const server = makeServer();
    // when:  the call arrives with an injection-shaped extra key
    const reply = await call(
      server,
      request('tools/call', { name: declared?.name, arguments: { extra: '--apply' } })
    );
    // then:  it never reaches a handler, so it never reaches an argv
    expect(reply.error.code).toBe(-32602);
    expect(reply.error.message).toContain('extra');
  });

  it('when a method is unknown, should answer method-not-found', async () => {
    // given: a method outside the four this server implements
    const server = makeServer();
    // when:  it is requested
    const reply = await call(server, request('resources/list'));
    // then:  the omission is reported rather than left as silence
    expect(reply.error.code).toBe(-32601);
  });
});

describe('Scenario: integration - the transport framing and its failure modes', () => {
  it('when a notification arrives, should answer nothing at all', async () => {
    // given: `notifications/initialized`, which JSON-RPC forbids replying to
    const server = makeServer();
    // when:  it is sent
    const out = await server.handleLine(
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
    );
    // then:  nothing is written - a reply here would desynchronise the stream
    expect(out).toBeUndefined();
  });

  it('when a blank line arrives, should answer nothing at all', async () => {
    // given: padding between messages
    const server = makeServer();
    // when:  it is fed
    // then:  it is not a message, so it is not an error either
    expect(await server.handleLine('   ')).toBeUndefined();
  });

  it('when the line is not JSON, should answer a parse error', async () => {
    // given: a truncated frame
    const server = makeServer();
    // when:  it is fed
    const reply = JSON.parse(String(await server.handleLine('{"jsonrpc":'))) as { error: any };
    // then:  the failure is named, with the id the protocol requires for an
    //        unidentifiable message
    expect(reply.error.code).toBe(-32700);
  });

  it('when the envelope is not a JSON-RPC 2.0 message, should answer invalid-request', async () => {
    // given: well-formed JSON that is not a request
    const server = makeServer();
    // when:  it is fed
    const reply = JSON.parse(String(await server.handleLine('[1,2,3]'))) as { error: any };
    // then:  it is refused as a request, not reported as a parse failure
    expect(reply.error.code).toBe(-32600);
  });
});

describe('Scenario: a11y - a refused surface says which rule it broke', () => {
  it('when a tool has no description, should refuse to start', () => {
    // given: a surface whose tool cannot tell an LLM what it is for
    const whitelist = loadReadOnlyWhitelist();
    const [tool] = buildToolDefinitions(whitelist);
    expect(tool).toBeDefined();
    const described: McpToolDefinition = { ...(tool as McpToolDefinition), description: '  ' };
    // when:  the surface is validated
    // then:  the refusal names the tool and the rule
    expect(() => validateSurface(whitelist, [described])).toThrow(McpSurfaceError);
    expect(() => validateSurface(whitelist, [described])).toThrow(/description/);
  });

  it('when a tool would run an argv the whitelist does not carry, should refuse to start', () => {
    // given: a surface carrying one argv no proof covers - the shape spec §6's L4
    //        exists for
    const whitelist = loadReadOnlyWhitelist();
    const [tool] = loadToolDefinitions();
    expect(tool).toBeDefined();
    const smuggled: McpToolDefinition = {
      ...(tool as McpToolDefinition),
      entries: [
        ...(tool as McpToolDefinition).entries,
        {
          id: 'smuggled-write',
          tool: (tool as McpToolDefinition).name,
          commandPath: ['memory', 'list'],
          argv: [
            { kind: 'literal', value: 'memory' },
            { kind: 'literal', value: 'list' },
            { kind: 'literal', value: '--pick' }
          ],
          params: {},
          introspection: { optionTokens: ['--pick'], positionalCount: 0 }
        }
      ]
    };
    // when:  the surface is validated
    // then:  the server refuses to come up rather than serve an unproven argv
    expect(() => validateSurface(whitelist, [smuggled])).toThrow(/memory list --pick/);
  });
});
