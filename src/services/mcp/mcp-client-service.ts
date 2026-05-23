import { buildRequest, parseMessages, serializeMessage, type McpJsonRpcResponse } from './mcp-protocol.js';

export type McpClientTransport = {
  send: (line: string) => Promise<void>;
  onLine: (handler: (line: string) => void) => void;
  close: () => Promise<void>;
};

export type McpClientOptions = {
  transport: McpClientTransport;
  timeoutMs?: number;
};

export type McpClientHandle = {
  request: (method: string, params?: unknown) => Promise<unknown>;
  close: () => Promise<void>;
};

type PendingEntry = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const DEFAULT_TIMEOUT_MS = 30000;

export function createMcpClient(options: McpClientOptions): McpClientHandle {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let nextId = 1;
  let buffer = '';
  const pending = new Map<number, PendingEntry>();

  function deliver(message: McpJsonRpcResponse): void {
    const entry = pending.get(message.id);
    if (entry === undefined) {
      return;
    }
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.error !== undefined) {
      entry.reject(new Error(`MCP error ${message.error.code}: ${message.error.message}`));
      return;
    }
    entry.resolve(message.result);
  }

  options.transport.onLine((line) => {
    buffer += line;
    const { messages, remainder } = parseMessages(buffer);
    buffer = remainder;
    for (const message of messages) {
      deliver(message);
    }
  });

  async function request(method: string, params?: unknown): Promise<unknown> {
    const id = nextId++;
    const message = serializeMessage(buildRequest(id, method, params));
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      options.transport.send(message).catch((error: unknown) => {
        clearTimeout(timer);
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  async function close(): Promise<void> {
    await options.transport.close();
  }

  return { request, close };
}
