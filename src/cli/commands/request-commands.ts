import { Command, InvalidArgumentError } from 'commander';
import {
  allowedStatesForRole,
  createRequestArtifact,
  listRequestArtifacts,
  showRequestArtifact,
  transitionRequestArtifact,
  PrerequisitesNotSatisfiedError,
  LintGateError,
  TypeSanityViolationError,
  FileSizeViolationError,
  VALID_REQUEST_TYPES,
  isRequestType,
  type RequestArtifactRole,
  type RequestArtifactState,
  type RequestType
} from '../../services/artifacts/request-artifact-service.js';
import { ConfirmationRequiredError } from '../../services/mode/mode-enforcement.js';
import { recordBypass, isBypassLimitReached, MAX_BYPASSES_PER_SESSION } from '../../services/mode/bypass-tracker.js';
import { lintRequestArtifact } from '../../services/artifacts/artifact-lint-service.js';
import { getRepairCycleStatus } from '../../services/artifacts/repair-cycle-service.js';
import { fail, ok } from '../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type RequestInitOptions = {
  role: string;
  id: string;
  project: string;
  sessionId?: string;
  apply?: boolean;
  type?: RequestType;
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

type RequestTransitionOptions = {
  role: RequestArtifactRole;
  project: string;
  state: RequestArtifactState;
  sessionId?: string;
  reason?: string;
  allowIncomplete?: boolean;
  confirm?: boolean;
  forceConfirm?: boolean;
  json?: boolean;
};

const VALID_ROLES: ReadonlyArray<RequestArtifactRole> = ['prd', 'ui', 'rd', 'qa', 'sc'];

function parseRole(value: string): RequestArtifactRole {
  if (!VALID_ROLES.includes(value as RequestArtifactRole)) {
    throw new InvalidArgumentError(`must be one of ${VALID_ROLES.join(', ')}`);
  }
  return value as RequestArtifactRole;
}

function parseStateForRole(role: RequestArtifactRole, value: string): RequestArtifactState {
  const allowed = allowedStatesForRole(role);
  if (!(allowed as ReadonlyArray<string>).includes(value)) {
    throw new InvalidArgumentError(`must be one of ${allowed.join(', ')} for role ${role}`);
  }
  return value as RequestArtifactState;
}

