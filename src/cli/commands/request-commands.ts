import { Command, InvalidArgumentError } from 'commander';
import { createRequestArtifact, type RequestArtifactRole } from '../../services/artifacts/request-artifact-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type RequestInitOptions = {
  role: string;
  id: string;
  project: string;
  sessionId?: string;
  apply?: boolean;
  json?: boolean;
};

const VALID_ROLES: ReadonlyArray<RequestArtifactRole> = ['prd', 'ui', 'rd', 'qa'];

function parseRole(value: string): RequestArtifactRole {
  if (!VALID_ROLES.includes(value as RequestArtifactRole)) {
    throw new InvalidArgumentError(`must be one of ${VALID_ROLES.join(', ')}`);
  }
  return value as RequestArtifactRole;
}

export function registerRequestCommands(program: Command, io: ProgramIO): void {
  const request = program.command('request').description('Manage per-request Peaks role artifacts (PRD / UI / RD / QA)');

  addJsonOption(
    request
      .command('init')
      .description('Create the per-request artifact template for a Peaks role (dry-run by default)')
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--id <request-id>', 'request id, e.g. 2026-05-23-add-foo')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'override the default date-stamped session id')
      .option('--apply', 'write the artifact file (default: preview only)')
  ).action(async (options: RequestInitOptions) => {
    try {
      const serviceOptions: Parameters<typeof createRequestArtifact>[0] = {
        role: options.role as RequestArtifactRole,
        requestId: options.id,
        projectRoot: options.project
      };
      if (options.sessionId !== undefined) {
        serviceOptions.sessionId = options.sessionId;
      }
      if (options.apply === true) {
        serviceOptions.apply = true;
      }
      const result = await createRequestArtifact(serviceOptions);
      printResult(
        io,
        ok(
          'request.init',
          result,
          [],
          result.applied ? [] : [`Re-run with --apply to write ${result.path}`]
        ),
        options.json
      );
    } catch (error) {
      printResult(
        io,
        fail('request.init', 'REQUEST_INIT_FAILED', getErrorMessage(error), { role: options.role, requestId: options.id }, ['Check role, request id, and project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
