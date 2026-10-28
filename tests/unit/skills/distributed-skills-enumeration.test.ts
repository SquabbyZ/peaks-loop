// tests/unit/skills/distributed-skills-enumeration.test.ts
//
// WHAT THIS FILE PINS. `peaks-mut` and `peaks-maker` are DISTRIBUTED skills:
// their documents live under the root `skills/` tree, which is the only
// directory the installer reads (`scripts/install-skills-bundles.mjs` collects
// `join(packageRoot, 'skills')` and nothing else) and the only directory the
// package ships (`package.json#files` names `skills/**`).
//
// The claim is NOT "a file exists at `skills/peaks-mut/SKILL.md`". A document
// under `skills/` that the installer's enumeration does not name is
// installed by nothing, and a document under `src/` is shipped by nothing.
// So the assertions here are made against the two things that decide the
// outcome: the ENUMERATION (the names the installer would reconcile) and the
// PACK LIST (what the published tarball actually carries).
//
// FOUR FACTS, FOUR ASSERTIONS.
//
//   1. THE ENUMERATION NAMES BOTH SKILLS. The installer's own
//      `collectSkillCandidates` — reached through the installer's typed
//      entry point, `scripts/install-skills.mjs` — is called over the real
//      package tree, and its result must carry `peaks-mut` and
//      `peaks-maker`. Every candidate must also resolve inside the root
//      `skills/` tree, so no candidate can point back into `src/`.
//
//   2. THE PACK LIST CARRIES BOTH DOCUMENTS AND NOTHING FROM `src/skills/`.
//      `npm pack --dry-run --ignore-scripts --json` is the tarball's own
//      file list, so this asserts the published shape rather than a proxy
//      for it: the two documents are in the tarball, and the tarball
//      carries no file from the tree they moved out of.
//
//   3. BOTH PARSERS READ THE SAME DESCRIPTION. A strict YAML parser
//      (`parse` from `yaml`) and the repository's own line-based
//      `parseFrontmatter` are the two readers of a skill's frontmatter: the
//      first is what a skill loader uses, the second is what the registry,
//      the plugin manifest and the doctor use. The maker's description
//      carries a colon, which is what made the unquoted form unparseable;
//      the block-scalar form is the one both readers accept, and they must
//      agree on the text.
//
//   4. THE MANIFEST MODULE STILL RESOLVES THE DOCUMENT. `peaksMakerManifest`
//      was kept (rather than dropped) because it is a published module; it
//      now resolves the SKILL.md through `skillsDir` — the same constant the
//      registry loads the tree from — so the compiled copy in `dist/` finds
//      the document in a checkout AND in an installed package.
//
// Dimensions covered:
//   - behavior:    the enumeration the installer reconciles; the manifest's
//                  resolved name and description
//   - integration: the real package tree on disk, the real installer module,
//                  the real `npm pack` file list, the real frontmatter parsers
//   - render:      OMITTED — no human-facing output is produced here
//   - a11y:        OMITTED — no text, exit code or message is asserted here
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/distributed-skills-enumeration.test.ts

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { collectSkillCandidates } from '../../../scripts/install-skills.mjs';
import { resolveNpmInvocation } from '../../../scripts/_release-shared.mjs';
import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { parseFrontmatter } from '../../../src/shared/frontmatter.js';

declareDimensions(
  'tests/unit/skills/distributed-skills-enumeration.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no human-facing output is produced here' },
    { dim: 'a11y', reason: 'no text, exit code or message is asserted here' }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const SKILLS_ROOT = join(REPO_ROOT, 'skills');
const MAKER_SKILL_MD = join(SKILLS_ROOT, 'peaks-maker', 'SKILL.md');
const MUT_SKILL_MD = join(SKILLS_ROOT, 'peaks-mut', 'SKILL.md');

/** The frontmatter of `file`, read by the strict YAML parser. */
function strictFrontmatter(file: string): { name: string; description: string } {
  const src = readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const frontmatter = m?.[1];
  if (frontmatter === undefined) throw new Error(`${file} has no frontmatter`);
  const parsed = parseYaml(frontmatter) as { name?: unknown; description?: unknown } | null;
  if (typeof parsed?.name !== 'string' || typeof parsed?.description !== 'string') {
    throw new Error(`${file} has no usable name or description`);
  }
  return { name: parsed.name, description: parsed.description };
}

/**
 * The file list the published tarball would carry.
 *
 * `npm pack --dry-run --json` IS that list — npm resolves `package.json#files`
 * against the tree and prints the result — so this is the published shape, not
 * a proxy for it. `--ignore-scripts` keeps the `prepack` build pipeline out of
 * it, and `--dry-run` writes no tarball. The invocation goes through
 * `resolveNpmInvocation`, which resolves npm's own JS entry and runs it with
 * `process.execPath`: no shell, so nothing in the argv is re-parsed.
 */
