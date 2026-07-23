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

// ----------------------------------------------------------------------
// Task 1.7 review follow-ups — additional stale next-action red lines.
// ----------------------------------------------------------------------
// Additional retired / stale next-action strings that runtime + skill prose
// MUST NOT point the LLM at any longer. Assembled from fragments so this
// test source itself doesn't contain the literal substring.
const ADDITIONAL_FORBIDDEN_NEXT_ACTIONS: readonly { id: string; literal: string }[] = [
  // adapter-commands-s2a.ts and runtime-commands.ts previously steered the
  // LLM at the never-existing-by-vendor `peaks runtime compact --via ${id}`
  // path. That verb is retired (Task 1.7, design §13.1 row 5).
  { id: 'peaks-runtime-compact', literal: ['peaks runtime', 'compact'].join(' ') },
  // Vendor-specific hard-coded compact verbs that the adapter layer used to
  // shell-exec. The capability-first control plane (`peaks compact auto`)
  // owns the dispatch; no vendor string should leak into active prose.
  { id: 'claude-compact', literal: ['claude', '--compact'].join(' ') }
];

describe('Task 1.7 review — additional stale next-action strings are retired', () => {
  for (const { id, literal } of ADDITIONAL_FORBIDDEN_NEXT_ACTIONS) {
    it(`does not reference "${literal}" anywhere in active source/docs (id=${id})`, () => {
      const violations: string[] = [];
      for (const file of activeFiles) {
        const content = readFileSync(file, 'utf8');
        if (content.includes(literal)) {
          violations.push(relative(repoRoot, file));
        }
      }
      expect(violations).toEqual([]);
    });
  }
});

// MEDIUM/MINOR review items — assert the three hidden `code *` commands
// now emit DEPRECATED_ALIAS envelopes that point the LLM at
// `peaks compact auto`.
describe('Task 1.7 review — hidden code commands wrap with DEPRECATED_ALIAS', () => {
  const codeCommandsPath = join(srcRoot, 'cli', 'commands', 'code-commands.ts');
  // For each hidden code command, read the file and assert:
  //   - the handler's printResult(...) call wraps with fail('<cmd>',
  //     'DEPRECATED_ALIAS', ...)
  //   - the next-action string `peaks compact auto --project <repo> --json`
  //     is present in the wrapper.
  const cases: ReadonlyArray<{ command: string; nextAction: string }> = [
    {
      command: 'code.auto-compact',
      nextAction: 'Run `peaks compact auto --project <repo> --json` to invoke the capability-first control plane.'
    },
    {
      command: 'code.post-compact-detect',
      nextAction: 'Run `peaks compact auto --project <repo> --json` to invoke the capability-first control plane.'
    },
    {
      command: 'code.context-now',
      nextAction: 'Run `peaks compact auto --project <repo> --json` to invoke the capability-first control plane.'
    }
  ];
  for (const { command, nextAction } of cases) {
    it(`${command} handler wraps the result with fail(... 'DEPRECATED_ALIAS', ...) and points LLM at peaks compact auto`, () => {
      const src = readFileSync(codeCommandsPath, 'utf8');
      // assert: `fail(` followed (within the same handler block) by
      // the command literal, then 'DEPRECATED_ALIAS'.
      const wrapRegex = new RegExp(
        "fail\\(\\s*`?" + command + "`?,\\s*'DEPRECATED_ALIAS'"
      );
      expect(src).toMatch(wrapRegex);
      // assert: the next-action text appears at least once for this command
      expect(src).toContain(nextAction);
    });
  }
});
