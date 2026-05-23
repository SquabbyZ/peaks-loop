import { Command, InvalidArgumentError } from 'commander';
import { readFile } from 'node:fs/promises';
import { scanMcpServers } from '../../services/mcp/mcp-scan-service.js';
import { planMcpInstall, type PlanMcpInstallOptions } from '../../services/mcp/mcp-plan-service.js';
import { applyMcpInstall, rollbackMcpInstall, type McpApplyOptions } from '../../services/mcp/mcp-apply-service.js';
import { callMcpTool, type McpCallTransportFactory } from '../../services/mcp/mcp-call-service.js';
import { createStdioTransportFromSpec } from '../../services/mcp/mcp-stdio-transport.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, failUnsupportedNonDryRun, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type McpListOptions = {
  project?: string;
  json?: boolean;
};

type McpPlanOptions = McpListOptions & {
  capability: string;
  dryRun?: boolean;
};

type McpApplyCommandOptions = McpListOptions & {
  capability: string;
  yes?: boolean;
  claim?: boolean;
};

type McpRollbackCommandOptions = {
  backup: string;
  json?: boolean;
};

type McpCallCommandOptions = {
  capability: string;
  tool: string;
  args?: string;
  argsJson?: string;
  timeout?: number;
  json?: boolean;
};

function parsePositiveInteger(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError('must be a positive integer');
  }
  return parsed;
}

async function resolveCallArgs(options: McpCallCommandOptions): Promise<Record<string, unknown>> {
  if (options.argsJson !== undefined && options.args !== undefined) {
    throw new Error('Pass either --args-json or --args, not both');
  }
  const raw = options.argsJson !== undefined
    ? options.argsJson
    : options.args !== undefined ? await readFile(options.args, 'utf8') : '{}';
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('MCP tool arguments must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

export function registerMcpCommands(program: Command, io: ProgramIO): void {
  const mcp = program.command('mcp').description('Manage Claude Code MCP servers');

  addJsonOption(
    mcp
      .command('list')
      .alias('scan')
      .description('Scan Claude Code settings for configured MCP servers')
      .option('--project <path>', 'project root to also scan project-level .claude/settings.json')
  ).action(async (options: McpListOptions) => {
    try {
      const report = await scanMcpServers(options.project !== undefined ? { projectRoot: options.project } : {});
      printResult(io, ok('mcp.list', report), options.json);
    } catch (error) {
      printResult(
        io,
        fail('mcp.list', 'MCP_LIST_FAILED', getErrorMessage(error), {}, ['Check Claude settings path and permissions before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    mcp
      .command('plan')
      .description('Plan an MCP server install diff for a capability (dry-run only)')
      .requiredOption('--capability <id>', 'capability id from the MCP install registry')
      .option('--project <path>', 'project root for scoped scan')
      .option('--dry-run', 'preview the install diff (always true)', true)
      .option('--no-dry-run', 'unsupported: peaks mcp plan never writes settings')
  ).action(async (options: McpPlanOptions) => {
    if (options.dryRun === false) {
      failUnsupportedNonDryRun(io, 'mcp.plan', options.json);
      return;
    }

    try {
      const planOptions: PlanMcpInstallOptions = options.project !== undefined ? { projectRoot: options.project } : {};
      const plan = await planMcpInstall(options.capability, planOptions);
      if (plan.action === 'unknown-capability') {
        printResult(
          io,
          fail('mcp.plan', 'MCP_UNKNOWN_CAPABILITY', `No MCP install spec registered for capability ${options.capability}`, plan, plan.nextActions),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('mcp.plan', plan, [], plan.nextActions), options.json);
    } catch (error) {
      printResult(
        io,
        fail('mcp.plan', 'MCP_PLAN_FAILED', getErrorMessage(error), { capabilityId: options.capability }, ['Check Claude settings path and the capability id before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    mcp
      .command('apply')
      .description('Apply an MCP server install for a capability (writes .claude/settings.json with backup)')
      .requiredOption('--capability <id>', 'capability id from the MCP install registry')
      .option('--yes', 'confirm the write — required for any real side effect')
      .option('--claim', 'take ownership of an existing non-peaks-managed server entry')
      .option('--project <path>', 'project root for scoped scan')
  ).action(async (options: McpApplyCommandOptions) => {
    if (options.yes !== true) {
      printResult(io, fail('mcp.apply', 'MCP_APPLY_REQUIRES_YES', 'Refusing to apply without --yes', { capabilityId: options.capability }, ['Re-run with --yes to confirm the write']), options.json);
      process.exitCode = 1;
      return;
    }
    try {
      const applyOptions: McpApplyOptions = {};
      if (options.project !== undefined) {
        applyOptions.projectRoot = options.project;
      }
      if (options.claim === true) {
        applyOptions.claim = true;
      }
      const result = await applyMcpInstall(options.capability, applyOptions);
      printResult(io, ok('mcp.apply', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('mcp.apply', 'MCP_APPLY_FAILED', getErrorMessage(error), { capabilityId: options.capability }, ['Check the plan first with peaks mcp plan, then re-run apply']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    mcp
      .command('rollback')
      .description('Restore Claude Code settings.json from a peaks-managed MCP backup file')
      .requiredOption('--backup <path>', 'path to a previously created backup settings.json')
  ).action(async (options: McpRollbackCommandOptions) => {
    try {
      const result = await rollbackMcpInstall({ backupPath: options.backup });
      printResult(io, ok('mcp.rollback', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('mcp.rollback', 'MCP_ROLLBACK_FAILED', getErrorMessage(error), { backupPath: options.backup }, ['Verify the backup path and rerun']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    mcp
      .command('call')
      .description('Invoke a tool on an installed MCP server via stdio (spawns the server, calls tools/call, closes)')
      .requiredOption('--capability <id>', 'capability id from the MCP install registry')
      .requiredOption('--tool <name>', 'MCP tool name to invoke')
      .option('--args <path>', 'path to a JSON file describing the tool arguments object')
      .option('--args-json <jsonString>', 'inline JSON object describing the tool arguments')
      .option('--timeout <ms>', 'per-request timeout in milliseconds', parsePositiveInteger)
  ).action(async (options: McpCallCommandOptions) => {
    try {
      const args = await resolveCallArgs(options);
      const factory: McpCallTransportFactory = createStdioTransportFromSpec;
      const callOptions: Parameters<typeof callMcpTool>[0] = {
        capabilityId: options.capability,
        toolName: options.tool,
        args,
        transportFactory: factory
      };
      if (options.timeout !== undefined) {
        callOptions.timeoutMs = Number(options.timeout);
      }
      const result = await callMcpTool(callOptions);
      printResult(io, ok('mcp.call', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('mcp.call', 'MCP_CALL_FAILED', getErrorMessage(error), { capabilityId: options.capability, toolName: options.tool }, ['Check the capability id, tool name, args JSON, and required env vars before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
