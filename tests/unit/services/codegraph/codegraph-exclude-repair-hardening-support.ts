// tests/unit/services/codegraph/codegraph-exclude-repair-hardening-support.ts
//
// Project-root fixtures shared by the two halves of the
// codegraph-exclude-repair hardening test split (b1 filesplit campaign):
//   - codegraph-exclude-repair-hardening.test.ts       — F1 (render) + F2 (behavior)
//   - codegraph-exclude-repair-atomic-write.test.ts    — F3, N5, the backup
//     link guard (H1), and the two-axis single-rewrite case
//
// Moved verbatim from the original file. The `node:fs` rename hook
// (`vi.hoisted` + `vi.mock`) and the afterEach stay in EACH test file because
// vitest hoists mocks per file; this module only creates and disposes real
// temp dirs. `rmSync` and friends resolve through the per-file mock, which
// passes every non-`renameSync` call straight to the real implementation.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cleanups: string[] = [];

export function makeProjectRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-cg-repair-hardening-'));
  cleanups.push(dir);
  return dir;
}

export function configPathOf(projectRoot: string): string {
  return join(projectRoot, '.codegraph', 'config.json');
}

export function seedConfig(projectRoot: string, text: string): string {
  mkdirSync(join(projectRoot, '.codegraph'), { recursive: true });
  writeFileSync(configPathOf(projectRoot), text, 'utf8');
  return configPathOf(projectRoot);
}

/** Remove every project root handed out by `makeProjectRoot` (used by each
 *  half's `afterEach`, after it has disarmed its own rename hook). */
export function cleanupProjectRoots(): void {
  while (cleanups.length > 0) {
    const dir = cleanups.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
