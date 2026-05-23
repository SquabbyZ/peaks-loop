import { describe, expect, test } from 'vitest';
import { buildRequest, parseMessages, serializeMessage } from '../../src/services/mcp/mcp-protocol.js';

describe('buildRequest', () => {
  test('produces a JSON-RPC 2.0 request envelope with id, method, and params', () => {
    const request = buildRequest(7, 'tools/call', { name: 'foo', arguments: { x: 1 } });

    expect(request).toEqual({
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'foo', arguments: { x: 1 } }
    });
  });

  test('omits the params field when no params are provided', () => {
    const request = buildRequest(1, 'initialize');

    expect(request).toEqual({ jsonrpc: '2.0', id: 1, method: 'initialize' });
    expect((request as Record<string, unknown>).params).toBeUndefined();
  });
});

describe('serializeMessage', () => {
  test('serializes a request and appends a newline delimiter', () => {
    const line = serializeMessage(buildRequest(2, 'tools/list'));

    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line.trimEnd()) as Record<string, unknown>;
    expect(parsed.method).toBe('tools/list');
  });
});

describe('parseMessages', () => {
  test('parses a single complete line and leaves no remainder', () => {
    const message = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const { messages, remainder } = parseMessages(`${message}\n`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(1);
    expect(remainder).toBe('');
  });

  test('parses two complete lines back to back', () => {
    const m1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const m2 = JSON.stringify({ jsonrpc: '2.0', id: 2, error: { code: -1, message: 'oops' } });
    const { messages, remainder } = parseMessages(`${m1}\n${m2}\n`);

    expect(messages).toHaveLength(2);
    expect(messages[0]?.id).toBe(1);
    expect(messages[1]?.error?.message).toBe('oops');
    expect(remainder).toBe('');
  });

  test('returns the trailing partial line as remainder', () => {
    const m1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'a' });
    const partial = '{"jsonrpc":"2.0","id":2';
    const { messages, remainder } = parseMessages(`${m1}\n${partial}`);

    expect(messages).toHaveLength(1);
    expect(remainder).toBe(partial);
  });

  test('skips blank lines', () => {
    const m1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'a' });
    const { messages } = parseMessages(`\n\n${m1}\n\n`);

    expect(messages).toHaveLength(1);
  });

  test('skips malformed JSON lines without throwing', () => {
    const m1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'a' });
    const { messages, remainder } = parseMessages(`{not json}\n${m1}\n`);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(1);
    expect(remainder).toBe('');
  });

  test('skips parsed lines that are not JSON-RPC response shapes', () => {
    const m1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: 'a' });
    const { messages } = parseMessages(`"just-a-string"\n${m1}\n[1,2,3]\n`);

    expect(messages).toHaveLength(1);
  });

  test('treats a buffer with no newline as a single trailing partial line', () => {
    const partial = '{"jsonrpc":"2.0","id":1';
    const { messages, remainder } = parseMessages(partial);

    expect(messages).toEqual([]);
    expect(remainder).toBe(partial);
  });

  test('skips parsed lines that have the wrong jsonrpc version', () => {
    const m1 = JSON.stringify({ jsonrpc: '1.0', id: 1, result: 'a' });
    const { messages } = parseMessages(`${m1}\n`);

    expect(messages).toEqual([]);
  });
});