function packedFilePaths(): string[] {
  const { bin, prefixArgs } = resolveNpmInvocation();
  const result = spawnSync(
    bin,
    [...prefixArgs, 'pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }
  );
  if (result.error) throw new Error(`npm pack could not run: ${result.error.message}`);
  if (result.status !== 0) {
    throw new Error(`npm pack exited with ${result.status}: ${result.stderr ?? ''}`);
  }
  const parsed = JSON.parse(result.stdout) as Array<{ files?: Array<{ path?: string }> }>;
  return (parsed[0]?.files ?? []).map((file) => file.path ?? '');
}

describe('Scenario: behavior — the installer enumerates both distributed skills', () => {
  it('when the installer enumerates the package skill tree, should name peaks-mut and peaks-maker', () => {
    // given: the root `skills/` tree — the one directory the installer reads
    // when: the installer's own candidate enumeration runs over it
    // then: the enumeration names both skills, and every candidate lives
    //       inside that tree, so nothing points back into `src/`
    const candidates = collectSkillCandidates(SKILLS_ROOT);
    const names = candidates.map((candidate) => candidate.skillName);

    expect(names).toContain('peaks-mut');
    expect(names).toContain('peaks-maker');

    const outside = candidates
      .map((candidate) => relative(SKILLS_ROOT, candidate.sourcePath))
      .filter((path) => path.startsWith('..'));
    expect(outside).toEqual([]);
  });

  it('when the enumeration is counted, should hold the whole shipped skill set', () => {
    // given: the enumeration the installer would reconcile
    // when: it is counted and compared with the documents on disk
    // then: it holds every SKILL.md under the tree — no document is invisible
    //       to the installer, and no candidate is a phantom
    const candidates = collectSkillCandidates(SKILLS_ROOT);
    expect(candidates).toHaveLength(25);
    expect(candidates.map((candidate) => candidate.skillName).sort()).toEqual([
      'peaks-audit',
      'peaks-code',
      'peaks-content',
      'peaks-doctor',
      'peaks-final-review',
      'peaks-ide',
      'peaks-issue-fix-orchestrator',
      'peaks-maker',
      'peaks-mut',
      'peaks-perf-audit',
      'peaks-prd',
      'peaks-qa',
      'peaks-race-code',
      'peaks-rd',
      'peaks-resume',
      'peaks-reviewer',
      'peaks-sc',
      'peaks-security-audit',
      'peaks-slice-decompose',
      'peaks-solo',
      'peaks-sop',
      'peaks-status',
      'peaks-test',
      'peaks-txt',
      'peaks-ui'
    ]);
  });
});

describe('Scenario: integration — the published tarball carries both documents', () => {
  it(
    'when the package is packed, should carry both documents and nothing from src/skills/',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the package as it would be published
      // when: npm packs it and reports the file list
      // then: the list carries both moved documents, and carries NO file from
      //       the tree they moved out of — the old copies cannot ship
      const paths = packedFilePaths();

      expect(paths).toContain('skills/peaks-mut/SKILL.md');
      expect(paths).toContain('skills/peaks-maker/SKILL.md');
      expect(paths.filter((path) => path.startsWith('src/skills/'))).toEqual([]);
    }
  );
});

describe('Scenario: integration — both frontmatter parsers read the moved documents', () => {
  it('when the maker frontmatter is read by both parsers, should describe the same skill', () => {
    // given: the maker document in its new home, whose description carries a
    //        colon — the shape an unquoted YAML value cannot hold
    // when: a strict YAML parser and the repository's parser both read it
    // then: both name the skill and both read the SAME description text
    const strict = strictFrontmatter(MAKER_SKILL_MD);
    const repository = parseFrontmatter(readFileSync(MAKER_SKILL_MD, 'utf-8'));

    expect(strict.name).toBe('peaks-maker');
    expect(repository.name).toBe('peaks-maker');
    // The block scalar keeps the description text verbatim; the strict
    // reader additionally carries the trailing newline a `|` block ends
    // with, and the repository's parser trims it. That newline is the ONLY
    // difference — the text itself is the same one the document always had.
    expect(strict.description.trimEnd()).toBe(repository.description);
    expect(repository.description).toContain('peaks skill sediment');
  });

  it('when the mut frontmatter is read by both parsers, should describe the same skill', () => {
    // given: the mut document in its new home
    // when: a strict YAML parser and the repository's parser both read it
    // then: both name the skill and both read the SAME description text
    const strict = strictFrontmatter(MUT_SKILL_MD);
    const repository = parseFrontmatter(readFileSync(MUT_SKILL_MD, 'utf-8'));

    expect(strict.name).toBe('peaks-mut');
    expect(repository.name).toBe('peaks-mut');
    expect(repository.description).toBe(strict.description);
  });

  it('when the maker manifest module is imported, should resolve the moved document', async () => {
    // given: the manifest module, kept because it is a published module
    // when: it is imported, so it resolves the SKILL.md from its new home
    // then: it names the skill and carries the description the frontmatter
    //       declares — the module no longer reads a file the tarball lacks
    const { peaksMakerManifest } =
      (await import('../../../src/skills/peaks-maker/index.js')) as unknown as {
        peaksMakerManifest: { name: string; description: string; body: string };
      };

    const strict = strictFrontmatter(MAKER_SKILL_MD);
    expect(peaksMakerManifest.name).toBe('peaks-maker');
    expect(peaksMakerManifest.description).toBe(strict.description.trimEnd());
    expect(peaksMakerManifest.body).toContain('# Peaks-Maker');
  });
});
