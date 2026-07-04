import { z } from "zod";

export const BeeManifestSchema = z.object({
  schemaVersion: z.literal("peaks.bee/1"),
  name: z.string().regex(/^bee-[a-z0-9][a-z0-9-]*$|^peaks-[a-z0-9][a-z0-9-]*$/),
  source: z.enum(["system", "user"]),
  promotion_status: z.enum(["candidate", "stable", "retired", "system-stable"]),
  description: z.string().min(1).max(200),
  segments: z.array(z.object({
    name: z.string(),
    inputs: z.array(z.object({ name: z.string(), type: z.enum(["string", "number", "boolean", "json"]), required: z.boolean() })),
    outputs: z.array(z.object({ name: z.string(), type: z.enum(["string", "number", "boolean", "json"]), required: z.boolean() })),
    sideEffects: z.array(z.string()),
  })),
  entrypoint: z.object({
    preamble: z.string(),
    refs: z.array(z.object({ path: z.string(), kind: z.enum(["file", "dir", "script"]) })),
  }),
  promotion: z.object({
    minCycles: z.number().int().nonnegative(),
    requiresHumanApproval: z.boolean(),
    requiresSmokeTest: z.boolean(),
    retireOnMissesInRow: z.number().int().positive().optional(),
  }),
  createdBy: z.enum(["human", "llm"]),
  lastTouchedAt: z.string().datetime(),
}).refine(
  (m) => !(m.source === "system" && m.promotion_status !== "system-stable"),
  { message: "source=system must have promotion_status=system-stable" }
);
