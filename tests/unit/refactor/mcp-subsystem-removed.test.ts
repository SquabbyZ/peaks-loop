// Slice #016 regression test: the peaks-loop MCP subsystem is fully removed.
//
// Wraps `scripts/static-scan-mcp-removed.mjs` (a pure-JS scanner) and asserts
// the 4 invariants the tech-doc Change1 enumerates. This is the test stage
// (`pnpm vitest run`) guard rail; the static scan is also runnable directly
// via `node scripts/static-scan-mcp-removed.mjs` for pre-commit hooks.
//
// Invariants (from the tech-doc):
//   1. No SKILL.md / reference file contains the deleted `peaks mcp *` verbs.
//   2. No SKILL.md file contains a baked MCP prefix (mcp__playwright__ etc.).
//   3. src/cli/program.ts does NOT import from ./commands/mcp-commands.js.
//   4. src/services/mcp/ directory does NOT exist on disk.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SCAN_SCRIPT = join(REPO_ROOT, 'scripts', 'static-scan-mcp-removed.mjs');
const MCP_SERVICE_DIR = join(REPO_ROOT, 'src', 'services', 'mcp');
const PROGRAM_TS = join(REPO_ROOT, 'src', 'cli', 'program.ts');
const SKILL_DIR = join(REPO_ROOT, 'skills');

const FORBIDDEN_VERBS = [
  'peaks mcp plan',
  'peaks mcp apply',
  'peaks mcp call',
  'peaks mcp list',
  'peaks mcp rollback',
  'peaks mcp scan',
  'mcp-install-registry',
];

const BAKED_PREFIXES = [
  'mcp__playwright__',
  'mcp__chrome_devtools__',
  'mcp__Figma_AI_Bridge__',
  'mcp__plugin_context7_context7__',
];

function listSkillFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = join(root, entry.name, 'SKILL.md');
    if (existsSync(skillMd)) out.push(skillMd);
    const refsDir = join(root, entry.name, 'references');
    if (existsSync(refsDir)) {
      for (const refEntry of readdirSync(refsDir, { withFileTypes: true })) {
        if (refEntry.isFile() && refEntry.name.endsWith('.md')) {
          out.push(join(refsDir, refEntry.name));
        }
      }
    }
  }
  return out;
}

describe('mcp-subsystem-removed (slice #016)', () => {
  test('static scan script exists at scripts/static-scan-mcp-removed.mjs', () => {
    expect(existsSync(SCAN_SCRIPT)).toBe(true);
  });

  test('static scan script exits 0 (all 4 invariants pass)', () => {
    // Run the scanner directly; the test wrapper asserts the same 4
    // invariants below for granular failure messages.
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execFileSync(process.execPath, [SCAN_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        stdio: 'pipe'
      });
    } catch (err) {
      exitCode = (err as { status?: number }).status ?? 1;
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    expect({ exitCode, stdout }).toEqual({
      exitCode: 0,
      stdout: expect.stringContaining('mcp-subsystem-removed scan OK'),
    });
  });

  test('invariant 1 — no skill / reference file contains forbidden peaks mcp verbs', () => {
    const files = listSkillFiles(SKILL_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const verb of FORBIDDEN_VERBS) {
        expect(
          text.includes(verb),
          `${file} should not contain forbidden verb ${verb}`
        ).toBe(false);
      }
    }
  });

  test('invariant 2 — no SKILL.md file contains a baked MCP prefix', () => {
    const files = listSkillFiles(SKILL_DIR).filter((f) => f.endsWith('SKILL.md'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const prefix of BAKED_PREFIXES) {
        expect(
          text.includes(prefix),
          `${file} should not bake the MCP prefix ${prefix}`
        ).toBe(false);
      }
    }
  });

  test('invariant 3 — src/cli/program.ts does not import or register mcp-commands', () => {
    expect(existsSync(PROGRAM_TS)).toBe(true);
    const text = readFileSync(PROGRAM_TS, 'utf8');
    expect(text.includes(`from './commands/mcp-commands.js'`)).toBe(false);
    expect(text.includes(`from "./commands/mcp-commands.js"`)).toBe(false);
    expect(text.includes('registerMcpCommands')).toBe(false);
  });

  test('invariant 4 — src/services/mcp/ directory does not exist on disk', () => {
    expect(existsSync(MCP_SERVICE_DIR)).toBe(false);
  });
});
