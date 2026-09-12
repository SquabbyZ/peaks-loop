/**
 * peaks audit * CLI surface — Slice L2.1 + L2.3 P2-a.
 *
 * Registers the new `peaks audit` top-level command with the
 * `red-lines` (L2.1) and `static` (L2.3 P2-a) subcommands.
 * Per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first.md`
 * we verified that no `peaks audit` top-level exists; this is the only
 * file that owns the registration.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { Command } from 'commander';
import { runRedLinesAudit } from '../../services/audit/red-lines-service.js';
import { runStaticAudit, type AgentShieldState } from '../../services/audit/static-service.js';
import { auditGoal, IncompleteAuditError, type LlmRunner } from '../../services/audit/audit-goal-service.js';
import {
  createAnthropicRunner,
  LlmBindingError,
  LlmRequestError,
  resolveAnthropicConfig,
} from '../../services/llm/anthropic-runner.js';
import { createStubRunner } from '../../services/llm/stub-runner.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok, type ResultEnvelope } from 'peaks-loop-shared/result';

import type { AuditGoalOutput } from '../../services/audit/audit-goal-types.js';
import type { RedLineAudit } from '../../services/audit/types.js';
import { type AuditDecisionRecord, writeAuditDecision } from '../../services/audit/decision-writer.js';
import { computeProseRatio, type ProseRatioResult } from '../../services/audit/prose-ratio-calculator.js';
import {
  writeDecision,
  writeMachineOutput,
  writeNarrative,
  writePrompt,
  type ArtifactKind,
  type ArtifactWriteRecord,
} from '../../services/audit/artifact-writer.js';

type RedLinesOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
};

type StaticAuditOptions = {
  project: string;
  json?: boolean;
  noColor?: boolean;
  record?: boolean;
  rid?: string;
};

type AuditGoalOptions = {
  project: string;
  need: string;
  llmProvider?: string;
  json?: boolean;
};

type ArtifactWriteOptions = {
  project: string;
  kind: string;
  input: string;
  description?: string;
  name?: string;
  rid?: string;
  dryRun?: boolean;
  json?: boolean;
};

type ProseRatioOptions = {
  project: string;
  target: string;
  json?: boolean;
};

const SUPPORTED_ARTIFACT_KINDS: readonly ArtifactKind[] = [
  'decision',
  'prompt',
  'machine-output',
  'narrative',
];

function isSupportedArtifactKind(value: string): value is ArtifactKind {
  return (SUPPORTED_ARTIFACT_KINDS as readonly string[]).includes(value as ArtifactKind);
}

/** Whitelist of supported `--llm-provider` values for `peaks audit goal`. */
const SUPPORTED_LLM_PROVIDERS = ['anthropic', 'stub'] as const;
type SupportedLlmProvider = (typeof SUPPORTED_LLM_PROVIDERS)[number];

/**
 * The real provider is the default: `peaks audit goal` is the entry gate for
 * every peaks-* workflow, so it must audit by default and only scaffold when
 * a caller explicitly asks for `stub`.
 */
const DEFAULT_LLM_PROVIDER: SupportedLlmProvider = 'anthropic';

function isSupportedLlmProvider(value: string): value is SupportedLlmProvider {
  return (SUPPORTED_LLM_PROVIDERS as readonly string[]).includes(value);
}

/** `audit-failed` is a failure envelope's status — never a scaffold, never a success. */
export type AuditGoalStatus = 'audit-complete' | 'scaffold-only' | 'audit-failed';

export interface AuditGoalData {
  readonly status: AuditGoalStatus;
  /** Which LLM produced (or failed to produce) the audit. `unresolved` = rejected before binding. */
  readonly providerBinding: 'anthropic-messages-api' | 'stub' | 'unresolved';
  readonly need: string;
  readonly projectRoot: string;
  /** The validated 6-dimension audit. Present on success only. */
  readonly result?: AuditGoalOutput;
  /** The bound model. Present on a real run only. */
  readonly model?: string;
  /**
   * Environment variables the binding needed and did not find. Present on a
   * binding failure only, and verbatim: `fail()` redacts `message`, so this
   * is the channel that reliably names what the operator must set.
   */
  readonly missingEnv?: readonly string[];
}

