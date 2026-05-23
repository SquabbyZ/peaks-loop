export type McpJsonRpcRequest = {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
};

export type McpJsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type McpJsonRpcResponse = {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: McpJsonRpcError;
};

export type ParsedMessages = {
  messages: McpJsonRpcResponse[];
  remainder: string;
};

export function buildRequest(id: number, method: string, params?: unknown): McpJsonRpcRequest {
  if (params === undefined) {
    return { jsonrpc: '2.0', id, method };
  }
  return { jsonrpc: '2.0', id, method, params };
}

export function serializeMessage(message: McpJsonRpcRequest | McpJsonRpcResponse): string {
  return `${JSON.stringify(message)}\n`;
}

function isJsonRpcResponse(value: unknown): value is McpJsonRpcResponse {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (record.jsonrpc !== '2.0') {
    return false;
  }
  return typeof record.id === 'number';
}

export function parseMessages(buffer: string): ParsedMessages {
  const lastNewline = buffer.lastIndexOf('\n');
  const remainder = lastNewline === -1 ? buffer : buffer.slice(lastNewline + 1);
  const completePart = lastNewline === -1 ? '' : buffer.slice(0, lastNewline);
  const messages: McpJsonRpcResponse[] = [];
  for (const line of completePart.split('\n')) {
    if (line.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isJsonRpcResponse(parsed)) {
      messages.push(parsed);
    }
  }
  return { messages, remainder };
}
