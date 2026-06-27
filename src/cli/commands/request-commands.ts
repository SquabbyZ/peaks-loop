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
import { formatMdCompact } from '../../shared/format-md-compact.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type RequestInitOptions = {
  role: string;
  id: string;
  project: string;
  sessionId?: string;
  apply?: boolean;
  type?: RequestType;
  // Slice 020 — caller-keyed session binding. D4 priority: this flag
  // beats PEAKS_CALLER_ID env which beats PLATFORM_FALLBACKS.
  callerId?: string;
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
  /** When true, force all artifacts to render pretty. Slice 023 (R3). */
  pretty?: boolean;
  /** When true, force all artifacts to render compact. Slice 023 (R3). */
  compact?: boolean;
};

/**
 * Per-artifact default format. Only PRD and tech-doc are user-review
 * surfaces; all other RD/QA/TXT artifacts default to compact. The
 * `--pretty` / `--compact` flags override uniformly. See tech-doc
 * §1.3.
 */
const DEFAULT_FORMAT_BY_ARTIFACT: Record<string, 'compact' | 'pretty'> = {
  prd: 'pretty',
  'tech-doc': 'pretty',
  'code-review': 'compact',
  'security-review': 'compact',
  'perf-baseline': 'compact',
  'bug-analysis': 'compact',
  'test-cases': 'compact',
  'test-reports': 'compact',
  'security-findings': 'compact',
  'performance-findings': 'compact',
  handoff: 'compact'
};

function resolveDefaultFormat(artifactName: string): 'compact' | 'pretty' {
  return DEFAULT_FORMAT_BY_ARTIFACT[artifactName] ?? 'compact';
}

function applyPerArtifactFormat(
  envelope: unknown,
  override: 'pretty' | 'compact' | null
): unknown {
  if (override === null || envelope === null || typeof envelope !== 'object') return envelope;
  // The service returns `{ id, sessionId, role, body, ... }` for a
  // single-artifact show. The per-artifact `body` field is the only
  // thing that changes; we attach a `format` field to surface the
  // choice to the caller. Slice 023 (R3) AC6 / AC7.
  const obj = envelope as Record<string, unknown>;
  if (typeof obj.body === 'string') {
    return {
      ...obj,
      body: override === 'compact' ? formatMdCompact(obj.body) : obj.body,
      format: override
    };
  }
  return envelope;
}

/**
 * Map a request-artifact envelope to a `DEFAULT_FORMAT_BY_ARTIFACT` key.
 * The service returns the path of the artifact in `path`; the role +
 * filename stem gives us the artifact name. Falls back to the role
 * itself when no `path` field is present.
 */
