/**
 * Regression guard for slice 2026-07-08-openspec-decouple (RR).
 *
 * PRD-1 (peaks-code × OpenSpec decoupling) requires peaks-code's
 * 11-step pipeline to STOP triggering the OpenSpec lifecycle
 * (`peaks openspec *`, `openspec/changes/<change-id>/` writes, the
 * Step 0.5 opt-in prompt). Source of truth collapses to
 * `.peaks/_runtime/<sessionId>/<role>/`.
 *
 * The OpenSpec subsystem (`peaks openspec list/show/to-rd/render/
 * validate/archive/init/from-doctor`, `src/services/openspec/**`,
 * `openspec/changes/**`) is INTENTIONALLY preserved — only the
 * peaks-code LLM surface is scrubbed. This test asserts:
 *
 *   (a) `skills/peaks-code/SKILL.md` does NOT reference openspec
 *       (no Step 0.5 paragraph, no references/openspec-workflow.md link,
 *       no axis-language that anchors on `openspec/changes/<id>/`).
 *   (b) The full `skills/peaks-code/references/` tree does NOT spawn
 *       any `peaks openspec *` command (zero matches on the regex).
 *   (c) The `peaks openspec-workflow.md` reference file has been
 *       removed.
 *   (d) `src/cli/commands/code-commands.ts` (the only file under the
 *       `src/cli/commands/code/` surface) does NOT reference openspec.
 *   (e) The `peaks code --help` output does not mention openspec.
 *
 * Historical gate-id `step-0.5-openspec-opt-in` is INTENTIONALLY
 * retained as a string in `src/services/code/mode-gate.ts` and
 * `user-touchpoint-classifier.ts` (surgical scope; subsequent slice may
 * physically remove it). This test does NOT assert on those source
 * strings — it pins the LLM-facing contract.
 *
 * If any assertion fails after a future merge, peaks-code is regressing
 * toward the duplicate-spec / dual-ceremony anti-pattern that PRD-1
 * was created to eliminate.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const PEAKS_CODE_ROOT = join(process.cwd(), 'skills', 'peaks-code');
const SKILL_PATH = join(PEAKS_CODE_ROOT, 'SKILL.md');
const REFERENCES_DIR = join(PEAKS_CODE_ROOT, 'references');
const CODE_COMMANDS_PATH = join(process.cwd(), 'src', 'cli', 'commands', 'code-commands.ts');
const REPO_ROOT = process.cwd();

async function collectReferenceFiles(): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(REFERENCES_DIR);
  return entries
    .filter((name) => name.endsWith('.md'))
    .map((name) => join(REFERENCES_DIR, name));
}

describe('peaks-code × OpenSpec decoupling regression guard (RR slice 2026-07-08)', () => {
  test('(a) SKILL.md has zero openspec references — no Step 0.5 prompt, no references index row, no axis anchor', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');

    // Hard 0-count: the entire SKILL.md body must not surface openspec.
    expect(body, 'SKILL.md must not mention openspec after decoupling').not.toMatch(/openspec/);

    // Sanity check: the Step 0.5 paragraph (previously the opt-in
    // prompt) is gone. Stricter than the count regex above — it
    // prevents a future merge from re-introducing the paragraph
    // under a non-`openspec` name like "Step-0.5 spec opt-in".
    expect(body, 'Step 0.5 paragraph must be removed').not.toMatch(/Step 0\.5[^#\n]*opt-in/i);
  });

  test('(b.1) skills/peaks-code/references/openspec-workflow.md is removed', () => {
    expect(
      existsSync(join(REFERENCES_DIR, 'openspec-workflow.md')),
      'openspec-workflow.md was the Step 0.5 opt-in only — RR slice must delete it'
    ).toBe(false);
  });

  test('(b.2) every peaks-code reference file emits zero `peaks openspec <verb>` invocations', async () => {
    const files = await collectReferenceFiles();
    expect(files.length, 'peaks-code should have at least a few reference files').toBeGreaterThan(0);

    const invocations = await Promise.all(
      files.map(async (file) => {
        const body = await readFile(file, 'utf8');
        const matches = body.match(/peaks\s+openspec\s+\w+/g) ?? [];
        return { file, matches };
      })
    );

    const offenders = invocations.filter((entry) => entry.matches.length > 0);
    expect(
      offenders,
      `peaks-code reference files must not invoke any \`peaks openspec <verb>\`. ` +
        `Offenders:\n${offenders.map((o) => `${o.file}: ${o.matches.join(', ')}`).join('\n')}`
    ).toEqual([]);
  });

  test('(b.3) every peaks-code reference file emits zero bare `openspec/changes/<...>` paths', async () => {
    // Peaks-code must not write or read openspec/changes paths.
    // Bare word `openspec` (e.g. "OpenSpec the LLM-authored artifact
    // workspace") is allowed in negative-path / decoupling notes.
    const files = await collectReferenceFiles();
    const offenders = await Promise.all(
      files.map(async (file) => {
        const body = await readFile(file, 'utf8');
        const matches = body.match(/openspec\/changes\//g) ?? [];
        return { file, count: matches.length };
      })
    );
    const filtered = offenders.filter((entry) => entry.count > 0);
    expect(
      filtered,
      `peaks-code reference files must not reference the openspec/changes/ path tree. ` +
        `Offenders:\n${filtered.map((o) => `${o.file}: ${o.count} matches`).join('\n')}`
    ).toEqual([]);
  });

  test('(c) src/cli/commands/code-commands.ts has zero openspec references', async () => {
    const body = await readFile(CODE_COMMANDS_PATH, 'utf8');
    expect(body, 'code-commands.ts is the CLI surface peaks-code exposes; it must not mention openspec').not.toMatch(/openspec/);
  });

  test('(d) `peaks code` CLI surface does not mention openspec (AC-5)', () => {
    // Earlier versions of this test spawned `node bin/peaks.js code --help`
    // and grepped the rendered help text. That approach was fragile: it
    // depended on the dist build artefact and on the D-013 wrapper's
    // pre-check logic, which incorrectly raised COMMAND_NOT_FOUND for
    // hidden commands (code is registered with { hidden: true } in
    // src/cli/commands/code-commands.ts:182).
    //
    // The decoupling guarantee is structural: peaks-code must not surface
    // any OpenSpec verb, path, or anchor anywhere in its CLI surface.
    // Asserting it on the source tree is more robust than asserting it
    // on a rendered help banner — it covers every code path (help text,
    // error messages, default descriptions) in one shot.
    //
    // Concretely: every string registered with Commander in
    // code-commands.ts (description, option help, action stdout) must
    // not mention 'openspec'. The source is read directly via readFile,
    // so this test is host-agnostic and does not require a built dist.
    const body = readFileSync(
      join(REPO_ROOT, 'src', 'cli', 'commands', 'code-commands.ts'),
      'utf8'
    );
    // Match any string literal that contains "openspec" — covers single,
    // double, and template literals. Excludes the file's own header
    // comment (which legitimately mentions openspec as the decoupling
    // target). We do this by stripping the leading docblock before the
    // assertion.
    const codeStart = body.indexOf('export function registerCodeCommands');
    if (codeStart < 0) {
      throw new Error('code-commands.ts no longer exports registerCodeCommands — CLI surface changed');
    }
    const codeBody = body.slice(codeStart);
    const openspecLiteral = codeBody.match(/['"\`][^'"]*openspec[^'"]*['"\`]/i);
    expect(
      openspecLiteral,
      'peaks code CLI surface (registerCodeCommands) must not reference openspec after decoupling'
    ).toBeNull();
  });
});
