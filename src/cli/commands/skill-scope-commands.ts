/**
 * `peaks skill scope` CLI surface (slice 025.1).
 *
 * Four subcommands (mutually exclusive):
 * - `--detect` — dry-run; prints the relevance matrix, never touches files.
 * - `--apply`  — writes the source-of-truth + IDE-native config.
 * - `--show`   — reads the source-of-truth + native config back.
 * - `--reset`  — removes the source-of-truth + IDE-native config.
 *
 * Exit code matrix (tech-doc §6.3):
 *   0  success
 *   1  uncaught error
 *   2  invalid usage (missing/incompatible flags)
 *   3  source-of-truth written but adapter returned NOT_SUPPORTED
 *   4  adapter failure other than NOT_SUPPORTED
 */

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  detectSkillScope,
  type DetectResult,
} from '../../services/skill-scope/detect.js';
import { resolveActiveAdapter, getScopeAdapter } from '../../services/skill-scope/registry.js';
import {
  ideCompanionFilePath,
  readIdeCompanion,
  readSourceOfTruth,
  removeIfExists,
  scopeFilePath,
  writeSourceOfTruth,
} from '../../services/skill-scope/source-of-truth.js';
import type {
  ApplyResult,
  ApplyScopeInput,
  ScopeConfig,
} from '../../services/skill-scope/types.js';
import type { IdeId } from '../../services/ide/ide-types.js';
import { ALWAYS_RELEVANT_SKILLS } from '../../services/skill-scope/types.js';
import { fail, getErrorMessage, ok, type ResultEnvelope } from '../../shared/result.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

export type SkillScopeAction = 'detect' | 'apply' | 'show' | 'reset';

export interface RunSkillScopeInput {
  readonly subcommand: SkillScopeAction;
  readonly project: string;
  readonly strict?: boolean;
  readonly loose?: boolean;
  readonly ide?: string;
  readonly shadowFallback?: boolean;
  readonly json?: boolean;
  /** Test seam: override the detected allowlist (CLI re-adds peaks-* per G6). */
  readonly overrideAllowlist?: readonly string[];
  /** Test seam: force the source-of-truth write to fail (simulates atomicity test). */
  readonly simulateSourceOfTruthWriteFailure?: boolean;
}

export interface RunSkillScopeResult {
  readonly exitCode: number;
  readonly envelope: ResultEnvelope<unknown> | null;
  readonly stdout: string;
  readonly stderr: string;
}

const VALID_ACTIONS: readonly SkillScopeAction[] = ['detect', 'apply', 'show', 'reset'];
const VALID_IDES: readonly IdeId[] = ['claude-code', 'trae', 'codex', 'cursor', 'qoder', 'tongyi-lingma'];

function isValidIde(value: string): value is IdeId {
  return (VALID_IDES as readonly string[]).includes(value);
}

/**
 * G6: enforce the peaks-* allowlist. Re-adds any peak-* skill that is
 * missing from the allowlist, and removes any peak-* skill from the
 * denylist. The list is the same one declared in `types.ts`.
 */
function enforcePeaksAllowlist(allowlist: readonly string[]): readonly string[] {
  const set = new Set<string>(allowlist);
  for (const name of ALWAYS_RELEVANT_SKILLS) {
    if (name.startsWith('peaks-')) set.add(name);
  }
  return [...set];
}

function stripPeaksFromDenylist(denylist: readonly string[]): readonly string[] {
  return denylist.filter((name) => !name.startsWith('peaks-'));
}

/**
 * Determine the IDE. Caller-supplied `--ide` wins; otherwise the registry
 * probes the project root.
 */
async function resolveIde(
  projectRoot: string,
  override: string | undefined
): Promise<{ readonly ide: IdeId; readonly isFallback: boolean }> {
  if (override !== undefined) {
    if (!isValidIde(override)) {
      throw new Error(`Unknown IDE: ${override}. Valid: ${VALID_IDES.join(', ')}`);
    }
    return { ide: override, isFallback: false };
  }
  const resolved = await resolveActiveAdapter(projectRoot);
  return { ide: resolved.adapter.ide, isFallback: resolved.isFallback };
}

