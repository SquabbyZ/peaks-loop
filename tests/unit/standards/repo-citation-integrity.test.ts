// tests/unit/standards/repo-citation-integrity.test.ts
//
// Reference-integrity guard: every repo-relative path written in backticks in
// the normative documents must resolve on disk.
//
// WHY. When a cited file is deleted, the citation that points at it does not
// change: it keeps reading exactly like a live one. Three such citations
// survived in this repo for weeks —
//   - `CLAUDE.md` + `.peaks/PROJECT.md` cited a vitest guard deleted in
//     `457b9a87` as a live enforcement layer ("will fail the suite");
//   - `.peaks/standards/loop-engineering-guidelines.md` cited its own deleted
//     test as "exercised by";
//   - the same file cited a design spec retired in `e6e35842` as "Inherits
//     from".
// Nothing in the suite could notice any of them. This guard is the notice.
//
// SCOPE (deliberately bounded). Corpus: `CLAUDE.md`, `.peaks/PROJECT.md`,
// `README.md`, and every `*.md` under `.peaks/standards/`. Not in scope: memory
// files, `skills/**`, and `CHANGELOG.md`-style prose — those cite paths relative
// to their own directory (e.g. `../peaks-rd/references/x.md` from inside a skill
// dir) or describe historical state, so a repo-root resolution would report
// mostly false positives and the guard would be trained away.
//
// A candidate is a backtick span that (a) looks like a path — slash-separated
// segments, no spaces, no `<placeholder>`, no glob — and (b) either carries a
// file extension or sits under a repo-root anchor directory. That pair of rules
// is what separates a path citation from `TODO/FIXME/XXX` (a category label) and
// `pnpm/action-setup@v4` (a GitHub Action ref, excluded by the `@`).
//
// Two classes are exempt by construction, not by an allowlist:
//   - `.peaks/_runtime/**` is gitignored session state; its contents are
//     per-session and mostly absent by design;
//   - anything the root `.gitignore` matches is by definition a path git is
//     told never to track, so the tree is not required to contain it
//     (e.g. `.peaks/preferences.json`).
// The one literal exemption is `OPTIONAL_RUNTIME_PATHS`, each entry carrying
// its reason.
//
// Dimensions covered:
//   - behavior:    the pure checker flags a dangling citation and clears a
//                  resolvable one (both controls live in this file, so the
//                  guard cannot pass by being unable to fail)
//   - integration: the real corpus is read off the real working tree
//   - render:      OMITTED — the checker returns data, it renders nothing
//   - a11y:        OMITTED — no human-facing surface; findings are reported
//                  through the assertion message

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/standards/repo-citation-integrity.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the checker returns findings; it renders nothing' },
    { dim: 'a11y', reason: 'no human-facing surface; findings surface in the assertion message' },
  ],
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

/** The normative documents that cite repo paths. */
const CORPUS_ENTRIES = ['CLAUDE.md', '.peaks/PROJECT.md', 'README.md'] as const;
const CORPUS_DIRS = ['.peaks/standards'] as const;

/** A backtick span must look like this to be treated as a path citation. */
const PATH_SHAPED = /^[A-Za-z0-9_.@-]+(?:\/[A-Za-z0-9_.@-]+)+$/;
const REPO_ANCHORS = /^(\.peaks|\.claude|\.github|src|tests|docs|scripts|skills|packages|bin|openspec)\//;
const FILE_EXTENSION = /\.(md|ts|tsx|js|mjs|cjs|json|ya?ml|sh|py|txt|sql|toml)$/;
const BACKTICK_SPAN = /`([^`\n]+)`/g;

/**
 * Paths that are documented by design and legitimately absent from a checkout.
 * Each entry needs a reason; an allowlist without one is how a guard dies.
 */
const OPTIONAL_RUNTIME_PATHS = new Set([
  // Legacy fallback location of the active-skill marker. `.peaks/PROJECT.md`
  // and `CLAUDE.md` both document the lookup as canonical-first; the canonical
  // path is `.peaks/_runtime/active-skill.json`, so this one is absent in a
  // clean clone by design.
  '.peaks/.active-skill.json',
]);

/** Every markdown file in the corpus, absolute paths, repo-relative order. */
export function corpusFiles(repoRoot: string): string[] {
  const files: string[] = CORPUS_ENTRIES.map((rel) => join(repoRoot, rel)).filter((abs) => existsSync(abs));
  const walk = (relDir: string): void => {
    const absDir = join(repoRoot, relDir);
    if (!existsSync(absDir)) return;
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const rel = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith('.md')) files.push(join(repoRoot, rel));
    }
  };
  for (const dir of CORPUS_DIRS) walk(dir);
  return files;
}

function isCandidate(span: string): boolean {
  if (!PATH_SHAPED.test(span)) return false; // excludes `<sid>` placeholders and globs
  if (span.includes('@')) return false; // npm / GitHub-Action refs
  if (span.startsWith('.peaks/_runtime/')) return false; // per-session, gitignored
  if (OPTIONAL_RUNTIME_PATHS.has(span)) return false;
  return REPO_ANCHORS.test(span) || FILE_EXTENSION.test(span);
}

/**
 * Pure checker: every path-shaped backtick span in `texts` must satisfy
 * `exists`. Returns `"<text-id>:<line> cites <path>"` for each dangling one.
 */
export function findDanglingCitations(
  texts: ReadonlyArray<{ id: string; body: string }>,
  exists: (relPath: string) => boolean,
): string[] {
  const findings: string[] = [];
  for (const { id, body } of texts) {
    body.split(/\r?\n/).forEach((line, index) => {
      BACKTICK_SPAN.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = BACKTICK_SPAN.exec(line)) !== null) {
        const candidate = (match[1] ?? '').trim();
        if (!isCandidate(candidate)) continue;
        if (exists(candidate)) continue;
        findings.push(`${id}:${index + 1} cites \`${candidate}\``);
      }
    });
  }
  return findings;
}

