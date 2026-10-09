// src/services/mcp/server.ts
//
// The protocol core: one decoded line in, at most one encoded line out.
//
// WHAT THIS SERVER IS. A table lookup, an execution, and the CLI's own answer —
// nothing else (spec §3, component 3: "there is no fourth responsibility").
// It does not know what a gate is, does not cache, keeps no state between
// messages, and never rewrites a CLI result. `handleLine` is a pure function of
// (line, surface, context), which is also what makes it testable without a pipe.
//
// THE PROTOCOL SURFACE IS DELIBERATELY SMALL and is listed in full here so it can
// be checked line by line rather than inferred:
//
//   initialize                -> protocolVersion, capabilities.tools, serverInfo
//   notifications/initialized -> accepted, no reply (it is a notification)
//   tools/list                -> tools[] {name, description, inputSchema}
//   tools/call                -> params {name, arguments} -> content[] | isError
//   (anything else, request)  -> -32601 METHOD_NOT_FOUND
//   (anything else, notification) -> ignored; JSON-RPC forbids replying
//   malformed JSON            -> -32700   wrong envelope -> -32600
//   bad tools/call params     -> -32602   handler crash  -> -32603
//
// NOT IMPLEMENTED, on purpose: `ping`, `resources/*`, `prompts/*`, `logging/*`,
// `completion/*`, `notifications/*` beyond `initialized`, progress tokens,
// cancellation, and resource subscriptions. Any of them arrives as a
// METHOD_NOT_FOUND rather than as silence.
//
// NO HANDSHAKE STATE. The server does not track whether `initialize` has been
// seen; every method is answerable on any line. MCP asks clients to initialize
// first, and this server simply does not depend on it — a state machine here
// would be state kept for no decision.
//
// PROTOCOL VERSION. The client's requested version is echoed when it names one,
// and a constant is used otherwise. Echoing is honest for this surface and not a
// claim of unlimited support: the four methods above have had identical request
// and response shapes across every published revision, so there is no version
// whose meaning this server would get wrong.

import { CLI_VERSION } from 'peaks-loop-shared/version';

import {
  decodeMessage,
  encodeMessage,
  failureResponse,
  isPlainObject,
  makeError,
  successResponse,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_METHOD_NOT_FOUND,
  type JsonRpcId
} from './json-rpc.js';
import type { McpToolDefinition } from './surface.js';
import { type ToolCallContext } from './tool-core.js';
import { handlerFor } from './tools.js';

/** Used when the client names no protocol version. */
export const DEFAULT_PROTOCOL_VERSION = '2025-06-18';

/** The server's own name, as it appears in `initialize`. */
export const SERVER_NAME = 'peaks';

export const METHOD_INITIALIZE = 'initialize';
export const METHOD_INITIALIZED = 'notifications/initialized';
export const METHOD_TOOLS_LIST = 'tools/list';
export const METHOD_TOOLS_CALL = 'tools/call';

export interface McpServerOptions {
  readonly tools: readonly McpToolDefinition[];
  readonly context?: ToolCallContext;
  readonly serverVersion?: string;
}

export interface McpServer {
  /** Answer one line. A notification (or blank line) yields `undefined`. */
  handleLine(line: string): Promise<string | undefined>;
  /** The tools, for a caller that wants to assert what it built. */
  readonly tools: readonly McpToolDefinition[];
}

/** The tool shape that goes on the wire — behaviour without the whitelist entries. */
function wireTool(tool: McpToolDefinition): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  };
}

function requestedVersion(params: unknown): string | undefined {
  if (!isPlainObject(params)) return undefined;
  const version = params['protocolVersion'];
  return typeof version === 'string' && version.length > 0 ? version : undefined;
}

function callArguments(params: Record<string, unknown>): Record<string, unknown> | undefined {
  const args = params['arguments'];
  if (args === undefined) return {};
  return isPlainObject(args) ? args : undefined;
}

/**
 * Reject an argument the tool does not declare, BEFORE anything runs. The tool
 * schemas set `additionalProperties: false`; enforcing it here is what makes
 * that a promise rather than a hint, and it is the boundary at which an
 * injection-shaped key ("--apply") stops being an argument.
 */
function unknownArgument(
  tool: McpToolDefinition,
  args: Record<string, unknown>
): string | undefined {
  const declared = new Set(Object.keys(tool.inputSchema.properties));
  return Object.keys(args).find((name) => !declared.has(name));
}

function initializeResult(params: unknown, version: string): Record<string, unknown> {
  return {
    protocolVersion: requestedVersion(params) ?? DEFAULT_PROTOCOL_VERSION,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, version }
  };
}

function fail(id: JsonRpcId, message: string): string {
  return encodeMessage(failureResponse(id, makeError(JSON_RPC_INVALID_PARAMS, message)));
}

async function toolsCallResult(
  tools: readonly McpToolDefinition[],
  context: ToolCallContext,
  id: JsonRpcId,
  params: unknown
): Promise<string | undefined> {
  if (!isPlainObject(params)) {
    return fail(id, 'tools/call requires an object of parameters.');
  }
  const name = params['name'];
  if (typeof name !== 'string' || name.length === 0) {
    return fail(id, 'tools/call requires a tool "name".');
  }
  const tool = tools.find((candidate) => candidate.name === name);
  const handler = tool === undefined ? undefined : handlerFor(tool.name);
  if (tool === undefined || handler === undefined) {
    return fail(id, `Unknown tool: ${name}`);
  }
  const args = callArguments(params);
  if (args === undefined) {
    return fail(id, 'tools/call "arguments" must be an object.');
  }
  const unexpected = unknownArgument(tool, args);
  if (unexpected !== undefined) {
    return fail(id, `Tool ${name} declares no argument "${unexpected}".`);
  }
  return encodeMessage(successResponse(id, await handler(tool, args, context)));
}

export function createMcpServer(options: McpServerOptions): McpServer {
  const tools = options.tools;
  const context = options.context ?? {};
  const version = options.serverVersion ?? CLI_VERSION;

  const respond = async (
    id: JsonRpcId,
    method: string,
    params: unknown
  ): Promise<string | undefined> => {
    switch (method) {
      case METHOD_INITIALIZE:
        return encodeMessage(successResponse(id, initializeResult(params, version)));
      case METHOD_TOOLS_LIST:
        return encodeMessage(successResponse(id, { tools: tools.map(wireTool) }));
      case METHOD_TOOLS_CALL:
        return toolsCallResult(tools, context, id, params);
      default:
        return encodeMessage(
          failureResponse(id, makeError(JSON_RPC_METHOD_NOT_FOUND, `Unknown method: ${method}`))
        );
    }
  };

  const handleLine = async (line: string): Promise<string | undefined> => {
    const decoded = decodeMessage(line);
    if (decoded === undefined) return undefined;
    if (decoded.kind === 'invalid') {
      return encodeMessage(failureResponse(decoded.id, decoded.error));
    }
    if (decoded.kind === 'notification') {
      // Notifications are answered by not answering. `initialized` needs no
      // branch of its own for that reason — but an unknown one is silently
      // dropped, which is the protocol's rule, not this server's leniency.
      return undefined;
    }
    try {
      return await respond(decoded.request.id, decoded.request.method, decoded.request.params);
    } catch (error) {
      // A handler crash is reported, never swallowed: the caller has to know the
      // answer is missing rather than empty.
      const message = error instanceof Error ? error.message : 'Internal error';
      return encodeMessage(
        failureResponse(decoded.request.id, makeError(JSON_RPC_INTERNAL_ERROR, message))
      );
    }
  };

  return { tools, handleLine };
}
