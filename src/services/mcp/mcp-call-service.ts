import { findMcpInstallSpec, type McpInstallSpec } from './mcp-install-registry.js';
import { createMcpClient, type McpClientTransport } from './mcp-client-service.js';

export type McpCallTransportFactory = (
  spec: McpInstallSpec,
  env: Record<string, string | undefined>
) => McpClientTransport;

export type McpCallOptions = {
  capabilityId: string;
  toolName: string;
  transportFactory: McpCallTransportFactory;
  args?: Record<string, unknown>;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
};

export type McpCallResult = {
  capabilityId: string;
  toolName: string;
  result: unknown;
};

function checkRequiredEnv(spec: McpInstallSpec, env: Record<string, string | undefined>): string[] {
  return spec.envKeys.filter((key) => {
    const value = env[key];
    return value === undefined || value.length === 0;
  });
}

export async function callMcpTool(options: McpCallOptions): Promise<McpCallResult> {
  const spec = findMcpInstallSpec(options.capabilityId);
  if (spec === null) {
    throw new Error(`No MCP install spec registered for capability ${options.capabilityId}`);
  }

  const env = options.env ?? (process.env as Record<string, string | undefined>);
  const missing = checkRequiredEnv(spec, env);
  if (missing.length > 0) {
    throw new Error(`Refusing to call ${spec.name}: missing required env vars: ${missing.join(', ')}`);
  }

  const transport = options.transportFactory(spec, env);
  const clientOptions = options.timeoutMs !== undefined
    ? { transport, timeoutMs: options.timeoutMs }
    : { transport };
  const client = createMcpClient(clientOptions);

  try {
    const result = await client.request('tools/call', {
      name: options.toolName,
      arguments: options.args ?? {}
    });
    return { capabilityId: options.capabilityId, toolName: options.toolName, result };
  } finally {
    await client.close();
  }
}
