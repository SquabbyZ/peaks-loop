/**
 * Per spec §4.2 战术审计 — impl.json writer + TACT.sig computation.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): TACT.sig chains from STRAT.sig via inputSig.
 *   H6 (CLI裁决): refuses to write when AST gate has violations —
 *       LLM MUST auto-fix and re-run.
 */
import { createHash } from 'node:crypto';
import { writeFile, rename, unlink } from 'node:fs/promises';
import { ImplOutputSchema, type AstGateResult, type ExternalApiCall, type ImplOutput } from './types.js';

export interface WriteImplInput {
  readonly out: string;
  readonly inputSig: string;
  readonly changedFiles: ReadonlyArray<string>;
  readonly externalApiCalls: ReadonlyArray<ExternalApiCall>;
  readonly astGate: AstGateResult;
}

function sha256Of(content: object): string {
  const { sha256: _omit, ...rest } = content as { sha256?: string };
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function writeImpl(input: WriteImplInput): Promise<ImplOutput> {
  if (!input.astGate.passed) {
    throw new Error(
      `BLOCKED: AST gate failed — ${input.astGate.violations.length} violations. ` +
      'LLM MUST auto-fix and re-run before TACT.sig can be written. ' +
      '(spec §4.2 战术审计)'
    );
  }

  const partial = {
    version: '1.0' as const,
    sha256: '',
    generatedAt: new Date().toISOString(),
    inputSig: input.inputSig,
    changedFiles: [...input.changedFiles],
    externalApiCalls: [...input.externalApiCalls],
    astGateResult: input.astGate,
  };
  const sha256 = sha256Of(partial);
  const final: ImplOutput = { ...partial, sha256 };
  ImplOutputSchema.parse(final);

  const tmp = `${input.out}.tmp`;
  try {
    await writeFile(tmp, JSON.stringify(final, null, 2), 'utf8');
    await rename(tmp, input.out);
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }

  return final;
}
