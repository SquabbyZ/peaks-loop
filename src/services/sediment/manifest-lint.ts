import { BeeManifestSchema } from './json-schema.js';
import type { BeeManifest } from './types.js';

export function lintManifestStrict(m: unknown): BeeManifest {
  const r = BeeManifestSchema.parse(m);
  return r as BeeManifest;
}
