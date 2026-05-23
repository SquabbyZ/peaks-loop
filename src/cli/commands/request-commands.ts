import { Command, InvalidArgumentError } from 'commander';
import {
  createRequestArtifact,
  listRequestArtifacts,
  showRequestArtifact,
  type RequestArtifactRole
} from '../../services/artifacts/request-artifact-service.js';
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

type RequestListOptions = {
  project: string;
  sessionId?: string;
  role?: RequestArtifactRole;
  json?: boolean;
};

type RequestShowOptions = {
  role: RequestArtifactRole;
  project: string;
  sessionId?: string;
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

  addJsonOption(
    request
      .command('list')
      .description('List per-request artifacts under a project workspace')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'limit to a specific session id')
      .option('--role <role>', `limit to a single role (${VALID_ROLES.join(' | ')})`, parseRole)
  ).action(async (options: RequestListOptions) => {
    try {
      const listOptions: Parameters<typeof listRequestArtifacts>[0] = { projectRoot: options.project };
      if (options.sessionId !== undefined) {
        listOptions.sessionId = options.sessionId;
      }
      if (options.role !== undefined) {
        listOptions.role = options.role;
      }
      const items = await listRequestArtifacts(listOptions);
      printResult(io, ok('request.list', { count: items.length, items }), options.json);
    } catch (error) {
      printResult(
        io,
        fail('request.list', 'REQUEST_LIST_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Check project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    request
      .command('show')
      .description('Show a single per-request artifact, optionally scoped to a session')
      .argument('<request-id>', 'request id, e.g. 2026-05-23-add-foo')
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
  ).action(async (requestId: string, options: RequestShowOptions) => {
    try {
      const showOptions: Parameters<typeof showRequestArtifact>[0] = {
        projectRoot: options.project,
        role: options.role,
        requestId
      };
      if (options.sessionId !== undefined) {
        showOptions.sessionId = options.sessionId;
      }
      const result = await showRequestArtifact(showOptions);
      if (result === null) {
        printResult(
          io,
          fail('request.show', 'REQUEST_NOT_FOUND', `No artifact found for role=${options.role} requestId=${requestId}`, { role: options.role, requestId }, ['Verify the request id, role, and session id']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('request.show', result), options.json);
    } catch (error) {
      printResult(
        io,
        fail('request.show', 'REQUEST_SHOW_FAILED', getErrorMessage(error), { role: options.role, requestId }, ['Check role, request id, and project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
