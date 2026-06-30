import { Command } from 'commander';
import { getMiniMaxProviderConfig } from '../../services/config/config-service.js';
import { runMiniMaxWorker } from '../../services/providers/minimax-worker-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, redactSensitiveErrorMessage, summarizeMiniMaxWorkerResult, type ProgramIO } from '../cli-helpers.js';

interface MiniMaxWorkerOptions {
  sessionId: string;
  goal: string;
  codingTask: string;
  unitTestTask: string;
  model: string;
  confirm?: boolean;
  json?: boolean;
}

function addMiniMaxWorkerOptions(command: Command): Command {
  return addJsonOption(
    command
      .description('Run a single MiniMax coding and unit-test execution worker')
      .requiredOption('--session-id <id>', 'session identifier (the single-axis workspace binding after the change-id root removal)')
      .requiredOption('--goal <goal>', 'execution goal')
      .requiredOption('--coding-task <task>', 'coding execution task')
      .requiredOption('--unit-test-task <task>', 'unit-test execution task')
      .option('--model <model>', 'model name for the worker', 'MiniMax-M2.7')
      .option('--confirm', 'confirm that worker inputs may be sent to the external MiniMax provider once and only return a review handoff', false)
  );
}

async function runMiniMaxWorkerCommand(io: ProgramIO, options: MiniMaxWorkerOptions): Promise<void> {
  if (!options.confirm) {
    printResult(io, fail('worker.minimax', 'CONFIRMATION_REQUIRED', 'This worker only runs with explicit confirmation because inputs may be sent to the external MiniMax provider', {}, ['Rerun with --confirm after removing secrets from worker inputs']), options.json);
    process.exitCode = 1;
    return;
  }

  const sessionId = options.sessionId.trim();
  const goal = options.goal.trim();
  const codingTask = options.codingTask.trim();
  const unitTestTask = options.unitTestTask.trim();
  if (!sessionId || !goal || !codingTask || !unitTestTask) {
    printResult(io, fail('worker.minimax', 'INVALID_WORKER_INPUT', 'Worker inputs must be non-empty', {}, ['Provide non-empty values for --session-id, --goal, --coding-task, and --unit-test-task']), options.json);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await runMiniMaxWorker(getMiniMaxProviderConfig(), { sessionId, goal, codingTask, unitTestTask, model: options.model });
    const safeResult = summarizeMiniMaxWorkerResult(result);
    if (!result.provider.configured) {
      printResult(io, fail('worker.minimax', 'MINIMAX_PROVIDER_NOT_CONFIGURED', 'MiniMax provider requires baseUrl and apiKey in user config', safeResult, ['Run peaks config provider minimax set --base-url <url> and either MINIMAX_API_KEY']), options.json);
      process.exitCode = 1;
      return;
    }

    printResult(io, result.provider.ok ? ok('worker.minimax', safeResult) : fail('worker.minimax', 'MINIMAX_WORKER_FAILED', 'MiniMax worker execution failed', safeResult, ['Check the MiniMax base URL, API key, and worker tasks']), options.json);
    if (!result.provider.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    printResult(io, fail('worker.minimax', 'MINIMAX_WORKER_FAILED', redactSensitiveErrorMessage(getErrorMessage(error)), {}, ['Check the MiniMax base URL, API key, and worker tasks']), options.json);
    process.exitCode = 1;
  }
}

export function registerWorkerCommands(program: Command, io: ProgramIO): void {
  const worker = program.command('worker').description('Run controlled execution workers');
  addMiniMaxWorkerOptions(worker.command('minimax')).action(async (options: MiniMaxWorkerOptions) => runMiniMaxWorkerCommand(io, options));
  addMiniMaxWorkerOptions(program.command('minimax-worker')).action(async (options: MiniMaxWorkerOptions) => runMiniMaxWorkerCommand(io, options));
}
