/**
 * 2.7.0 slice-dag-dispatcher MVP (slice 1.2.a) — cross-platform guard.
 *
 * AC-8.cross-platform: `SubAgentDispatcher` implementations and any
 * supporting code MUST NOT hardcode `/Users/...` or `C:\...` paths. All
 * paths must be constructed with `homedir() + join` (i.e. Node's
 * `path.join` / `os.homedir()`).
 *
 * Strategy:
 *  1. Read each file under test.
 *  2. Strip out comments (block + line) to avoid false positives
 *     (e.g. comments describing the rule itself).
 *  3. Fail if any line containing `/Users/` or `C:\\` (Windows-style
 *     hardcoded root) is found in source code under test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..', '..');
const FILES = [
  'src/services/dispatch/sub-agent-dispatcher.ts',
  'src/services/dispatch/slice-dag.ts',
  'src/services/dispatch/contract-store.ts',
  'src/services/code/dag-orchestrator.ts',
  'src/cli/commands/sub-agent-commands.ts'
];

describe('cross-platform path discipline (AC-8.cross-platform)', () => {
  for (const rel of FILES) {
    it(`${rel} contains no hardcoded /Users/... or C:\\... paths`, () => {
      const path = join(ROOT, rel);
      const raw = readFileSync(path, 'utf8');
      // Strip block comments and line comments to avoid false positives
      // (e.g. comments describing the rule itself).
      const stripped = raw
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => {
          const idx = line.indexOf('//');
          return idx >= 0 ? line.slice(0, idx) : line;
        })
        .join('\n');
      expect(stripped).not.toMatch(/\/Users\/[A-Za-z0-9_.-]+/);
      expect(stripped).not.toMatch(/['"`]C:\\\\/);
      expect(stripped).not.toMatch(/['"`]C:\/[^/]/);
    });
  }

  it('contract-store uses path.join for all path construction', () => {
    const body = readFileSync(join(ROOT, 'src/services/dispatch/contract-store.ts'), 'utf8');
    expect(body).toContain("from 'node:path'");
    expect(body).toMatch(/contractsDir[\s\S]*join\(/);
    expect(body).toMatch(/contractPath[\s\S]*join\(/);
  });
});