/**
 * Stable timestamp (no millisecond jitter) for the `generatedAt` field.
 * `Date.now()` would still be deterministic per-run; we keep the natural
 * one to ensure `generatedAt` matches what the user sees on disk.
 */
function nowIso(): string {
  return new Date().toISOString();
}

/** Run the --detect subcommand. */
async function runDetect(input: RunSkillScopeInput): Promise<RunSkillScopeResult> {
  try {
    const result: DetectResult = await detectSkillScope({ projectRoot: input.project });
    const envelope = ok('skill.scope.detect', result);
    const stdout = input.json === true ? JSON.stringify(envelope, null, 2) : JSON.stringify(result, null, 2);
    return { exitCode: 0, envelope, stdout, stderr: '' };
  } catch (error) {
    const envelope = fail('skill.scope.detect', 'DETECT_FAILED', getErrorMessage(error), null);
    return { exitCode: 1, envelope, stdout: '', stderr: envelope.message ?? 'detect failed' };
  }
}

/** Build the final ScopeConfig (applies G6 enforcement + override). */
function buildScopeConfig(args: {
  readonly ide: IdeId;
  readonly strict: boolean;
  readonly detected: DetectResult;
  readonly allowOverride?: readonly string[];
}): ScopeConfig {
  const strict = args.strict;
  const detected = args.detected;
  // Build allowlist from detected.relevant + (in loose) borderline.
  const allowFromDetect = detected.skills
    .filter((s) => s.relevance === 'relevant' || (!strict && s.relevance === 'borderline'))
    .map((s) => s.name);
  const merged = args.allowOverride !== undefined ? [...args.allowOverride, ...allowFromDetect] : allowFromDetect;
  const enforced = enforcePeaksAllowlist(merged);
  // Denylist: irrelevant skills (strict + loose both), minus anything in allowlist.
  const denyFromDetect = detected.skills
    .filter((s) => s.relevance === 'irrelevant' && !enforced.includes(s.name))
    .map((s) => s.name);
  const finalDeny = stripPeaksFromDenylist(denyFromDetect);
  return {
    generatedAt: nowIso(),
    ide: args.ide,
    strict,
    allowlist: enforced,
    denylist: finalDeny,
    skills: detected.skills,
    signals: detected.projectSignals,
  };
}

