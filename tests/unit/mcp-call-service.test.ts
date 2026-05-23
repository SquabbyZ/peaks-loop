import { describe, expect, test } from 'vitest';
import { callMcpTool, type McpCallTransportFactory } from '../../src/services/mcp/mcp-call-service.js';
import type { McpClientTransport } from '../../src/services/mcp/mcp-client-service.js';
import type { McpInstallSpec } from '../../src/services/mcp/mcp-install-registry.js';

type FakeTransport = McpClientTransport & {
  sent: string[];
  emit: (line: string) => void;
  closed: boolean;
};

function createFakeTransport(): FakeTransport {
  let handler: (line: string) => void = () => {};
  const transport: FakeTransport = {
    sent: [],
    closed: false,
    send: async (line) => {
      transport.sent.push(line);
    },
    onLine: (h) => {
      handler = h;
    },
    close: async () => {
      transport.closed = true;
    },
    emit: (line) => handler(line)
  };
  return transport;
}

function transportFactoryAutoRespond(result: unknown): { factory: McpCallTransportFactory; transport: FakeTransport } {
  const transport = createFakeTransport();
  const original = transport.send;
  transport.send = async (line) => {
    await original(line);
    const id = (JSON.parse(line.trim()) as { id: number }).id;
    transport.emit(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
  };
  return {
    factory: () => transport,
    transport
  };
}

function transportFactoryErrorResponse(message: string): { factory: McpCallTransportFactory; transport: FakeTransport } {
  const transport = createFakeTransport();
  const original = transport.send;
  transport.send = async (line) => {
    await original(line);
    const id = (JSON.parse(line.trim()) as { id: number }).id;
    transport.emit(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32001, message } })}\n`);
  };
  return { factory: () => transport, transport };
}

describe('callMcpTool', () => {
  test('rejects when the capabilityId is not in the install registry', async () => {
    await expect(
      callMcpTool({
        capabilityId: 'does.not.exist',
        toolName: 'whatever',
        env: { CONTEXT7_API_KEY: 'x' },
        transportFactory: () => createFakeTransport()
      })
    ).rejects.toThrowError(/install spec/i);
  });

  test('rejects when required env vars are missing', async () => {
    await expect(
      callMcpTool({
        capabilityId: 'context7.docs-lookup',
        toolName: 'tool',
        env: {},
        transportFactory: () => createFakeTransport()
      })
    ).rejects.toThrowError(/CONTEXT7_API_KEY/);
  });

  test('calls tools/call on the MCP server and returns the result', async () => {
    const { factory, transport } = transportFactoryAutoRespond({ content: [{ type: 'text', text: 'hello' }] });

    const result = await callMcpTool({
      capabilityId: 'context7.docs-lookup',
      toolName: 'lookup',
      args: { query: 'react' },
      env: { CONTEXT7_API_KEY: 'x' },
      transportFactory: factory,
      timeoutMs: 1000
    });

    expect(result.capabilityId).toBe('context7.docs-lookup');
    expect(result.toolName).toBe('lookup');
    expect(result.result).toEqual({ content: [{ type: 'text', text: 'hello' }] });

    const sentLine = transport.sent[0]!;
    const sent = JSON.parse(sentLine.trim()) as { method: string; params: { name: string; arguments: unknown } };
    expect(sent.method).toBe('tools/call');
    expect(sent.params.name).toBe('lookup');
    expect(sent.params.arguments).toEqual({ query: 'react' });
  });

  test('closes the transport after a successful call', async () => {
    const { factory, transport } = transportFactoryAutoRespond({ ok: true });

    await callMcpTool({
      capabilityId: 'context7.docs-lookup',
      toolName: 'tool',
      env: { CONTEXT7_API_KEY: 'x' },
      transportFactory: factory
    });

    expect(transport.closed).toBe(true);
  });

  test('closes the transport even when the call fails with an MCP error', async () => {
    const { factory, transport } = transportFactoryErrorResponse('tool unavailable');

    await expect(
      callMcpTool({
        capabilityId: 'context7.docs-lookup',
        toolName: 'tool',
        env: { CONTEXT7_API_KEY: 'x' },
        transportFactory: factory
      })
    ).rejects.toThrowError(/tool unavailable/);
    expect(transport.closed).toBe(true);
  });

  test('passes spec and env to the transport factory for downstream wiring', async () => {
    const { factory } = transportFactoryAutoRespond({ ok: true });
    const observations: Array<{ spec: McpInstallSpec; env: Record<string, string | undefined> }> = [];
    const wrappedFactory: McpCallTransportFactory = (spec, env) => {
      observations.push({ spec, env });
      return factory(spec, env);
    };

    await callMcpTool({
      capabilityId: 'context7.docs-lookup',
      toolName: 'tool',
      env: { CONTEXT7_API_KEY: 'real-value' },
      transportFactory: wrappedFactory
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]?.spec.name).toBe('context7');
    expect(observations[0]?.env.CONTEXT7_API_KEY).toBe('real-value');
  });

  test('defaults to process.env when env is not provided', async () => {
    const { factory } = transportFactoryAutoRespond({ ok: true });
    const previous = process.env.CONTEXT7_API_KEY;
    process.env.CONTEXT7_API_KEY = 'process-env-value';
    try {
      const result = await callMcpTool({
        capabilityId: 'context7.docs-lookup',
        toolName: 'tool',
        transportFactory: factory
      });
      expect(result.result).toEqual({ ok: true });
    } finally {
      if (previous === undefined) {
        delete process.env.CONTEXT7_API_KEY;
      } else {
        process.env.CONTEXT7_API_KEY = previous;
      }
    }
  });
});