describe('Scenario: behavior — the checker can fail, and can clear', () => {
  const noPathsExist = (): boolean => false;

  it('when a corpus text cites a path that does not exist, should report it', () => {
    // given: a document citing two repo paths, only one of which exists
    const texts = [{ id: 'FAKE.md', body: 'See `tests/unit/does-not-exist.test.ts` and `src/cli/index.ts`.' }];
    const exists = (rel: string): boolean => rel === 'src/cli/index.ts';

    // when: the corpus is checked
    const findings = findDanglingCitations(texts, exists);

    // then: exactly the dangling citation is reported
    expect(findings).toEqual(['FAKE.md:1 cites `tests/unit/does-not-exist.test.ts`']);
  });

  it('when every cited path exists, should report nothing', () => {
    // given: a document whose citations all resolve (the clean-tree control)
    const texts = [{ id: 'FAKE.md', body: 'See `src/cli/index.ts` and `tests/unit/standards/repo-citation-integrity.test.ts`.' }];

    // when: the corpus is checked
    const findings = findDanglingCitations(texts, (rel) => rel.startsWith('src/') || rel.startsWith('tests/'));

    // then: the guard stays green
    expect(findings).toEqual([]);
  });

  it('when a span is not a path citation, should not treat it as one', () => {
    // given: prose carrying a category label, an action ref, a glob and a
    //        per-session path — plus one real dangling citation as the control
    const texts = [{
      id: 'FAKE.md',
      body: [
        'Categories `TODO/FIXME/XXX`, action `pnpm/action-setup@v4`,',
        'glob `src/**/*.ts`, session `.peaks/_runtime/<sid>/rd/x.md`,',
        'and `docs/gone.md`.',
      ].join('\n'),
    }];

    // when: the corpus is checked with nothing on disk
    const findings = findDanglingCitations(texts, noPathsExist);

    // then: only the real path citation is reported, with its line number
    expect(findings).toEqual(['FAKE.md:3 cites `docs/gone.md`']);
  });
});

describe('Scenario: integration — the real corpus resolves on the real tree', () => {
  it('when the normative documents are read, should cite only paths that exist', () => {
    // given: the real corpus, read off the working tree
    const texts = corpusFiles(REPO_ROOT).map((abs) => ({
      id: abs.slice(REPO_ROOT.length + 1).split('\\').join('/'),
      body: readFileSync(abs, 'utf8'),
    }));

    // when: every path-shaped backtick citation is resolved against the tree
    const findings = findDanglingCitations(texts, (rel) => {
      const abs = join(REPO_ROOT, rel);
      if (existsSync(abs)) return true;
      return isGitIgnored(rel);
    });

    // then: nothing dangles
    expect(findings, `dangling citations:\n${findings.join('\n')}`).toEqual([]);
  });

  it('when the corpus is enumerated, should include the normative documents', () => {
    // given: the corpus definition
    // when: it is enumerated
    const ids = corpusFiles(REPO_ROOT).map((abs) => abs.slice(REPO_ROOT.length + 1).split('\\').join('/'));

    // then: the documents the brief names as normative are all present
    expect(ids).toContain('CLAUDE.md');
    expect(ids).toContain('.peaks/PROJECT.md');
    expect(ids).toContain('README.md');
    expect(ids.filter((id) => id.startsWith('.peaks/standards/')).length).toBeGreaterThan(0);
  });

  it('when the corpus directory is missing, should report an empty corpus rather than throw', () => {
    // given: a root with no `.peaks/standards/` and no top-level documents
    const emptyRoot = join(REPO_ROOT, 'tests', 'unit', '_samples', 'no-such-corpus-root');

    // when: the corpus is enumerated
    const ids = corpusFiles(emptyRoot);

    // then: it comes back empty instead of raising
    expect(ids).toEqual([]);
  });
});

/**
 * The root `.gitignore` is the arbiter of "git is told never to track this".
 * Resolved by reading the file rather than spawning `git`, so the check stays
 * synchronous with the rest of the corpus walk.
 */
function isGitIgnored(relPath: string): boolean {
  const gitignorePath = join(REPO_ROOT, '.gitignore');
  if (!existsSync(gitignorePath)) return false;
  const patterns = readFileSync(gitignorePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return patterns.some((pattern) => {
    const normalized = pattern.replace(/^\/+/, '');
    if (normalized.endsWith('/')) return relPath.startsWith(normalized);
    return relPath === normalized || relPath.startsWith(`${normalized}/`);
  });
}
