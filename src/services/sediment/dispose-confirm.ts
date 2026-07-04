import type { BeeManifest } from "./types.js";
export type DisposePlan =
  | { decision: "destroy"; auto: true }
  | { decision: null; requiresUserPrompt: true };

export function planDispose(m: BeeManifest): DisposePlan {
  if (m.source === "system") return { decision: "destroy", auto: true };
  return { decision: null, requiresUserPrompt: true };
}