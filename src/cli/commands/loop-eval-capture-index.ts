// The cycle-file index seam for `--capture-score`. Pure path/IO plus its own path-safety
// contract; it owns no command registration, which is why it lives outside the
// registrar that calls it.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isUnsafePathInput } from '../../shared/path-safety.js';

/** Test seam: pick the next cycle-N.json number for capture-score
 *  writes. The run-driver also writes to the same dir; the next
 *  index = max(prior)+1, or 1. */
export function nextEvalCaptureIndex(projectRoot: string, sid: string, rid: string): number {
  // BOTH id axes: this function is the join for the capture-score cycle dir.
  // The action guards `options.session` and `rid` before calling in, but the
  // seam is callable on its own, so the join states its own contract. The rid
  // half was missing until 2026-09-14 (repair R1) — the same second-slot hole
  // the action had, in the same file, one function below it.
  if (isUnsafePathInput(sid)) {
    throw new Error(`Invalid session id: ${sid} (must be a single path segment)`);
  }
  if (isUnsafePathInput(rid)) {
    throw new Error(`Invalid request id: ${rid} (must be a single path segment)`);
  }
  const dir = join(projectRoot, '.peaks', '_runtime', sid, 'loop', rid, 'cycles');
  if (!existsSync(dir)) return 1;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs');
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 1;
  }
  let best: number | null = null;
  for (const entry of entries) {
    const m = entry.match(/^cycle-(\d+)\.json$/);
    if (m === null) continue;
    const n = parseInt(m[1] ?? '0', 10);
    if (best === null || n > best) best = n;
  }
  return (best ?? 0) + 1;
}
