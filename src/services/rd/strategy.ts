/**
 * Per spec §4.2 战略审计 — strategy.md writer + STRAT.sig computation.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): sig field embedded in strategy.md is the
 *       sha256 of all OTHER content (chicken-and-egg avoided).
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { StrategyOutputSchema, type StrategyOutput } from './types.js';

export interface WriteStrategyInput {
  readonly out: string;
  readonly goal: string;
  readonly rootCauseAnalysis: string;
  readonly impactSurface: ReadonlyArray<string>;
  readonly designRationale: string;
  readonly askUserQuestion?: { readonly question: string; readonly options: ReadonlyArray<string> };
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function writeStrategy(input: WriteStrategyInput): Promise<StrategyOutput> {
  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    goal: input.goal,
    rootCauseAnalysis: input.rootCauseAnalysis,
    impactSurface: input.impactSurface,
    designRationale: input.designRationale,
    ...(input.askUserQuestion ? { askUserQuestion: input.askUserQuestion } : {}),
  };
  const sha256 = sha256Of(partial);
  const final: StrategyOutput = { ...partial, sha256 };
  StrategyOutputSchema.parse(final);

  const body = [
    `# Strategy`,
    ``,
    `## Goal`,
    input.goal,
    ``,
    `## Root Cause Analysis`,
    input.rootCauseAnalysis,
    ``,
    `## Impact Surface`,
    input.impactSurface.map((s) => `- ${s}`).join('\n'),
    ``,
    `## Design Rationale`,
    input.designRationale,
    ...(input.askUserQuestion ? [``, `## Decision Needed`, `**${input.askUserQuestion.question}**`, ...input.askUserQuestion.options.map((o) => `- ${o}`)] : []),
    ``,
    `---`,
    `STRAT.sig: ${sha256}`,
  ].join('\n');

  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, body, 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return final;
}