function inferArtifactName(envelope: unknown, role: string): string {
  if (envelope === null || typeof envelope !== 'object') return role;
  const obj = envelope as Record<string, unknown>;
  const pathField = typeof obj.path === 'string' ? obj.path : '';
  // Path looks like `.peaks/_runtime/<sid>/<role>/requests/<file>.md`.
  // The role is the second-to-last directory; the file stem is the
  // last segment. For RD role, the artifact is one of {code-review,
  // security-review, perf-baseline, bug-analysis, tech-doc}; the file
  // stem usually carries the artifact name (e.g. `tech-doc.md`,
  // `code-review-002.md`). We strip the trailing `-<digits>` suffix
  // when present.
  const stem = pathField.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? '';
  if (stem.length > 0) {
    // Try the stem verbatim first.
    if (DEFAULT_FORMAT_BY_ARTIFACT[stem] !== undefined) return stem;
    // Strip a trailing -<digits> (e.g. code-review-002 -> code-review).
    const trimmed = stem.replace(/-\d+$/, '');
    if (DEFAULT_FORMAT_BY_ARTIFACT[trimmed] !== undefined) return trimmed;
    // Last-ditch: match by prefix.
    for (const key of Object.keys(DEFAULT_FORMAT_BY_ARTIFACT)) {
      if (stem.startsWith(key)) return key;
    }
  }
  return role;
}

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
      .requiredOption('--id <request-id>', 'request id, e.g. 2026-05-23-add-foo. With --apply, also pre-creates the canonical change-id scope dir at .peaks/_runtime/change/<id>/ so sub-agents never write .peaks/_runtime/<id>/ at top level.')
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'override the default date-stamped session id')
      .option('--apply', 'write the artifact file (default: preview only)')
      .option('--type <type>', `request type (${VALID_REQUEST_TYPES.join(' | ')}); default: feature`, parseRequestType)
      // Slice 020 — caller-keyed session binding. Per-invocation override
      // (D4 priority level 1). When set, the resolved callerId is surfaced
      // in the JSON envelope; the on-disk artifact records it in the
      // artifact body so future reads know which caller produced it.
      .option('--caller-id <id>', 'Override the caller id for this invocation (D4 priority: flag beats env beats platform fallback). The resolved callerId is stamped on the artifact body and surfaced in the response envelope.')
  ).action(async (options: RequestInitOptions) => {
    try {
      // One-axis layout: --session-id is REQUIRED. The on-disk root
      // is always `.peaks/_runtime/<sessionId>/<role>/...`. The user
      // has forbidden the `.peaks/_runtime/<id>/` root layout — without an
      // explicit session id, we cannot guarantee the artifact lands
      // under `_runtime/`. See
      // `.peaks/memory/2026-06-21-peaks-request-session-id-leaks-into-change-id.md`.
      if (options.sessionId === undefined || options.sessionId.trim().length === 0) {
        printResult(
          io,
          fail(
            'request.init',
            'SESSION_ID_REQUIRED',
            '--session-id is required: the CLI writes envelopes only to .peaks/_runtime/<sessionId>/... (one-axis layout)',
            { role: options.role, requestId: options.id },
            ['Re-run with --session-id <sid>', 'Or run `peaks workspace init` to create a session first']
          ),
          options.json
        );
        process.exitCode = 1;
        return;
      }
      const serviceOptions: Parameters<typeof createRequestArtifact>[0] = {
        role: options.role as RequestArtifactRole,
        requestId: options.id,
        projectRoot: options.project
      };
      serviceOptions.sessionId = options.sessionId;
      if (options.apply === true) {
        serviceOptions.apply = true;
      }
      if (options.type !== undefined) {
        serviceOptions.requestType = options.type;
      }
      // Slice 020.1 — resolve the callerId via D4 priority (flag > env >
      // platform fallback > reject). The CLI integration layer is the
      // single entry point for the resolver; we do not pre-judge whether
      // the caller passed a flag. D2 (no callerId available) and D5
      // (regex fail) both surface as `CALLER_ID_INVALID` with the inner
      // `CallerIdError.source` propagated for caller-side audit.
      const { resolveCallerId, CallerIdError } = await import('../../services/session/resolve-caller-id.js');
      try {
        const callerId = resolveCallerId(
          options.callerId !== undefined ? { flagValue: options.callerId } : {}
        );
        serviceOptions.callerId = callerId;
      } catch (error: unknown) {
        if (error instanceof CallerIdError) {
          // D2 (EX_USAGE, exit 64) = nothing usable; D5 (EX_DATAERR, exit 65)
          // = something was passed but did not match the D1 regex.
          const code = error.code === 'EX_USAGE' ? 64 : 65;
          printResult(
            io,
            fail(
              'request.init',
              'CALLER_ID_INVALID',
              error.message,
              { source: error.source },
              [
                'Set --caller-id to a value matching ^[a-zA-Z0-9._-]{1,200}$',
                'Or set PEAKS_CALLER_ID env var (or CLAUDE_CODE_SESSION_ID for Claude Code)'
              ]
            ),
            options.json
          );
          process.exitCode = code;
          return;
        }
        throw error;
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
      .description('Show a single per-request artifact, optionally scoped to a session. R3: default body format is per-artifact (PRD/tech-doc pretty; everything else compact); pass --pretty or --compact to override uniformly.')
      .argument('<request-id>', 'request id, e.g. 2026-05-23-add-foo')
      .requiredOption('--role <role>', `target role (${VALID_ROLES.join(' | ')})`, parseRole)
      .requiredOption('--project <path>', 'target project root')
      .option('--session-id <session>', 'restrict to a specific session id')
      .option('--pretty', 'force the body to render pretty (overrides the per-artifact default)')
      .option('--compact', 'force the body to render compact (overrides the per-artifact default)')
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
      // R3: pick the per-artifact default format and apply the override
      // if either flag is set. Last-flag-wins if both are passed.
      const override: 'pretty' | 'compact' | null = options.compact === true
        ? 'compact'
        : options.pretty === true
          ? 'pretty'
          : null;
      const artifactName = inferArtifactName(result, options.role);
      const format: 'pretty' | 'compact' = override ?? resolveDefaultFormat(artifactName);
      const transformed = applyPerArtifactFormat(result, override ?? format);
      const payload = transformed === result
        ? { ...(result as Record<string, unknown>), format }
        : transformed;
      printResult(io, ok('request.show', payload), options.json);
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
          // 2.7.1 fix: bypass-count must live under the canonical session
          // home `.peaks/_runtime/<sid>/`, NOT `.peaks/_runtime/<sid>/`. The legacy
          // path landed `.bypass-count.json` at the project root and was
          // ignored only by `.gitignore`, not by the runtime — a
          // back-compat reader on the root would never see it. The
          // canonical home is the same one `peaks session info --active`
          // resolves from `_runtime/session.json`, so all session-scoped
          // state (artifacts + bypass counter) now lives in one tree.
          const sessionRoot = (await import('node:path')).join(options.project, '.peaks', '_runtime', resolvedSessionId ?? 'default');
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
      // v2.13.2 AC-4 — auto-regen prd/handoff.md on prd:handed-off success.
      // Only fires when the handoff is missing; existing handoffs are not overwritten.
      if (role === 'prd' && newState === 'handed-off' && options.sessionId !== undefined) {
        const { autoRegenPrdHandoff } = await import('../../services/prd/handoff-auto-regen.js');
        const regen = await autoRegenPrdHandoff({
          projectRoot: options.project,
          sessionId: options.sessionId,
          requestId,
          changeId: result.changeId,
          role: 'prd'
        });
        if (regen.status === 'created') {
          // Stitch into the result envelope
          printResult(
            io,
            ok('request.transition', { ...result, handoffAutoRegen: { status: 'created', path: regen.path, sha256: regen.sha256 } }),
            options.json
          );
          return;
        }
        if (regen.status === 'skipped-exists') {
          printResult(io, ok('request.transition', { ...result, handoffAutoRegen: { status: 'skipped-exists', path: regen.path } }), options.json);
          return;
        }
        // status === 'failed' — surface a warning but don't block the transition
        printResult(io, ok('request.transition', { ...result, handoffAutoRegen: { status: 'failed', reason: regen.reason } }, [`prd handoff auto-regen failed: ${regen.reason}`]), options.json);
        return;
      }
      printResult(io, ok('request.transition', result), options.json);
    } catch (error) {
      if (error instanceof InvalidArgumentError) {
        throw error;
      }
      if (error instanceof PrerequisitesNotSatisfiedError) {
        // v2.13.3 AC-3 — surface `warnings` (soft-block entries from
        // the 1-minor-release back-compat window, e.g. MUT_REPORT) so
        // the operator sees both the hard-blocked `missing` paths and
        // the soft-blocked ones. `warnings` is always present (possibly
        // empty) to keep the response shape stable.
        printResult(
          io,
          fail(
            'request.transition',
            error.code,
            error.message,
            {
              role: error.role,
              newState: error.newState,
              sessionId: error.sessionId,
              missing: error.missing,
              warnings: error.warnings
            },
            [
              ...error.missing.map((entry) => `Produce ${entry.path}: ${entry.description}`),
              ...error.warnings.map((w) => `Soft-blocked (v2.13.3 back-compat window): ${w.path} — ${w.message}`),
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
