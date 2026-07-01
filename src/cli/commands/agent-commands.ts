/**
 * peaks agent * CLI surface — Slice: ECC 64 agents soft-optional
 * integration (per spec §7.2 line 818).
 *
 * Registers the new `peaks agent` top-level command with two
 * subcommands:
 *   - `peaks agent run <name> [--target <path>]`  — shell out to
 *     `npx ecc agent run <name> --target <path> --json` when ECC
 *     is installed; soft-fail with the 4-option install prompt
 *     when it isn't.
 *   - `peaks agent list`                          — emit the 12
 *     canonical ECC agents (the wrapper hardcodes the
 *     most-used subset; the full 64-agent list is
 *     discoverable at runtime via `npx ecc agent list`).
 *
 * The wrapper service is `src/services/agent/ecc-agent-service.ts`.
 */
import { Command } from 'commander';
import {
  runEccAgent,
  validateEccAgent,
  CANONICAL_ECC_AGENTS,
  type SubprocessRunner,
} from '../../services/agent/ecc-agent-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from '../../shared/result.js';

type AgentRunOptions = {
  target?: string;
  json?: boolean;
  enable?: boolean;
};

type AgentListOptions = {
  json?: boolean;
};

export function registerAgentCommands(program: Command, io: ProgramIO): void {
  const agent = program
    .command('agent')
    .description(
      'Run an ECC agent (soft-optional per spec §7.2). 64 agents are npm-installable via npx ecc; peaks-loop shells out when ECC is installed and soft-fails with a 4-option install prompt when it is not. Native peaks-loop diagnostics still run via `peaks doctor scan`.'
    );

  addJsonOption(
    agent
      .command('run <name>')
      .description(
        `Run an ECC agent by name (e.g. 'security-reviewer', 'code-reviewer'). The canonical subprocess is \`npx ecc agent run <name> --target <path> --json\`.`
      )
      .option('--target <path>', 'project root or file to analyze (default: cwd)')
      .option('--enable', 'enable the ECC subprocess for this call (overrides default-off; soft-fails with the 4-option install prompt when ECC is missing)')
  ).action(async (name: string, options: AgentRunOptions) => {
    const validationError = validateEccAgent(name);
    if (validationError !== null) {
      printResult(
        io,
        fail('agent.run', 'INVALID_AGENT_NAME', validationError, { agent: name }, [
          'Use `peaks agent list` to see the canonical 12 agents',
        ]),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const projectRoot = options.target ?? process.cwd();
    try {
      const result = runEccAgent({
        agent: name,
        projectRoot,
        enableAgent: options.enable === true,
      });
      const data = { ...result, projectRoot };
      const nextActions: string[] = [];
      if (result.reason === 'flag-enabled-but-ecc-missing') {
        nextActions.push(
          'ECC not installed. Pick one of the four options below:',
          '  a) Install: run `npx ecc --help` to install, then re-run `peaks agent run`.',
          '  b) Skip this run: use the peaks-loop native diagnostic via `peaks doctor scan`.',
          '  c) Skip forever: run `peaks preferences set agentShieldEnabled false`.',
          '  d) Learn more: see docs/superpowers/specs/2026-06-11-peaks-loop-l1-l2-l3-redesign.md §7.2.'
        );
      }
      const envelope: ResultEnvelope<typeof data> = ok('agent.run', data, [...result.warnings], nextActions);
      printResult(io, envelope, options.json);
    } catch (error) {
      const message = getErrorMessage(error);
      printResult(
        io,
        fail('agent.run', 'AGENT_RUN_FAILED', message, { agent: name, projectRoot, spawned: false }, [message]),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    agent
      .command('list')
      .description(`List the 12 canonical ECC agents (peaks-loop ships a static subset; the full 64 are ECC-discovered).`)
  ).action((options: AgentListOptions) => {
    const envelope = ok(
      'agent.list',
      { agents: CANONICAL_ECC_AGENTS.map((a: { name: string; description: string }) => ({ name: a.name, description: a.description })) },
      [],
      ['Run any agent with: `peaks agent run <name> --target <path>`']
    );
    printResult(io, envelope, options.json);
  });
}
