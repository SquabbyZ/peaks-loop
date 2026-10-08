// src/services/mcp/json-rpc.ts
//
// JSON-RPC 2.0 message shapes plus the stdio framing MCP uses, implemented in
// this tree rather than pulled in as a dependency.
//
// WHY NOT THE SDK. peaks-loop ships 12 runtime dependencies to every user
// globally, and the protocol surface this server needs is four methods and five
// error codes — all frozen since the first MCP revision. A dependency would be
// the larger commitment. See the slice report for the exact surface list.
//
// THE FRAMING IS NEWLINE-DELIMITED JSON, not LSP's `Content-Length` headers.
// That is the MCP stdio transport's rule, and it is also why a message may not
// contain a raw newline: this module therefore serializes with `JSON.stringify`
// (which escapes newlines inside strings) and never pretty-prints.

/** The only JSON-RPC version this server speaks. */
export const JSON_RPC_VERSION = '2.0' as const;

/** A request/response correlation id. `null` is legal and means "unknown". */
export type JsonRpcId = string | number | null;

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcRequest {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

/** A request WITHOUT an id. JSON-RPC forbids replying to one. */
export interface JsonRpcNotification {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcSuccess {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcFailure {
  readonly jsonrpc: typeof JSON_RPC_VERSION;
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

/** Standard JSON-RPC codes. The server adds no private codes of its own. */
export const JSON_RPC_PARSE_ERROR = -32700;
export const JSON_RPC_INVALID_REQUEST = -32600;
export const JSON_RPC_METHOD_NOT_FOUND = -32601;
export const JSON_RPC_INVALID_PARAMS = -32602;
export const JSON_RPC_INTERNAL_ERROR = -32603;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'string' || typeof value === 'number' || value === null;
}

/** What one decoded line turned out to be. */
export type DecodedMessage =
  | { readonly kind: 'request'; readonly request: JsonRpcRequest }
  | { readonly kind: 'notification'; readonly notification: JsonRpcNotification }
  | { readonly kind: 'invalid'; readonly id: JsonRpcId; readonly error: JsonRpcErrorObject };

export function makeError(code: number, message: string, data?: unknown): JsonRpcErrorObject {
  return data === undefined ? { code, message } : { code, message, data };
}

export function successResponse(id: JsonRpcId, result: unknown): JsonRpcSuccess {
  return { jsonrpc: JSON_RPC_VERSION, id, result };
}

export function failureResponse(id: JsonRpcId, error: JsonRpcErrorObject): JsonRpcFailure {
  return { jsonrpc: JSON_RPC_VERSION, id, error };
}

function invalid(id: JsonRpcId, code: number, message: string): DecodedMessage {
  return { kind: 'invalid', id, error: makeError(code, message) };
}

/** The message's id when it carries a legal one, else the protocol's `null`. */
function idOf(parsed: Record<string, unknown>): JsonRpcId {
  const id: unknown = parsed['id'];
  return isJsonRpcId(id) ? id : null;
}

/**
 * Build the message from a well-formed envelope. The presence of the `id` KEY is
 * the only thing separating a request from a notification — `id: null` is a legal
 * id, so this cannot be written as a null check.
 */
function buildMessage(parsed: Record<string, unknown>, method: string): DecodedMessage {
  const params: unknown = parsed['params'];
  const head = { jsonrpc: JSON_RPC_VERSION, method, ...(params === undefined ? {} : { params }) };
  return 'id' in parsed
    ? { kind: 'request', request: { ...head, id: idOf(parsed) } }
    : { kind: 'notification', notification: head };
}

/**
 * Decode one frame.
 *
 * `undefined` means "nothing to answer" — an empty line, which is legal padding
 * and must not be reported as a parse error (an empty line is not a message the
 * peer sent; it is whitespace between messages).
 */
export function decodeMessage(line: string): DecodedMessage | undefined {
  if (line.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return invalid(null, JSON_RPC_PARSE_ERROR, 'Invalid JSON received on the transport.');
  }
  if (!isPlainObject(parsed) || parsed['jsonrpc'] !== JSON_RPC_VERSION) {
    const id = isPlainObject(parsed) ? idOf(parsed) : null;
    return invalid(
      id,
      JSON_RPC_INVALID_REQUEST,
      `Messages must declare jsonrpc "${JSON_RPC_VERSION}".`
    );
  }
  const method: unknown = parsed['method'];
  if (typeof method !== 'string' || method.length === 0) {
    return invalid(
      idOf(parsed),
      JSON_RPC_INVALID_REQUEST,
      'Messages must carry a non-empty "method".'
    );
  }
  return buildMessage(parsed, method);
}

/**
 * Encode one frame for the wire. `JSON.stringify` escapes every newline inside
 * a string, which is what keeps one message on one line.
 */
export function encodeMessage(message: JsonRpcResponse | JsonRpcNotification): string {
  return `${JSON.stringify(message)}\n`;
}

/**
 * The buffer that turns an arbitrary chunking of bytes into whole lines.
 *
 * Needed because a pipe delivers no framing of its own: one `data` event may
 * carry half a message or three of them, and a server that parsed each event as
 * a message would work on a fast local pipe and fail on a loaded one.
 */
export class LineDecoder {
  private buffer = '';

  /** Feed a chunk; get back the complete lines it completed (no trailing newline). */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // The last element is either an incomplete line or '' when the chunk ended
    // on a newline. Either way it stays buffered for the next push.
    this.buffer = lines.pop() ?? '';
    return lines;
  }

  /** Whatever is left when the stream ends. A peer that never sent a newline still sent a message. */
  flush(): string[] {
    const remainder = this.buffer.trim().length > 0 ? [this.buffer] : [];
    this.buffer = '';
    return remainder;
  }
}