function validateProjectRoot(projectArg: string): { ok: true; projectRoot: string } | { ok: false; code: string; message: string } {
  const projectRoot = resolve(projectArg);
  if (!existsSync(projectRoot)) {
    return { ok: false, code: 'PROJECT_NOT_FOUND', message: `project path does not exist: ${projectArg}` };
  }
  let stat;
  try {
    stat = statSync(projectRoot);
  } catch (error) {
    return { ok: false, code: 'INVALID_PROJECT', message: getErrorMessage(error) };
  }
  if (!stat.isDirectory()) {
    return { ok: false, code: 'INVALID_PROJECT', message: `project path is not a directory: ${projectArg}` };
  }
  return { ok: true, projectRoot };
}

export interface StaticAuditData {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  /** Populated only when `--record` is passed. Persisted decision record path. */
  readonly decision?: AuditDecisionRecord;
}

export function registerAuditCommands(program: Command, io: ProgramIO): void {
  const audit = program
    .command('audit', { hidden: true })
    .description('Audit a project for compliance with peaks-loop red lines (P0 / P1 / P2 tiers)');

  addJsonOption(
    audit
      .command('red-lines')
      .description('Scan skills/, .claude/rules/, and openspec/changes/ for MANDATORY / BLOCKING / MUST NOT / RED LINE markers; classify each as cli-backed / partial / prose-only')
      .requiredOption('--project <path>', 'target project root')
  ).action(async (options: RedLinesOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', validation.code, validation.message, { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] }, ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runRedLinesAudit({ projectRoot: validation.projectRoot });
      const nextActions: string[] = [];
      if (result.audit.proseOnly > 0) {
        nextActions.push(`${result.audit.proseOnly} prose-only red lines remain. Plan P1/P2 enforcers in L2.2-L2.4.`);
      }
      if (result.audit.cliBacked > 0) {
        nextActions.push(`${result.audit.cliBacked} red lines are now cli-backed. Re-run after each enforcer lands to track the prose-only ratio.`);
      }
      const envelope: ResultEnvelope<RedLineAudit> = ok('audit.red-lines', result.audit, result.warnings.map((w) => `${w.file}: ${w.message}`), nextActions);
      printResult(io, envelope, options.json);
    } catch (error) {
      printResult(
        io,
        fail<RedLineAudit>('audit.red-lines', 'SCANNER_FAILED', getErrorMessage(error), { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] }, ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice K1 (2.8.0): `--record` persists the audit snapshot as a
  // project-memory decision at `.peaks/memory/audit-decisions/<slug>.md`.
  // `--rid <id>` is an optional disambiguator for multiple audits on
  // the same day (slug becomes `audit-decision-<date>-<rid>`).
  // Per `peaks-loop-when-adding-a-new-subcommand-check-for-existing-top-level-first`
  // and the dev-preference red line "Default-no on new CLI commands",
  // we extend the existing command rather than register a new subcommand.
  //
  // 2026-09-09-ecc-dynamic-and-cleanup B3: the dead
  // `--enable-agent-shield` / `--disable-agent-shield` flags were removed.
  // `runStaticAudit`'s agentShield state is a frozen "always disabled" stub
  // (Slice 3 of 4.0.0-beta.11 removed the subprocess), so the flags had no
  // effect and the ECC opt-in prose misled users on every run.
  addJsonOption(
    audit
      .command('static')
      .description('Run the static audit (peaks-loop lint only; the ECC AgentShield subprocess was removed in 4.0.0-beta.11). Per spec §5.3.')
      .requiredOption('--project <path>', 'target project root')
      .option('--record', 'persist the audit snapshot to .peaks/memory/audit-decisions/ as a project-memory decision')
      .option('--rid <rid>', 'disambiguator for the decision record slug (used with --record; pairs multiple audits on the same day)')
  ).action(async (options: StaticAuditOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', validation.code, validation.message, emptyStaticAuditData(), ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    // Slice K1: `--rid` is meaningful only with `--record`. Surface a 422
    // when the user passes `--rid` without `--record` so the CLI fails
    // loudly rather than silently ignoring the request id.
    if (options.rid && !options.record) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', 'FLAGS_CONFLICT', '`--rid` requires `--record` (decision slug disambiguator has no effect without persistence)', emptyStaticAuditData(), ['Pass `--record` together with `--rid <id>`, or omit `--rid`']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runStaticAudit({
        projectRoot: validation.projectRoot
      });

      // Persist the decision record when `--record` is set. The writer is
      // idempotent at the slug level (same date+rid → same file); repeated
      // runs overwrite. Failures here are surfaced as warnings so the
      // primary audit JSON still reaches the caller.
      let decision: AuditDecisionRecord | undefined;
      let recordWarning: string | undefined;
      if (options.record) {
        try {
          decision = writeAuditDecision(result.audit, {
            projectRoot: validation.projectRoot,
            ...(options.rid ? { rid: options.rid } : {})
          });
        } catch (writeError) {
          recordWarning = `Failed to write decision record: ${getErrorMessage(writeError)}`;
        }
      }

      const data: StaticAuditData = {
        audit: result.audit,
        agentShield: result.agentShield,
        ...(decision ? { decision } : {})
      };
      const nextActions: string[] = [];
      // 2026-09-09-ecc-dynamic-and-cleanup B3: the ECC AgentShield opt-in
      // nextActions block was removed. `agentShield.installed` is a frozen
      // `false`, so the block printed on every run and pointed users at a
      // removed subprocess, removed flags, and a dead preference.
      if (decision) {
        nextActions.push(`Decision record written: ${decision.filePath}`);
        nextActions.push(`Index synced: ${decision.indexSynced ? 'yes' : 'no'} (memory hot.decision[] now includes this audit)`);
      }
      const warnings = recordWarning ? [...result.warnings, recordWarning] : [...result.warnings];
      const envelope: ResultEnvelope<StaticAuditData> = ok(
        'audit.static',
        data,
        warnings,
        nextActions,
      );
      printResult(io, envelope, options.json);
    } catch (error) {
      printResult(
        io,
        fail<StaticAuditData>('audit.static', 'SCANNER_FAILED', getErrorMessage(error), emptyStaticAuditData(), ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // v2.14.0 Slice C Group G3: `peaks audit prose-ratio` — CI gate.
  // Calls `peaks audit static --json` internally, parses the prose-only
  // ratio, exits 1 if the ratio exceeds the target (default 5%).
  // Rationale: a single CLI primitive for the CI gate; the underlying
  // ratio lives in static-service.ts (computed via prose-ratio-calculator).
  addJsonOption(
    audit
      .command('prose-ratio')
      .description('Compute the prose-only ratio (informational entries excluded). Exits 1 if ratio > target (default 5%).')
      .requiredOption('--project <path>', 'target project root')
      .option('--target <n>', 'maximum prose-only ratio (0-1, default 0.05)', '0.05')
  ).action(async (options: ProseRatioOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<ProseRatioResult>('audit.prose-ratio', validation.code, validation.message, emptyProseRatioResult(), ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const target = Number.parseFloat(options.target);
    if (!Number.isFinite(target) || target < 0 || target > 1) {
      printResult(
        io,
        fail<ProseRatioResult>('audit.prose-ratio', 'INVALID_TARGET', `--target must be a number between 0 and 1 (got "${options.target}")`, emptyProseRatioResult(), ['Pass --target 0.05 (default) or another number in [0, 1]']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    try {
      const result = runStaticAudit({ projectRoot: validation.projectRoot });
      const ratio = computeProseRatio(result.audit.audit, { target });
      const envelope: ResultEnvelope<ProseRatioResult> = ok('audit.prose-ratio', ratio, [], [
        ratio.exceeds
          ? `Prose-only ratio ${(ratio.ratio * 100).toFixed(2)}% exceeds target ${(ratio.target * 100).toFixed(2)}% (${ratio.proseOnly}/${ratio.totalRedLines})`
          : `Prose-only ratio ${(ratio.ratio * 100).toFixed(2)}% within target ${(ratio.target * 100).toFixed(2)}% (${ratio.proseOnly}/${ratio.totalRedLines})`
      ]);
      printResult(io, envelope, options.json);
      if (ratio.exceeds) {
        process.exitCode = 1;
      }
    } catch (error) {
      printResult(
        io,
        fail<ProseRatioResult>('audit.prose-ratio', 'SCANNER_FAILED', getErrorMessage(error), emptyProseRatioResult(), ['Inspect scanner logs and re-run with the same --project path']),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // Slice 2026-09-12-llm-provider-binding — `peaks audit goal` now runs the
  // gate it advertises. `auditGoal()` was already correct (one `LlmRunner`
  // call, 6-dimension validation, `IncompleteAuditError` on a partial audit);
  // what was missing was a provider binding, so the command answered with a
  // fixed `scaffold-only` envelope no matter what it was asked.
  //
  // `anthropic` is now the default and reads the session's own environment
  // (see `resolveAnthropicConfig`). `stub` stays for CI/tests but is
  // reported as a scaffold, and a missing credential fails loudly — a silent
  // fall back to the scaffold envelope would leave the gate exactly as fake
  // as it was before this slice.
  addJsonOption(
    audit
      .command('goal')
      .description('Audit a human need across 6 dimensions and propose a goal (peaks-audit primitive)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption('--need <text>', 'the human need to audit (becomes input.need for auditGoal())')
      .option(
        '--llm-provider <name>',
        `LLM provider (${SUPPORTED_LLM_PROVIDERS.join(' | ')}); stub performs no audit`,
        DEFAULT_LLM_PROVIDER
      )
  ).action(async (options: AuditGoalOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<AuditGoalData>('audit.goal', validation.code, validation.message, auditGoalFailureData(options.need, options.project), ['Verify the project path exists and is a directory']),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const provider = options.llmProvider ?? DEFAULT_LLM_PROVIDER;
    if (!isSupportedLlmProvider(provider)) {
      printResult(
        io,
        fail<AuditGoalData>(
          'audit.goal',
          'LLM_PROVIDER_NOT_IMPLEMENTED',
          `LLM provider "${provider}" is not implemented. Supported providers: ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
          auditGoalFailureData(options.need, validation.projectRoot),
          [
            `Re-run with \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for a real audit, or \`--llm-provider stub\` for an offline scaffold.`
          ]
        ),
        options.json
      );
      process.exitCode = 1;
      return;
    }

    const isStub = provider === 'stub';
    const providerBinding: AuditGoalData['providerBinding'] = isStub ? 'stub' : 'anthropic-messages-api';

    try {
      let model: string | undefined;
      let llmRunner: LlmRunner;
      if (isStub) {
        llmRunner = createStubRunner();
      } else {
        const config = resolveAnthropicConfig();
        model = config.model;
        llmRunner = createAnthropicRunner(config);
      }

      const result = await auditGoal({ need: options.need }, llmRunner);
      const data: AuditGoalData = {
        status: isStub ? 'scaffold-only' : 'audit-complete',
        providerBinding,
        need: options.need,
        projectRoot: validation.projectRoot,
        result,
        ...(model === undefined ? {} : { model }),
      };
      const envelope: ResultEnvelope<AuditGoalData> = ok(
        'audit.goal',
        data,
        [],
        isStub
          ? [`Stub provider: the 6 dimensions below are placeholders, not findings. Re-run with \`--llm-provider ${DEFAULT_LLM_PROVIDER}\` for a real audit.`]
          : [`Audit produced by ${providerBinding}${model === undefined ? '' : ` (model: ${model})`}.`]
      );
      printResult(io, envelope, options.json);
    } catch (error) {
      const code = auditGoalErrorCode(error);
      printResult(
        io,
        fail<AuditGoalData>(
          'audit.goal',
          code,
          getErrorMessage(error),
          auditGoalFailureData(
            options.need,
            validation.projectRoot,
            providerBinding,
            error instanceof LlmBindingError ? error.missingEnv : undefined
          ),
          auditGoalNextActions(code)
        ),
        options.json
      );
      process.exitCode = 1;
    }
  });

  // ---------------------------------------------------------------------------
  // peaks audit artifact write — Slice 2026-06-26-audit-artifact-writer-generalization
  //
  // First-class CLI surface for the 4 audit artifact types. Replaces the
  // 2026-06-22 "hand `git add` into .peaks/memory/" anti-pattern that left
  // 4 orphan files. Each kind routes to exactly one writer in
  // artifact-writer.ts; the writer enforces canonical frontmatter, so the
  // memory-shape guard never fires for new writes.
  // ---------------------------------------------------------------------------

  const artifact = audit
    .command('artifact')
    .description('Manage audit artifacts (decision / prompt / machine-output / narrative) under .peaks/memory/');

  addJsonOption(
    artifact
      .command('write')
      .description('Persist a single audit artifact to .peaks/memory/ via the artifact-writer (canonical frontmatter)')
      .requiredOption('--project <path>', 'target project root')
      .requiredOption(
        '--kind <kind>',
        `artifact kind (${SUPPORTED_ARTIFACT_KINDS.join(' | ')})`,
      )
      .requiredOption('--input <path>', 'path to source file (markdown for prompt/narrative; JSON for machine-output)')
      .option('--name <name>', 'display name (H1 in body); defaults to file basename')
      .option('--description <text>', 'description field for frontmatter; defaults to a generic placeholder')
      .option('--rid <id>', 'optional request id to disambiguate multiple writes on the same day')
      .option('--dry-run', 'render the markdown but do not write to disk', false),
  ).action((options: ArtifactWriteOptions) => {
    const validation = validateProjectRoot(options.project);
    if (!validation.ok) {
      printResult(
        io,
        fail<ArtifactWriteRecord>(
          'audit.artifact.write',
          validation.code,
          validation.message,
          {
            kind: 'narrative',
            slug: '',
            title: '',
            date: '',
            filePath: '',
            memoryDir: '',
            indexPath: '',
            indexSynced: false,
          },
          ['Verify the project path exists and is a directory'],
        ),
        options.json,
      );
      process.exitCode = 1;
      return;
    }

    if (!isSupportedArtifactKind(options.kind)) {
      printResult(
        io,
        fail<ArtifactWriteRecord>(
          'audit.artifact.write',
          'INVALID_KIND',
          `Unknown --kind "${options.kind}". Supported: ${SUPPORTED_ARTIFACT_KINDS.join(', ')}.`,
          {
            kind: 'narrative',
            slug: '',
            title: '',
            date: '',
            filePath: '',
            memoryDir: '',
            indexPath: '',
            indexSynced: false,
          },
          [
            `Re-run with --kind <one of ${SUPPORTED_ARTIFACT_KINDS.join(' | ')}>`,
            'See .peaks/memory/audit-artifact-convention.md for the 4 artifact types.',
          ],
        ),
        options.json,
      );
      process.exitCode = 1;
      return;
    }

    const inputAbs = resolve(options.input);
    if (!existsSync(inputAbs)) {
      printResult(
        io,
        fail<ArtifactWriteRecord>(
          'audit.artifact.write',
          'INPUT_NOT_FOUND',
          `--input file not found: ${options.input}`,
          {
            kind: options.kind,
            slug: '',
            title: '',
            date: '',
            filePath: '',
            memoryDir: '',
            indexPath: '',
            indexSynced: false,
          },
          ['Verify the --input path is correct (relative paths resolve against cwd)'],
        ),
        options.json,
      );
      process.exitCode = 1;
      return;
    }

    const baseName = options.name ?? options.input.split(/[\\/]/).pop() ?? 'untitled';
    const description =
      options.description ??
      `Audit artifact (${options.kind}) archived via peaks audit artifact write on ${new Date().toISOString().slice(0, 10)}.`;
    const writeOpts = {
      projectRoot: validation.projectRoot,
      dryRun: options.dryRun === true,
      ...(options.rid ? { rid: options.rid } : {}),
    };

    let record: ArtifactWriteRecord;
    try {
      switch (options.kind) {
        case 'prompt': {
          const body = readFileSync(inputAbs, 'utf8');
          record = writePrompt({ name: baseName, description, body }, writeOpts);
          break;
        }
        case 'machine-output': {
          const json = readFileSync(inputAbs, 'utf8');
          record = writeMachineOutput({ name: baseName, description, json }, writeOpts);
          break;
        }
        case 'narrative': {
          const body = readFileSync(inputAbs, 'utf8');
          record = writeNarrative({ name: baseName, description, body }, writeOpts);
          break;
        }
        case 'decision': {
          // --kind decision requires JSON of `RedLineAudit` shape; for now
          // surface a clear error so callers don't silently write junk.
          printResult(
            io,
            fail<ArtifactWriteRecord>(
              'audit.artifact.write',
              'KIND_DECISION_USE_STATIC_RECORD',
              `--kind decision should use 'peaks audit static --record' which writes a RedLineAudit snapshot. 'peaks audit artifact write --kind decision' is reserved for future direct-snapshot writes (not implemented yet).`,
              {
                kind: 'decision',
                slug: '',
                title: '',
                date: '',
                filePath: '',
                memoryDir: '',
                indexPath: '',
                indexSynced: false,
              },
              ["Re-run with 'peaks audit static --record --project <root>' for RedLineAudit snapshots."],
            ),
            options.json,
          );
          process.exitCode = 1;
          return;
        }
        default: {
          // Unreachable: isSupportedArtifactKind already filtered.
          throw new Error(`unreachable: kind=${options.kind}`);
        }
      }
    } catch (err) {
      printResult(
        io,
        fail<ArtifactWriteRecord>(
          'audit.artifact.write',
          'WRITE_FAILED',
          getErrorMessage(err),
          {
            kind: options.kind,
            slug: '',
            title: '',
            date: '',
            filePath: '',
            memoryDir: '',
            indexPath: '',
            indexSynced: false,
          },
          ['Inspect the error message; for --kind machine-output ensure --input is valid JSON'],
        ),
        options.json,
      );
      process.exitCode = 1;
      return;
    }

    printResult(
      io,
      ok<ArtifactWriteRecord>('audit.artifact.write', record, [], [
        `Artifact written via ${record.kind} writer.`,
        record.indexSynced
          ? 'Memory index regenerated; entry will appear in `peaks project memories` on next read.'
          : 'Memory index NOT regenerated; run `peaks project memories --project <root>` to refresh.',
      ]),
      options.json,
    );
  });
}

function emptyStaticAuditData(): StaticAuditData {
  return {
    audit: { totalRedLines: 0, cliBacked: 0, partial: 0, proseOnly: 0, audit: [], enforcerFindings: [] },
    agentShield: {
      spawned: false,
      installed: false,
      reason: 'flag-disabled',
      findings: [],
    },
  };
}

function auditGoalFailureData(
  need: string,
  projectRoot: string,
  providerBinding: AuditGoalData['providerBinding'] = 'unresolved',
  missingEnv?: readonly string[]
): AuditGoalData {
  return {
    status: 'audit-failed',
    providerBinding,
    need,
    projectRoot,
    ...(missingEnv === undefined ? {} : { missingEnv }),
  };
}

/** The slice-owned error codes are carried verbatim so callers can gate on them. */
function auditGoalErrorCode(error: unknown): string {
  if (error instanceof IncompleteAuditError || error instanceof LlmBindingError || error instanceof LlmRequestError) {
    return error.code;
  }
  return 'AUDIT_GOAL_FAILED';
}

function auditGoalNextActions(code: string): string[] {
  switch (code) {
    case 'LLM_CREDENTIAL_MISSING':
      return [
        'Export ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY) in the environment that launches peaks, then re-run.',
        'For an offline scaffold instead of an audit, re-run with `--llm-provider stub` — it performs NO audit.',
      ];
    case 'LLM_MODEL_MISSING':
      return ['Export ANTHROPIC_MODEL (or CLAUDE_CODE_SUBAGENT_MODEL) in the environment that launches peaks, then re-run.'];
    case 'INCOMPLETE_AUDIT':
      return ['The LLM reply omitted a required dimension; re-run so autonomous work never proceeds on a partial audit.'];
    default:
      return ['Inspect the failure above, then re-run with the same --need.'];
  }
}

function emptyProseRatioResult(): ProseRatioResult {
  return {
    totalRedLines: 0,
    cliBacked: 0,
    partial: 0,
    proseOnly: 0,
    informational: 0,
    ratio: 0,
    target: 0.05,
    exceeds: false,
  };
}
