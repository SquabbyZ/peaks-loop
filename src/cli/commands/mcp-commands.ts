import { Command } from 'commander';
import { scanMcpServers } from '../../services/mcp/mcp-scan-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type McpListOptions = {
  project?: string;
  json?: boolean;
};

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
}
