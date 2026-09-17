// The managed `.gitignore` snippet was inert in every project, and no test
// noticed for four release cycles.
//
// A gitignore pattern containing a slash is anchored to the directory of the
// .gitignore file that holds it. The snippet's two patterns are written
// project-root-relative, but `upsertPeaksGitignoreSnippet` appended them to
// `.peaks/.gitignore`, where they resolved to
// `.peaks/.claude/settings.local.json` and `.peaks/.peaks/...` — matching
// nothing. The root-level `settings.local.json` entry could not have been
// expressed from inside `.peaks/` at all, since gitignore has no `..`.
//
// The consequence, observed on this repo: `.peaks/.claude-settings-template.json`
// stayed tracked, was refreshed on every init, showed as "modified" on every
// release bump, and was reverted three times as a suspected machine-path leak
// that it never was.
//
// Asserting the pattern STRING would not have caught this — the string looked
// right. These cases assert the pattern's EFFECT.
//
// Run with: pnpm vitest run tests/unit/workspace/gitignore-snippet-matches.test.ts

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { materializeClaudeSettingsLocal } from '~/src/services/workspace/workspace-claude-settings-materializer';

/**
 * `windowsHide: true` is repo convention for every spawn, and it matters
 * here: without it this test flashes a console window per pattern on Windows.
 */
function git(args: readonly string[], cwd: string) {
  return spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
}

async function materializedProject(): Promise<{ root: string; patterns: string[] }> {
  const root = mkdtempSync(join(tmpdir(), 'peaks-gitignore-'));
  git(['init', '-q'], root);
  await materializeClaudeSettingsLocal(root, false);
  const patterns = readFileSync(join(root, '.gitignore'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
  return { root, patterns };
}

describe('the managed gitignore snippet ignores the paths it names', () => {
  it('writes its snippet to the root .gitignore, not .peaks/', async () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-gitignore-'));
    git(['init', '-q'], root);
    await materializeClaudeSettingsLocal(root, false);

    const rootEntries = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(rootEntries).toContain('.claude/settings.local.json');
    expect(rootEntries).toContain('.peaks/.claude-settings-template.json');
  });

  it('every emitted pattern actually ignores the path it names', async () => {
    const { root, patterns } = await materializedProject();
    expect(patterns.length).toBeGreaterThan(0);

    for (const pattern of patterns) {
      // Materialize the path the pattern names, so check-ignore has a target
      // that is not already the .gitignore itself.
      const target = join(root, pattern);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, '', 'utf8');

      const result = git(['check-ignore', '--no-index', '-q', pattern], root);
      expect(result.status, `pattern "${pattern}" fails to ignore "${pattern}"`).toBe(0);
    }
  });

  it('the offline template copy is ignored, which is what kept it out of git', async () => {
    const { root } = await materializedProject();
    // The specific regression: this file is machine-specific (it embeds the
    // installed peaks-loop path) and regenerated every init. Tracked, it read
    // as a leak on every release bump.
    const result = git(['check-ignore', '--no-index', '-q', '.peaks/.claude-settings-template.json'], root);
    expect(result.status).toBe(0);
  });

  // A3 of rid `2026-09-17-codegraph-msg-and-refresh`. The exposure is
  // downstream-only: THIS repo ignores `.codegraph/` wholesale, but a consumer
  // project does not, and neither upstream's own `.codegraph/.gitignore`
  // (which names *.db / *.db-wal / *.db-shm, cache/, *.log and .dirty only)
  // nor the shipped snippet covered the backup. A committed
  // `.codegraph/config.json.bak` is then replaced under the project by the
  // next repair — every seam writes it: `peaks codegraph init`,
  // `repair-exclude`, `repair-index`, the pre-dispatch preflight and the
  // post-slice auto-refresh.
  //
  // Asserted through git, not by reading the pattern list: the previous round
  // of this file exists because a pattern that LOOKS right can be inert.
  it('the codegraph rollback copy is ignored — the file every repair seam rewrites', async () => {
    const { root } = await materializedProject();

    const result = git(['check-ignore', '--no-index', '-v', '.codegraph/config.json.bak'], root);

    expect(result.status, `git check-ignore said nothing about .codegraph/config.json.bak`).toBe(0);
    expect(result.stdout).toContain('.codegraph/config.json.bak');
  });

  it('the codegraph config itself stays committable (the backup is the churn, not the policy)', async () => {
    // The narrow half of the same rule: upstream deliberately keeps
    // `config.json` out of its own .gitignore — it is a project's
    // include/exclude policy, and committing it is how a team shares it.
    // Ignoring it would hide a file people mean to commit.
    const { root } = await materializedProject();

    const result = git(['check-ignore', '--no-index', '-q', '.codegraph/config.json'], root);

    expect(result.status).toBe(1); // 1 = not ignored
  });
});

const LEGACY_HEADER = '# >>> peaks-loop managed snippet (slice 2.0.1-bug3) — do not edit by hand';
const LEGACY_FOOTER = '# <<< peaks-loop managed snippet';
const LEGACY_BLOCK = [
  LEGACY_HEADER,
  '# Consumer-project .claude/settings.local.json: written by `peaks workspace init`',
  '.claude/settings.local.json',
  '.peaks/.claude-settings-template.json',
  LEGACY_FOOTER,
].join('\n');

/**
 * The snippet's patterns were written project-root-relative but appended to
 * `.peaks/.gitignore`, where they matched nothing. Existing projects therefore
 * carry a managed block that is inert AND unmaintained, while still claiming
 * "do not edit by hand" — a reader would take it for live configuration.
 * `workspace init` now strips it.
 */
describe('the legacy .peaks/.gitignore snippet is migrated away', () => {
  async function projectWithLegacy(content: string): Promise<string> {
    const root = mkdtempSync(join(tmpdir(), 'peaks-legacy-gi-'));
    mkdirSync(join(root, '.peaks'), { recursive: true });
    writeFileSync(join(root, '.peaks', '.gitignore'), content, 'utf8');
    await materializeClaudeSettingsLocal(root, false);
    return root;
  }

  it('removes the block and deletes the file when nothing else was in it', async () => {
    const root = await projectWithLegacy(`${LEGACY_BLOCK}\n`);
    expect(existsSync(join(root, '.peaks', '.gitignore'))).toBe(false);
  });

  it('preserves every line the user wrote', async () => {
    const root = await projectWithLegacy(`node_modules/\n*.local\n\n${LEGACY_BLOCK}\n`);
    const remaining = readFileSync(join(root, '.peaks', '.gitignore'), 'utf8');
    expect(remaining).toContain('node_modules/');
    expect(remaining).toContain('*.local');
    expect(remaining).not.toContain(LEGACY_HEADER);
  });

  it('leaves a malformed block alone rather than guessing', async () => {
    // Header without footer: deleting someone's file to tidy our own mess is
    // not a trade worth making.
    const malformed = `${LEGACY_HEADER}\nnode_modules/\n`;
    const root = await projectWithLegacy(malformed);
    expect(readFileSync(join(root, '.peaks', '.gitignore'), 'utf8')).toBe(malformed);
  });

  it('is idempotent', async () => {
    const root = await projectWithLegacy(`${LEGACY_BLOCK}\n`);
    await materializeClaudeSettingsLocal(root, false);
    await materializeClaudeSettingsLocal(root, false);
    expect(existsSync(join(root, '.peaks', '.gitignore'))).toBe(false);
  });
});
