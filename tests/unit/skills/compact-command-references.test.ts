/**
 * Task 1.7 (design §13.1, §13.2) — active-surface command-reference red line.
 *
 * Statically scans the ACTIVE runtime + shipped-skill surface and fails if
 * any never-existing / retired command string reappears, or if any legacy
 * false-success execution path (host-CLI spawn / hook-install claimed as
 * compact completion) survives.
 *
 * Scope = "active source/docs":
 *   - `src/**\/*.ts`   (runtime code; excludes `*.test.ts`)
 *   - `skills/**\/*.md` (shipped skill prose the LLM reads at runtime)
 *
 * Explicitly OUT of scope (historical archives, analogous to CHANGELOG):
 *   - `docs/superpowers/**`  (design / spec / plan records that DOCUMENT the
 *                             retirement and must name the retired commands)
 *   - `.peaks/memory/**`     (incident archive)
 *   - `CHANGELOG.md`
 *   - `tests/**`             (this and sibling tests assert the retirement and
 *                             therefore reference the strings as patterns)
 *
 * The three forbidden command strings NEVER existed as registered,
 * discoverable commands; runtime `next` fields and SKILL/runbook prose used
 * to tell the LLM to run them. They are replaced by `peaks compact auto`.
 *
 * The forbidden literals are assembled from fragments so this test file does
 * not itself contain the exact string (keeps the gate honest if the scan is
 * ever widened to include tests).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// tests/unit/skills → repo root is three levels up.
const repoRoot = join(here, '..', '..', '..');
const srcRoot = join(repoRoot, 'src');
const skillsRoot = join(repoRoot, 'skills');

// Never-existing / retired command strings, assembled from fragments.
const FORBIDDEN_COMMANDS: readonly string[] = [
  ['peaks session', 'auto-compact', '--execute'].join(' '),
  ['peaks code', 'auto-compact', '--execute'].join(' '),
  ['peaks', 'context', 'now'].join(' ')
];

function collectFiles(dir: string, exts: readonly string[]): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectFiles(full, exts));
    } else if (exts.some((ext) => full.endsWith(ext)) && !full.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const activeFiles: readonly string[] = [
  ...collectFiles(srcRoot, ['.ts']),
  ...collectFiles(skillsRoot, ['.md'])
];

describe('Task 1.7 — no never-existing command strings in active source/docs', () => {
  it('has active files to scan', () => {
    expect(activeFiles.length).toBeGreaterThan(0);
  });

  for (const forbidden of FORBIDDEN_COMMANDS) {
    it(`does not reference "${forbidden}" anywhere in src/** or skills/**`, () => {
      const violations: string[] = [];
      for (const file of activeFiles) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(forbidden)) {
          violations.push(relative(repoRoot, file));
        }
      }
      expect(violations).toEqual([]);
    });
  }

  it('points active surfaces at the real public entry `peaks compact auto`', () => {
    // At least the peaks-code SKILL must cite the real control-plane entry
    // so the LLM has a discoverable command to run.
    const skillMd = readFileSync(join(skillsRoot, 'peaks-code', 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('peaks compact auto');
  });
});

describe('Task 1.7 — legacy false-success execution paths are retired', () => {
  it('deletes the session auto-compact-hook command source file', () => {
    const hookCommand = join(srcRoot, 'cli', 'commands', 'session-auto-compact-hook-command.ts');
    let exists = true;
    try {
      statSync(hookCommand);
    } catch {
      exists = false;
    }
    expect(exists, 'session-auto-compact-hook-command.ts must be deleted').toBe(false);
  });

  it('auto-compact-dispatcher no longer spawns a host CLI (no child_process spawn)', () => {
    const dispatcher = readFileSync(
      join(srcRoot, 'services', 'context', 'auto-compact-dispatcher.ts'),
      'utf8'
    );
    // The dispatcher must not import child_process; the legacy
    // `child_process.spawn('sh', ...)` shape is retired (design §13.2).
    expect(dispatcher).not.toMatch(/from\s+['"]node:child_process['"]/);
    // Strip /** ... */ block comments + // line comments before
    // matching for a real `spawn(` call, so descriptive prose that
    // names the old shape (e.g. in migration comments) does not
    // false-positive.
    const stripped = dispatcher
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bspawn\s*\(/);
  });

  it('auto-compact-orchestrator no longer spawns a host CLI (no child_process spawn)', () => {
    const orchestrator = readFileSync(
      join(srcRoot, 'services', 'code', 'auto-compact-orchestrator.ts'),
      'utf8'
    );
    expect(orchestrator).not.toMatch(/from\s+['"]node:child_process['"]/);
    const stripped = orchestrator
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\bspawn\s*\(/);
  });
});
