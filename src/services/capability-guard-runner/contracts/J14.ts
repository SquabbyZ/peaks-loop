import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import { combineProbes, fail, missingSourceFiles, pass, probe, requireBaselineRow } from './_shared.js';

const SKILL_MD = ['skills', 'peaks-issue-fix-orchestrator', 'SKILL.md'];

/**
 * The RL-3 declaration's literal lines. Anchored on the exact marker text the
 * self-check greps for — "AI-modified" appearing once in the frontmatter
 * description is not evidence that the rule survived.
 */
const REQUIRED_MARKERS: ReadonlyArray<string> = [
  'AI-modified: yes',
  'Repository:',
  'Modifying tool: peaks-loop / peaks-issue-fix-orchestrator',
  "grep -E 'Repository:|AI-modified:'",
  'Forbidden trailers:'
];

/** Every trailer the repo's own red rule bans (CLAUDE.md, 2026-07-01). */
const FORBIDDEN_TRAILERS: ReadonlyArray<string> = [
  'Co-Authored-By: Claude',
  'Co-Authored-By: Anthropic'
];

/** Survey-banned target globs that must still be refused before any commit. */
const BANNED_TARGETS: ReadonlyArray<string> = [
  'tools/mcp_oauth.py',
  'agent/auth/*',
  'agent/conversation_loop.py',
  'agent/tool_guardrails.py',
  '*/prompt_cache*',
  '*/token_cache*'
];

/**
 * Behavioural probe of the RL-3 AI-modified declaration rule.
 *
 * The previous version read the skill plus two markdown files and passed if at
 * least two of the words triage/classify/fix/commit appeared — words that
 * appear throughout the prose regardless of whether any rule survived.
 *
 * Here the rule is anchored on its heading, its literal commit-body markers,
 * the forbidden-trailer list and the survey-banned globs. Deleting the rule
 * section reddens the journey.
 */
export async function runJ14Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const abs = join(ctx.projectRoot, ...SKILL_MD);
  const body = existsSync(abs) ? readFileSync(abs, 'utf8') : '';

  // The heading carries an em dash, so match the two stable halves instead of
  // the literal punctuation.
  const headingPresent = /###\s+RL-3\b[^\n]*AI-modified declaration/.test(body);
  const missingMarkers = REQUIRED_MARKERS.filter((m) => !body.includes(m));
  const missingTrailers = FORBIDDEN_TRAILERS.filter((t) => !body.includes(t));
  const missingTargets = BANNED_TARGETS.filter((t) => !body.includes(t));

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(body.length > 0, 'the issue-fix orchestrator skill file is readable'),
    probe(headingPresent, 'the RL-3 AI-modified declaration section is still present'),
    probe(missingMarkers.length === 0, `the commit-body markers are intact (missing: ${missingMarkers.join(', ') || 'none'})`),
    probe(missingTrailers.length === 0, `the AI trailer ban is intact (missing: ${missingTrailers.join(', ') || 'none'})`),
    probe(missingTargets.length === 0, `the survey-banned target globs are intact (missing: ${missingTargets.join(', ') || 'none'})`)
  ]);

  const artifact = row.sourceFiles[0] ?? 'skills/peaks-issue-fix-orchestrator/SKILL.md';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    'every fix carries the RL-3 AI-modified declaration and the banned-target list survives',
    result.detail,
    'J14 invariant broken: the AI-modified declaration rule or the banned-target list was removed'
  );
}
