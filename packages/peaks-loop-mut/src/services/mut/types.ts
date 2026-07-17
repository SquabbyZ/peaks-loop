/**
 * Per spec §4.2 验收审计 + §7 阶段二 — MutReportJson v1.0.
 *
 * Hard constraints:
 *   H8 (audit trail hashable): sha256 + inputSig (chain to TACT.sig)
 *   H6 (CLI裁决, not LLM): passed boolean is computed by CLI, not LLM
 */
import { z } from 'zod';

export type MutVersion = '1.0';
export type MutTool = 'stryker' | 'mutmut' | 'go-mutesting';

export type WeakPattern =
  | 'toBeDefined' | 'toBeTruthy' | 'toEqual-self' | 'expect-anything' | 'toBe-self';

export interface SurvivedMutant {
  readonly line: number;
  readonly mutation: string;
  readonly survivedBecause: string;
}

export interface FileMutationReport {
  readonly file: string;
  readonly killRate: number;
  readonly survived: ReadonlyArray<SurvivedMutant>;
}

export interface MutationReport {
  readonly tool: MutTool;
  readonly mutantsTotal: number;
  readonly mutantsKilled: number;
  readonly mutantsSurvived: number;
  readonly mutantsTimeout: number;
  readonly killRate: number;
  readonly byFile: ReadonlyArray<FileMutationReport>;
}

export interface WeakExample {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

export interface WeakPatternCount {
  readonly pattern: WeakPattern;
  readonly count: number;
  readonly examples: ReadonlyArray<WeakExample>;
}

export interface AssertionsReport {
  readonly totalAssertions: number;
  readonly weakAssertions: number;
  readonly weakRate: number;
  readonly weakPatterns: ReadonlyArray<WeakPatternCount>;
}

export interface ThresholdsConfig {
  readonly mutationKillRateMin: number;
  readonly weakAssertionRateMax: number;
  readonly passed: boolean;
}

export type FollowupSeverity = 'soft' | 'hard';
export type FollowupIssue = 'low_kill_rate' | 'high_weak_assertions';

export interface Followup {
  readonly file: string;
  readonly issue: FollowupIssue;
  readonly severity: FollowupSeverity;
  readonly suggestion: string;
}

export interface MutReportJson {
  readonly version: MutVersion;
  readonly sha256: string;
  readonly generatedAt: string;
  readonly inputSig: string;
  readonly mutation: MutationReport;
  readonly assertions: AssertionsReport;
  readonly thresholds: ThresholdsConfig;
  readonly followups: ReadonlyArray<Followup>;
}

export const WeakPatternSchema = z.enum([
  'toBeDefined', 'toBeTruthy', 'toEqual-self', 'expect-anything', 'toBe-self',
]);

export const MutReportSchema = z.object({
  version: z.literal('1.0'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  generatedAt: z.string().datetime(),
  inputSig: z.string().regex(/^[a-f0-9]{64}$/),
  mutation: z.object({
    tool: z.enum(['stryker', 'mutmut', 'go-mutesting']),
    mutantsTotal: z.number().int().nonnegative(),
    mutantsKilled: z.number().int().nonnegative(),
    mutantsSurvived: z.number().int().nonnegative(),
    mutantsTimeout: z.number().int().nonnegative(),
    killRate: z.number().min(0).max(1),
    byFile: z.array(z.object({
      file: z.string(),
      killRate: z.number().min(0).max(1),
      survived: z.array(z.object({
        line: z.number().int(),
        mutation: z.string(),
        survivedBecause: z.string(),
      })),
    })),
  }),
  assertions: z.object({
    totalAssertions: z.number().int().nonnegative(),
    weakAssertions: z.number().int().nonnegative(),
    weakRate: z.number().min(0).max(1),
    weakPatterns: z.array(z.object({
      pattern: WeakPatternSchema,
      count: z.number().int().nonnegative(),
      examples: z.array(z.object({
        file: z.string(),
        line: z.number().int(),
        code: z.string(),
      })),
    })),
  }),
  thresholds: z.object({
    mutationKillRateMin: z.number().min(0).max(1),
    weakAssertionRateMax: z.number().min(0).max(1),
    passed: z.boolean(),
  }),
  followups: z.array(z.object({
    file: z.string(),
    issue: z.enum(['low_kill_rate', 'high_weak_assertions']),
    severity: z.enum(['soft', 'hard']),
    suggestion: z.string(),
  })),
});
