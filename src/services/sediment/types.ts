export type Source = "system" | "user";
export type PromotionStatus = "candidate" | "stable" | "retired" | "system-stable";

export interface Param { name: string; type: "string" | "number" | "boolean" | "json"; required: boolean; }
export interface SegmentRef {
  name: string;
  inputs: Param[];
  outputs: Param[];
  sideEffects: string[];
}
export interface SkillEnvelopeRef { path: string; kind: "file" | "dir" | "script"; }
export interface SkillEnvelope { preamble: string; refs: SkillEnvelopeRef[]; }
export interface PromotionGate {
  minCycles: number;
  requiresHumanApproval: boolean;
  requiresSmokeTest: boolean;
  retireOnMissesInRow?: number;
}
export interface BeeManifest {
  schemaVersion: "peaks.bee/1";
  name: string;
  source: Source;
  promotion_status: PromotionStatus;
  description: string;
  segments: SegmentRef[];
  entrypoint: SkillEnvelope;
  promotion: PromotionGate;
  createdBy: "human" | "llm";
  lastTouchedAt: string; // ISO 8601
}
export interface IndexEntry {
  name: string;
  kind: "bee" | "segment";
  path: string;
  source: Source;
  promotion_status: PromotionStatus;
  segments?: string[];
}
export interface IndexFile {
  schemaVersion: "peaks.pool/1";
  generatedAt: string;
  entries: IndexEntry[];
}
