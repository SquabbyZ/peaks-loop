/**
 * Per spec §4.2 战略审计 + 战术审计 — sub-stage outputs.
 *
 * Hard constraint H8 (audit trail hashable): every output has sha256.
 * TACT.sig inputSig chain must reference STRAT.sig.
 */
import { z } from 'zod';

export const StrategyOutputSchema = z
  .object({
    version: z.literal('1.0'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    goal: z.string(),
    rootCauseAnalysis: z.string(),
    impactSurface: z.array(z.string()),
    designRationale: z.string(),
    askUserQuestion: z
      .object({
        question: z.string(),
        options: z.array(z.string())
      })
      .strict()
      .optional()
  })
  .strict();
export type StrategyOutput = z.infer<typeof StrategyOutputSchema>;

export const AstViolationSchema = z
  .object({
    file: z.string(),
    line: z.number().int(),
    api: z.string(),
    expectedVersion: z.string(),
    actualVersion: z.string(),
    severity: z.enum(['error', 'warning'])
  })
  .strict();

export const AstGateResultSchema = z
  .object({
    passed: z.boolean(),
    violations: z.array(AstViolationSchema)
  })
  .strict();

export const ExternalApiCallSchema = z
  .object({
    file: z.string(),
    line: z.number().int(),
    api: z.string(),
    version: z.string()
  })
  .strict();

export const ImplOutputSchema = z
  .object({
    version: z.literal('1.0'),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    generatedAt: z.string().datetime(),
    inputSig: z.string().regex(/^[a-f0-9]{64}$/), // STRAT.sig
    changedFiles: z.array(z.string()),
    externalApiCalls: z.array(ExternalApiCallSchema),
    astGateResult: AstGateResultSchema
  })
  .strict();
export type ImplOutput = z.infer<typeof ImplOutputSchema>;
export type AstViolation = z.infer<typeof AstViolationSchema>;
export type AstGateResult = z.infer<typeof AstGateResultSchema>;
export type ExternalApiCall = z.infer<typeof ExternalApiCallSchema>;