function parseRequestType(value: string): RequestType {
  if (!isRequestType(value)) {
    throw new InvalidArgumentError(`must be one of ${VALID_REQUEST_TYPES.join(', ')}`);
  }
  return value;
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
      .option('--type <type>', `request type (${VALID_REQUEST_TYPES.join(' | ')}); default: feature`, parseRequestType)
  ).action(async (options: RequestInitOptions) => {
    try {
      const serviceOptions: Parameters<typeof createRequestArtifact>[0] = {
        role: options.role as RequestArtifactRole,
        requestId: options.id,
        projectRoot: options.project
      };
      if (options.sessionId !== undefined) {
        serviceOptions.sessionId = options.sessionId;
        // Back-compat: pre-1.3.0 the `--session-id <scope>` flag also
        // set the on-disk dir name. Preserve that by passing the same
        // value as the explicit change-id; the service still records
        // the session binding separately in the artifact body.
        serviceOptions.changeId = options.sessionId;
      }
      if (options.apply === true) {
        serviceOptions.apply = true;
      }
      if (options.type !== undefined) {
        serviceOptions.requestType = options.type;
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

  addJsonOption(
    request
      .command('transition')
      .description('Move a per-request artifact to a new state defined by its role state machine')
      .argument('<request-id>', 'request id, e.g. 2026-05-23-add-foo')
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--state <state>', 'new state name; allowed values depend on role')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
      .option('--reason <text>', 'reason appended as a transition note; required when --allow-incomplete is set')
      .option('--allow-incomplete', 'bypass artifact prerequisite checks; requires --reason and records the bypass in the artifact')
      .option('--confirm', 'skip interactive confirmation prompt (for non-interactive / LLM contexts)')
      .option('--force-confirm', 'bypass mode-enforced confirmation (use with caution)')
  ).action(async (requestId: string, options: RequestTransitionOptions) => {
    try {
      const role = options.role;
      const newState = parseStateForRole(role, options.state);
      // Resolve the artifact's real session up front. Falling back to a literal
      // 'default' (the previous behavior) points the bypass counter at a
      // non-existent .peaks/default/ dir and crashes with ENOENT, so when
      // --session-id is omitted we look the artifact up to find its session.
      let resolvedSessionId = options.sessionId;
      if (resolvedSessionId === undefined) {
        const { showRequestArtifact: showForSession } = await import('../../services/artifacts/request-artifact-service.js');
        const located = await showForSession({ projectRoot: options.project, role, requestId });
        if (located !== null) {
          resolvedSessionId = located.sessionId;
        }
      }
      if (options.allowIncomplete === true && (options.reason === undefined || options.reason.trim().length === 0)) {
        printResult(
          io,
          fail('request.transition', 'BYPASS_REASON_REQUIRED', '--allow-incomplete requires --reason explaining why prerequisites are skipped', { role, requestId }, ['Add --reason "<short justification>" or remove --allow-incomplete and produce the missing artifacts']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      // Restrict --allow-incomplete in assisted/strict modes: require --confirm
      if (options.allowIncomplete === true && options.forceConfirm !== true) {
        const { getSkillPresence } = await import('../../services/skills/skill-presence-service.js');
        const presence = getSkillPresence(options.project);
        if (presence?.mode === 'assisted' || presence?.mode === 'strict') {
          if (options.confirm !== true) {
            printResult(
              io,
              fail('request.transition', 'ALLOW_INCOMPLETE_RESTRICTED',
                `--allow-incomplete requires --confirm in ${presence.mode} mode`,
                { role, requestId, mode: presence.mode },
                ['Add --confirm to proceed non-interactively, or run in an interactive terminal.']),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          // Check bypass count
          const sessionRoot = (await import('node:path')).join(options.project, '.peaks', resolvedSessionId ?? 'default');
          if (isBypassLimitReached(sessionRoot)) {
            printResult(
              io,
              fail('request.transition', 'BYPASS_LIMIT_REACHED',
                `--allow-incomplete limit reached (${MAX_BYPASSES_PER_SESSION} per session)`,
                { role, requestId, limit: MAX_BYPASSES_PER_SESSION },
                ['Produce the missing artifacts instead of bypassing.']),
              options.json
            );
            process.exitCode = 1;
            return;
          }
          recordBypass(sessionRoot);
        }
      }
      const transitionOptions: Parameters<typeof transitionRequestArtifact>[0] = {
        role,
        requestId,
        projectRoot: options.project,
        newState
      };
      if (options.sessionId !== undefined) {
        transitionOptions.sessionId = options.sessionId;
      }
      if (options.reason !== undefined) {
        transitionOptions.reason = options.reason;
      }
      if (options.allowIncomplete === true) {
        transitionOptions.allowIncomplete = true;
      }
      if (options.confirm === true) {
        transitionOptions.confirmed = true;
      }
      if (options.forceConfirm === true) {
        transitionOptions.forceConfirm = true;
      }
      // Type sanity check for PRD handoff
      if (role === 'prd' && newState === 'handed-off') {
        const { showRequestArtifact: showForType } = await import('../../services/artifacts/request-artifact-service.js');
        const showTypeOptions: { projectRoot: string; role: 'prd'; requestId: string; sessionId?: string } = {
          projectRoot: options.project,
          role: 'prd',
          requestId
        };
        if (options.sessionId !== undefined) {
          showTypeOptions.sessionId = options.sessionId;
        }
        const existing = await showForType(showTypeOptions);
        if (existing !== null) {
          transitionOptions.typeSanityCheck = { projectRoot: options.project, declaredType: existing.requestType };
        }
      }
      const result = await transitionRequestArtifact(transitionOptions);
      if (result === null) {
        printResult(
          io,
          fail('request.transition', 'REQUEST_NOT_FOUND', `No artifact found for role=${role} requestId=${requestId}`, { role, requestId }, ['Verify the request id, role, and session id']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(io, ok('request.transition', result), options.json);
    } catch (error) {
      if (error instanceof InvalidArgumentError) {
        throw error;
      }
      if (error instanceof PrerequisitesNotSatisfiedError) {
        printResult(
          io,
          fail(
            'request.transition',
            error.code,
            error.message,
            { role: error.role, newState: error.newState, sessionId: error.sessionId, missing: error.missing },
            [
              ...error.missing.map((entry) => `Produce ${entry.path}: ${entry.description}`),
              'Once every required artifact exists, rerun this transition.',
              'For exceptional cases (docs-only / config-only change), bypass with: --allow-incomplete --reason "<justification>"'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof LintGateError) {
        printResult(
          io,
          fail(
            'request.transition',
            error.code,
            error.message,
            { role: error.role, newState: error.newState, errorCount: error.errorCount },
            [
              'Fix lint errors in the artifact before transitioning.',
              'Run `peaks request lint --role <role> --id <rid> --project <path>` to see details.',
              'Or bypass with: --allow-incomplete --reason "<justification>"'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof TypeSanityViolationError) {
        printResult(
          io,
          fail(
            'request.transition',
            error.code,
            error.message,
            { declaredType: error.declaredType, suggestedTypes: error.suggestedTypes, rationale: error.rationale },
            [
              `Re-classify the request — likely correct type: ${error.suggestedTypes.join(' | ')}`,
              'Or, if the declared type is correct, surface the mismatch reason to the user.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof FileSizeViolationError) {
        printResult(
          io,
          fail(
            'request.transition',
            error.code,
            error.message,
            { violations: error.violations, threshold: error.threshold },
            [
              ...error.violations.map((v) => `Split ${v.file} (${v.lines} lines) into smaller modules (< ${error.threshold} lines)`),
              'Or bypass with: --allow-incomplete --reason "<justification>"'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      if (error instanceof ConfirmationRequiredError) {
        printResult(
          io,
          fail(
            'request.transition',
            'CONFIRMATION_REQUIRED',
            error.message,
            { role: options.role, requestId },
            [
              'Add --confirm to proceed non-interactively.',
              'Or run in an interactive terminal.',
              'In assisted/strict mode, major workflow boundaries require explicit user approval.'
            ]
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      printResult(
        io,
        fail('request.transition', 'REQUEST_TRANSITION_FAILED', getErrorMessage(error), { role: options.role, requestId }, ['Check role, request id, state, and project path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    request
      .command('lint')
      .description('Scan a request artifact body for unfilled placeholders (<...>, TBD, bare bullets) before declaring it complete')
      .argument('<request-id>', 'request id')
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
  ).action(async (requestId: string, options: { role: RequestArtifactRole; project: string; sessionId?: string; json?: boolean }) => {
    try {
      const lintOptions: Parameters<typeof lintRequestArtifact>[0] = {
        projectRoot: options.project,
        role: options.role,
        requestId
      };
      if (options.sessionId !== undefined) {
        lintOptions.sessionId = options.sessionId;
      }
      const report = await lintRequestArtifact(lintOptions);
      if (report === null) {
        printResult(
          io,
          fail('request.lint', 'REQUEST_NOT_FOUND', `No artifact found for role=${options.role} requestId=${requestId}`, { role: options.role, requestId }, ['Verify the request id, role, and session id']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const nextActions: string[] = [];
      if (!report.ok) {
        nextActions.push(`Fix ${report.findings.filter((f) => f.severity === 'error').length} error finding(s) before transitioning this artifact.`);
      }
      printResult(io, ok('request.lint', report, [], nextActions), options.json);
      if (!report.ok) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('request.lint', 'REQUEST_LINT_FAILED', getErrorMessage(error), { role: options.role, requestId }, ['Verify the artifact path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  addJsonOption(
    request
      .command('repair-status')
      .description('Count RD↔QA repair cycles for a request from its RD artifact transition notes; reports cycle count and whether the 3-cycle cap is reached')
      .argument('<request-id>', 'request id')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
      .option('--max-cycles <n>', 'override the default max cycle cap (default 3)')
  ).action(async (requestId: string, options: { project: string; sessionId?: string; maxCycles?: string; json?: boolean }) => {
    try {
      const max = options.maxCycles !== undefined && /^\d+$/.test(options.maxCycles) ? Number(options.maxCycles) : 3;
      const statusOptions: Parameters<typeof getRepairCycleStatus>[0] = {
        projectRoot: options.project,
        requestId,
        maxCycles: max
      };
      if (options.sessionId !== undefined) {
        statusOptions.sessionId = options.sessionId;
      }
      const report = await getRepairCycleStatus(statusOptions);
      if (report === null) {
        printResult(
          io,
          fail('request.repair-status', 'REQUEST_NOT_FOUND', `No RD artifact found for requestId=${requestId}`, { requestId }, ['Verify the request id and session id']),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const nextActions: string[] = [];
      if (report.atCap) {
        nextActions.push(`Repair cap reached (${report.cycleCount}/${report.maxCycles}). Emit a blocked TXT handoff and stop the loop.`);
      } else if (report.cycleCount > 0) {
        nextActions.push(`${report.remaining} repair cycle(s) remaining before block.`);
      }
      printResult(io, ok('request.repair-status', report, [], nextActions), options.json);
      if (report.atCap) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail('request.repair-status', 'REQUEST_REPAIR_STATUS_FAILED', getErrorMessage(error), { requestId }, ['Verify the artifact path before retrying']),
        options.json
      );
      process.exitCode = 1;
    }
  });
}
