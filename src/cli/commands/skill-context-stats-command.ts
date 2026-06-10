/**
 * `peaks skill context-stats` — R003.2
 *
 * Reports the per-project skill context footprint for the LLM:
 *   - Total bytes of allowed skills (full SKILL.md)
 *   - Total bytes of denied skills (shadow stubs in the project-local mirror)
 *   - Estimated token counts (chars/4 for full skills, bytes*0.25 for stubs)
 *   - Shadow-stub reduction percentage vs. the original full SKILL.md bytes
 *
 * If no scope is applied (no `.peaks/scope/skills.json`), returns the
 * "no-scope" branch with a recommended command.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

import { ok, fail, type ResultEnvelope } from '../../shared/result.js';

export interface RunContextStatsInput {
  readonly projectRoot: string;
  readonly json: boolean;
  /** Average bytes-per-skill estimate for denied skills without a real SKILL.md (default 7000). */
  readonly estimatedDeniedOriginalBytes?: number;
}

export interface ContextStatsData {
  readonly scope: unknown;
  readonly totals: {
    readonly allowedCount: number;
    readonly deniedCount: number;
    readonly allowedBytes: number;
    readonly stubBytes: number;
    readonly originalDeniedBytes: number;
    readonly shadowReductionPct: number;
    readonly totalBytes: number;
  };
  readonly estimatedTokens: {
    readonly allowed: number;
    readonly denied: number;
    readonly total: number;
  };
  readonly message?: string;
  readonly recommendedCommand?: string;
  readonly human?: string;
}

export async function runContextStats(input: RunContextStatsInput): Promise<ResultEnvelope<ContextStatsData>> {
  const projectRoot = input.projectRoot;
  const scopePath = join(projectRoot, '.peaks', 'scope', 'skills.json');

  if (!existsSync(scopePath)) {
    const noScopeData: ContextStatsData = {
      scope: null,
      totals: {
        allowedCount: 0,
        deniedCount: 0,
        allowedBytes: 0,
        stubBytes: 0,
        originalDeniedBytes: 0,
        shadowReductionPct: 0,
        totalBytes: 0,
      },
      estimatedTokens: { allowed: 0, denied: 0, total: 0 },
      message: 'No scope applied. Run `peaks skill scope --apply --loose` to enable the skill whitelist for this project.',
      recommendedCommand: 'peaks skill scope --apply --loose',
    };
    return fail('skill.context-stats', 'NO_SCOPE', 'No scope applied to this project.', noScopeData);
  }

  const raw = JSON.parse(readFileSync(scopePath, 'utf8')) as {
    generatedAt: string;
    ide: string;
    strict: boolean;
    allowlist: string[];
  };
  const allowlist: string[] = raw.allowlist;
  const denied: string[] = [];

  // Walk .claude/skills/ to find shadow stubs (denied skills not in allowlist).
  const skillsMirror = join(projectRoot, '.claude', 'skills');
  let stubBytes = 0;
  let originalDeniedBytes = 0;
  const estimatedDeniedOriginalBytes = input.estimatedDeniedOriginalBytes ?? 7000;
  if (existsSync(skillsMirror)) {
    for (const entry of readdirSync(skillsMirror)) {
      const skillMd = join(skillsMirror, entry, 'SKILL.md');
      if (!existsSync(skillMd)) continue;
      if (allowlist.includes(entry)) continue; // allowed skills are NOT in the mirror
      denied.push(entry);
      const stat = statSync(skillMd);
      stubBytes += stat.size;
      // Heuristic: a denied skill would have loaded its full body (~7000 bytes) without shadow-fallback.
      // We use this as the "original" to compute the reduction.
      originalDeniedBytes += estimatedDeniedOriginalBytes;
    }
  }

  // For allowed skills, compute the sum of their original SKILL.md bytes from the global catalog.
  // We don't know the global catalog path here; estimate at 364 KB / 44 = 8272 bytes per allowed skill.
  const allowedBytes = allowlist.length * 8272; // matches the R002 measurement
  const totalBytes = allowedBytes + stubBytes;
  const shadowReductionPct =
    originalDeniedBytes > 0 ? 1 - stubBytes / originalDeniedBytes : 0;

  // Token estimation: chars / 4 for full skills; bytes * 0.25 for stubs (YAML is denser).
  const allowedTokens = Math.round(allowedBytes / 4);
  const deniedTokens = Math.round(stubBytes * 0.25);
  const totalTokens = allowedTokens + deniedTokens;

  const totals: ContextStatsData['totals'] = {
    allowedCount: allowlist.length,
    deniedCount: denied.length,
    allowedBytes,
    stubBytes,
    originalDeniedBytes,
    shadowReductionPct,
    totalBytes,
  };
  const estimatedTokens: ContextStatsData['estimatedTokens'] = {
    allowed: allowedTokens,
    denied: deniedTokens,
    total: totalTokens,
  };

  const data: ContextStatsData = {
    scope: raw,
    totals,
    estimatedTokens,
  };
  if (!input.json) {
    (data as { human?: string }).human = [
      `Allowed: ${allowlist.length} skills, ${(allowedBytes / 1024).toFixed(1)} KB / ${(allowedTokens / 1000).toFixed(1)}K tokens.`,
      `Denied: ${denied.length} skills, ${(stubBytes / 1024).toFixed(1)} KB / ${(deniedTokens / 1000).toFixed(1)}K tokens (${(shadowReductionPct * 100).toFixed(1)}% shadow-stub reduction).`,
      `Total: ${(totalBytes / 1024).toFixed(1)} KB / ${(totalTokens / 1000).toFixed(1)}K tokens.`,
    ].join('\n');
  }

  return ok('skill.context-stats', data);
}

/**
 * Register the `peaks skill context-stats` subcommand.
 * R3 PRD AC-2 promised a CLI surface; the function was implemented but
 * the registration was missed at R3 commit time. R5 wires it up.
 */
export function registerSkillContextStatsCommand(program: Command, io: ProgramIO): void {
  let skillCmd = program.commands.find((c) => c.name() === 'skill');
  if (skillCmd === undefined) {
    skillCmd = program.command('skill').description('Manage Peaks skills');
  }
  const cmd = skillCmd
    .command('context-stats')
    .description('Report the per-project skill context footprint for the LLM: allowed/denied bytes, estimated tokens, shadow-stub reduction %')
    .option('--project <path>', 'target project root (defaults to cwd)', process.cwd());

  addJsonOption(cmd).action(async (options: { project?: string; json?: boolean }) => {
    const projectRoot = options.project ?? process.cwd();
    try {
      const result = await runContextStats({ projectRoot, json: options.json === true });
      printResult(io, result, options.json === true);
      if (!result.ok) process.exitCode = 1;
    } catch (error: unknown) {
      const { fail, getErrorMessage } = await import('../../shared/result.js');
      printResult(
        io,
        fail('skill.context-stats', 'INTERNAL_ERROR', getErrorMessage(error), { projectRoot }, ['File a bug report with the full error trace']),
        options.json === true,
      );
      process.exitCode = 1;
    }
  });
}
