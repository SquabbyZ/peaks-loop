import { z } from 'zod';

// ── Spec §4.2, verbatim from spec ────────────────────────────────────────

export const SliceStateSchema = z
  .object({
    sliceId: z.string(),
    label: z.string(),
    status: z.enum(['pending', 'in-progress', 'done', 'failed', 'blocked', 'skipped']),
    commitSha: z.string().optional(),                       // required when status=done
    finishedAt: z.string().datetime().optional(),
    failureReason: z.string().optional(),                  // required when status=failed
    repairCycles: z.number().int().gte(0).default(0),
    blockedReason: z.string().optional(),                  // required when status=blocked
  })
  .superRefine((v, ctx) => {
    if (v.status === 'done' && !(v.commitSha && v.commitSha.length >= 7)) {
      ctx.addIssue({
        code: 'custom',
        path: ['commitSha'],
        message: 'commitSha required (≥7 hex) when status=done',
      });
    }
    if (v.status === 'failed' && !(v.failureReason && v.failureReason.length >= 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['failureReason'],
        message: 'failureReason required when status=failed',
      });
    }
    if (v.status === 'blocked' && !(v.blockedReason && v.blockedReason.length >= 1)) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockedReason'],
        message: 'blockedReason required when status=blocked',
      });
    }
  });

export const JobStateSchema = z.object({
  jobId: z.string(),
  sessionId: z.string(),
  startedAt: z.string().datetime(),
  lastCheckpointAt: z.string().datetime(),
  parallelismHint: z.enum(['serial', 'llm-decides']).default('llm-decides'),
  exitPolicy: z.enum(['strict', 'best-effort']).default('strict'),
  mainLoopStrategy: z.enum(['single', 'rotating']).default('rotating'),
  rotateEvery: z.number().int().gt(0).default(3),
  mainSessionCycle: z.number().int().gte(0).default(0),
  mainLoopOverride: z
    .object({
      from: z.literal('rotating'),
      to: z.literal('single'),
      reason: z.string().min(10),
      at: z.string().datetime(),
    })
    .optional(),
  slices: z.array(SliceStateSchema),
});

export const ResourceSnapshotSchema = z.object({
  capturedAt: z.string().datetime(),
  cpuPercent: z.number().min(0).max(100),
  memMb: z.number().gte(0),
  diskMb: z.number().gte(0),
  contextRatio: z.number().min(0).max(1),
});

export const JobStatusSummarySchema = z.object({
  total: z.number().int(),
  done: z.number().int(),
  failed: z.number().int(),
  blocked: z.number().int(),
  skipped: z.number().int(),
  currentSlice: z.string().optional(),
  lastCheckpoint: z.string().datetime(),
  mainLoopStrategy: z.enum(['single', 'rotating']),
  mainSessionCycle: z.number().int(),
  etaSec: z.number().int().optional(),
  resourcesNow: ResourceSnapshotSchema.optional(),
});

export type SliceState = z.infer<typeof SliceStateSchema>;
export type JobState = z.infer<typeof JobStateSchema>;
export type { ResourceSnapshot } from '../job-snapshot/types.js';
export type JobStatusSummary = z.infer<typeof JobStatusSummarySchema>;

// ── Spec §4.1 CLI input schemas (used by M3) ─────────────────────────────

export const JobInitInputSchema = z.object({
  jobId: z.string().min(1),
  sessionId: z.string().min(1),
  sliceList: z.array(z.string().min(1)).min(1),
  parallelismHint: z.enum(['serial', 'llm-decides']).default('llm-decides'),
  exitPolicy: z.enum(['strict', 'best-effort']).default('strict'),
  mainLoopStrategy: z.enum(['single', 'rotating']).default('rotating'),
  rotateEvery: z.number().int().gt(0).default(3),
  project: z.string(),
  json: z.boolean().default(true),
});
export type JobInitInput = z.infer<typeof JobInitInputSchema>;

export const JobCheckpointInputSchema = z
  .object({
    jobId: z.string(),
    sliceId: z.string(),
    state: z.enum(['done', 'failed', 'skipped']),
    commitSha: z.string().optional(),
    reason: z.string().optional(),
    project: z.string(),
    json: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.state === 'done' && !(v.commitSha && v.commitSha.length >= 7)) {
      ctx.addIssue({
        code: 'custom',
        path: ['commitSha'],
        message: 'commitSha required (≥7 hex) when state=done',
      });
    }
    if (
      (v.state === 'failed' || v.state === 'skipped') &&
      !(v.reason && v.reason.length >= 3)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'reason required (≥3 chars) when state=failed|skipped',
      });
    }
  });
export type JobCheckpointInput = z.infer<typeof JobCheckpointInputSchema>;

export const JobBlockInputSchema = z.object({
  jobId: z.string(),
  sliceId: z.string(),
  reason: z.string().min(3),
  project: z.string(),
  json: z.boolean().default(true),
});
export type JobBlockInput = z.infer<typeof JobBlockInputSchema>;