/** Run the --apply subcommand. */
async function runApply(input: RunSkillScopeInput): Promise<RunSkillScopeResult> {
  // 1. Detect the scope.
  const detected = await detectSkillScope({ projectRoot: input.project });
  // --strict wins when both flags are passed. Default is --loose per PRD.
  const isStrict = input.strict === true && input.loose !== true;
  const loose = !isStrict;

  const { ide, isFallback } = await resolveIde(input.project, input.ide);
  const adapter = getScopeAdapter(ide);

  const config = buildScopeConfig({
    ide,
    strict: isStrict,
    detected,
    ...(input.overrideAllowlist !== undefined ? { allowOverride: input.overrideAllowlist } : {}),
  });

  // 2. Write the source-of-truth first (atomic). Test seam: simulate failure.
  let writtenFiles: string[] = [];
  let sourceWritten = false;
  try {
    if (input.simulateSourceOfTruthWriteFailure) {
      throw new Error('simulated source-of-truth write failure');
    }
    const file = await writeSourceOfTruth(input.project, config);
    writtenFiles.push(file);
    sourceWritten = true;
  } catch (error) {
    const envelope = fail(
      'skill.scope.apply',
      'WRITE_FAILED',
      getErrorMessage(error),
      { ide, sourceWritten: false },
      ['Fix filesystem permissions on the project root and retry']
    );
    return { exitCode: 4, envelope, stdout: '', stderr: envelope.message ?? 'write failed' };
  }

  // 3. Call the adapter. Stub adapters return notSupported=true; we surface it.
  const adapterInput: ApplyScopeInput = {
    allowlist: config.allowlist,
    denylist: config.denylist,
    strict: config.strict,
    projectRoot: input.project,
    sourceConfig: config,
    shadowFallback: input.shadowFallback === true,
  };

  let result: ApplyResult;
  try {
    result = await adapter.applyScope(adapterInput);
  } catch (error) {
    // Roll back the source-of-truth on adapter failure.
    await removeIfExists(scopeFilePath(input.project));
    const envelope = fail(
      'skill.scope.apply',
      'ADAPTER_FAILED',
      getErrorMessage(error),
      { ide, sourceWritten: false, writtenFiles: [] },
      ['Inspect the adapter error and retry']
    );
    return { exitCode: 4, envelope, stdout: '', stderr: envelope.message ?? 'adapter failed' };
  }

  // The stub adapter also writes the canonical skills.json — that's
  // already on disk from step 2, so its second write is a no-op update.

  const finalWrittenFiles = [...writtenFiles, ...result.writtenFiles];
  const envelope = ok('skill.scope.apply', {
    ide,
    isFallback,
    strict: isStrict,
    loose,
    allowlist: config.allowlist,
    denylist: config.denylist,
    signals: config.signals,
    writtenFiles: finalWrittenFiles,
    usedShadowStub: result.usedShadowStub,
    notSupported: result.notSupported,
    strippedFromDenylist: result.strippedFromDenylist ?? [],
    error: result.error,
  });
  const stdout = input.json === true ? JSON.stringify(envelope, null, 2) : JSON.stringify(envelope.data, null, 2);

  if (result.notSupported) {
    // Stub adapter: NOT_SUPPORTED → exit 3, write error to stderr.
    const stderr = `${result.error?.code ?? 'NOT_SUPPORTED'}: ${result.error?.message ?? 'not supported'}`;
    return { exitCode: 3, envelope, stdout, stderr };
  }
  return { exitCode: 0, envelope, stdout, stderr: '' };
}

/** Run the --show subcommand. */
async function runShow(input: RunSkillScopeInput): Promise<RunSkillScopeResult> {
  const source = await readSourceOfTruth(input.project);
  const { ide } = await resolveIde(input.project, input.ide);
  const companionPath = ideCompanionFilePath(input.project, ide);
  const companion = await readIdeCompanion(input.project, ide);
  // For Claude Code, the native config is `.claude/settings.local.json`.
  const nativeSettingsPath = join(input.project, '.claude', 'settings.local.json');
  const nativeExists = existsSync(nativeSettingsPath);
  let native: unknown = companion;
  if (nativeExists) {
    try {
      const { readFile } = await import('node:fs/promises');
      native = JSON.parse(await readFile(nativeSettingsPath, 'utf8'));
    } catch {
      native = null;
    }
  }
  const data = {
    ide,
    source,
    native,
    nativeSettingsPath: nativeExists ? '.claude/settings.local.json' : null,
    companionPath: existsSync(companionPath) ? companionPath : null,
  };
  const envelope = ok('skill.scope.show', data);
  const stdout = input.json === true ? JSON.stringify(envelope, null, 2) : JSON.stringify(data, null, 2);
  return { exitCode: 0, envelope, stdout, stderr: '' };
}

/** Run the --reset subcommand. */
async function runReset(input: RunSkillScopeInput): Promise<RunSkillScopeResult> {
  const { ide } = await resolveIde(input.project, input.ide);
  const adapter = getScopeAdapter(ide);
  const resetResult = await adapter.resetScope({ projectRoot: input.project });
  const sourceFile = scopeFilePath(input.project);
  const sourceRemoved = await removeIfExists(sourceFile);
  const allRemoved = [...resetResult.removedFiles, ...(sourceRemoved ? [sourceFile] : [])];

  const envelope = ok('skill.scope.reset', {
    ide,
    removedFiles: allRemoved,
  });
  // Always include the canonical source-of-truth path in the human-readable
  // summary, even if it didn't exist (so the user knows what was targeted).
  const displayFiles = allRemoved.length > 0 ? allRemoved : [sourceFile, join(input.project, '.claude', 'settings.local.json')];
  const summary = `removed: ${displayFiles.join(', ')}`;
  const stdout = input.json === true ? JSON.stringify(envelope, null, 2) : summary;
  return { exitCode: 0, envelope, stdout, stderr: '' };
}

