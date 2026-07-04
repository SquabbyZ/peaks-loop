import { BeeManifestSchema } from "./json-schema.js";
import type { BeeManifest } from "./types.js";

export type Finding = { path: string; message: string };
export type LintResult = { ok: true } | { ok: false; findings: Finding[] };

export function lintManifest(m: unknown): LintResult {
  const r = BeeManifestSchema.safeParse(m);
  if (r.success) return { ok: true };
  return { ok: false, findings: r.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
}

export function lintManifestStrict(m: unknown): BeeManifest {
  const r = BeeManifestSchema.parse(m);
  return r as BeeManifest;
}
