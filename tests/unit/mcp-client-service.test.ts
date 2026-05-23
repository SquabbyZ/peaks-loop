import { describe, expect, test } from 'vitest';
import { createMcpClient, type McpClientTransport } from '../../src/services/mcp/mcp-client-service.js';
import { buildRequest, serializeMessage } from '../../src/services/mcp/mcp-protocol.js';

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

function responseFor(id: number, result: unknown): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`;
}

function errorResponseFor(id: number, message: string, code = -32000): string {
  return `${JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } })}\n`;
}

describe('createMcpClient', () => {
  test('sends a serialized JSON-RPC request and resolves with the matching result', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    const promise = client.request('tools/list');
    expect(transport.sent).toHaveLength(1);
    const sent = JSON.parse(transport.sent[0]!.trim()) as { id: number; method: string };
    expect(sent.method).toBe('tools/list');
    transport.emit(responseFor(sent.id, { tools: [{ name: 'lookup' }] }));

    await expect(promise).resolves.toEqual({ tools: [{ name: 'lookup' }] });
  });

  test('routes concurrent requests by id', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    const a = client.request('a');
    const b = client.request('b');
    expect(transport.sent).toHaveLength(2);

    const idA = (JSON.parse(transport.sent[0]!.trim()) as { id: number }).id;
    const idB = (JSON.parse(transport.sent[1]!.trim()) as { id: number }).id;

    transport.emit(responseFor(idB, 'b-result'));
    transport.emit(responseFor(idA, 'a-result'));

    await expect(a).resolves.toBe('a-result');
    await expect(b).resolves.toBe('b-result');
  });

  test('rejects when the response carries a JSON-RPC error', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    const promise = client.request('tools/call');
    const id = (JSON.parse(transport.sent[0]!.trim()) as { id: number }).id;
    transport.emit(errorResponseFor(id, 'tool failed', -32001));

    await expect(promise).rejects.toThrowError(/-32001.*tool failed/);
  });

  test('rejects when the response does not arrive before the timeout', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 25 });

    await expect(client.request('slow')).rejects.toThrowError(/timed out/i);
  });

  test('ignores responses for unknown ids without breaking later requests', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    transport.emit(responseFor(9999, 'ghost'));

    const promise = client.request('ok');
    const id = (JSON.parse(transport.sent[0]!.trim()) as { id: number }).id;
    transport.emit(responseFor(id, 'fresh'));

    await expect(promise).resolves.toBe('fresh');
  });

  test('rejects when the transport send fails', async () => {
    const transport = createFakeTransport();
    transport.send = async () => {
      throw new Error('transport down');
    };
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    await expect(client.request('whatever')).rejects.toThrowError(/transport down/);
  });

  test('wraps non-Error transport rejections in an Error', async () => {
    const transport = createFakeTransport();
    transport.send = async () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw 'string-reason';
    };
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    await expect(client.request('whatever')).rejects.toThrowError(/string-reason/);
  });

  test('close delegates to the transport', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    await client.close();

    expect(transport.closed).toBe(true);
  });

  test('uses default timeout when timeoutMs is not provided', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport });

    const promise = client.request('immediate');
    const id = (JSON.parse(transport.sent[0]!.trim()) as { id: number }).id;
    transport.emit(responseFor(id, 'done'));

    await expect(promise).resolves.toBe('done');
  });

  test('buffers split responses across multiple onLine deliveries', async () => {
    const transport = createFakeTransport();
    const client = createMcpClient({ transport, timeoutMs: 1000 });

    const promise = client.request('split');
    const id = (JSON.parse(transport.sent[0]!.trim()) as { id: number }).id;
    const full = responseFor(id, 'partial');
    const half = full.length / 2;
    transport.emit(full.slice(0, half));
    transport.emit(full.slice(half));

    await expect(promise).resolves.toBe('partial');
  });

  test('exposes buildRequest helper for callers (smoke)', () => {
    const request = buildRequest(42, 'tools/list');
    const line = serializeMessage(request);
    expect(line.endsWith('\n')).toBe(true);
  });
});