/**
 * Programmatic entry point for `peaks skill scope`. Used by the CLI shim
 * AND by the unit tests.
 */
export async function runSkillScopeCommand(input: RunSkillScopeInput): Promise<RunSkillScopeResult> {
  if (!VALID_ACTIONS.includes(input.subcommand)) {
    const envelope = fail('skill.scope', 'INVALID_USAGE', `Unknown action: ${input.subcommand}`, null);
    return { exitCode: 2, envelope, stdout: '', stderr: envelope.message ?? 'invalid usage' };
  }
  switch (input.subcommand) {
    case 'detect': return runDetect(input);
    case 'apply':  return runApply(input);
    case 'show':   return runShow(input);
    case 'reset':  return runReset(input);
  }
}

/**
 * Register the `peaks skill scope` subcommand on the `skill` command group.
 * Mutually-exclusive flags: exactly one of --detect / --apply / --show / --reset.
 */
export function registerSkillScopeCommands(program: Command, io: ProgramIO): void {
  // Find the existing 'skill' subcommand if any.
  let skillCmd = program.commands.find((c) => c.name() === 'skill');
  if (skillCmd === undefined) {
    skillCmd = program.command('skill').description('Manage Peaks skills');
  }
  const scope = skillCmd
    .command('scope')
    .description('Per-project skill scoping: detect, apply, show, reset');

  addJsonOption(
    scope
      .option('--detect', 'dry-run: print the relevance matrix')
      .option('--apply', 'apply the scope (writes source-of-truth + IDE config)')
      .option('--show', 'show the currently applied scope')
      .option('--reset', 'remove the scope config')
      .option('--project <path>', 'target project root (defaults to cwd)', process.cwd())
      .option('--strict', '--apply: only `relevant` skills in the allowlist')
      .option('--loose', '--apply: `relevant` + `borderline` in the allowlist (default)')
      .option('--ide <name>', 'force a specific IDE adapter (overrides auto-detect)')
      .option('--shadow-fallback', '--apply: Claude Code uses shadow stubs for the denylist')
  ).action(async (options: {
    detect?: boolean;
    apply?: boolean;
    show?: boolean;
    reset?: boolean;
    project?: string;
    strict?: boolean;
    loose?: boolean;
    ide?: string;
    shadowFallback?: boolean;
    json?: boolean;
  }) => {
    const flags = [options.detect, options.apply, options.show, options.reset].filter(Boolean).length;
    if (flags !== 1) {
      const envelope = fail(
        'skill.scope',
        'INVALID_USAGE',
        'Exactly one of --detect / --apply / --show / --reset is required',
        null,
        ['Pass exactly one action flag']
      );
      printResult(io, envelope, options.json === true);
      process.exitCode = 2;
      return;
    }
    const subcommand: SkillScopeAction = options.detect
      ? 'detect'
      : options.apply
      ? 'apply'
      : options.show
      ? 'show'
      : 'reset';

    const result = await runSkillScopeCommand({
      subcommand,
      project: options.project ?? process.cwd(),
      ...(options.strict !== undefined ? { strict: options.strict } : {}),
      ...(options.loose !== undefined ? { loose: options.loose } : {}),
      ...(options.ide !== undefined ? { ide: options.ide } : {}),
      ...(options.shadowFallback !== undefined ? { shadowFallback: options.shadowFallback } : {}),
      ...(options.json !== undefined ? { json: options.json } : {}),
    });

    if (options.json === true) {
      if (result.envelope !== null) printResult(io, result.envelope, true);
    } else {
      if (result.stdout.length > 0) io.stdout(result.stdout);
      if (result.stderr.length > 0) io.stderr(result.stderr);
    }
    if (result.exitCode !== 0) {
      process.exitCode = result.exitCode;
    }
  });
}