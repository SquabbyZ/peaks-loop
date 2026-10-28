// src/skills/peaks-maker/index.ts
//
// The manifest of the peaks-maker skill: the name and description its
// frontmatter carries, and the body of the document.
//
// WHERE THE DOCUMENT LIVES. `peaks-maker` is a DISTRIBUTED skill: its
// document is `skills/peaks-maker/SKILL.md`, in the same root `skills/` tree
// every other shipped skill lives in — the one directory the installer
// reads (`scripts/install-skills-bundles.mjs`) and the one the registry
// loads (`skillsDir` in `src/services/skills/skill-registry.ts`). It used to
// be a sibling of this file, which is why this module resolved it relative
// to `import.meta.url`.
//
// That relative resolution was what made the published module throw. The
// build compiles `src/**` into `dist/**` but never copies a SKILL.md
// alongside it, so `dist/skills/peaks-maker/index.js` read a file that the
// tarball does not contain and died with ENOENT on import. Resolving through
// `skillsDir` fixes that: the root package ships `skills/**`, so the same
// lookup finds the document in a checkout and in an installed package.
//
// THE FRONTMATTER IS PARSED BY THE REPOSITORY'S PARSER. The copy that lived
// here was a second, line-based frontmatter parser. It could not read the
// block scalar the description now uses (`description: |` plus the indented
// text), so it reported the description as the single character `|` — a
// manifest that validated nothing. `parseFrontmatter` is the parser the
// registry, the plugin manifest and the doctor all use, so the manifest and
// the registry can no longer disagree about what the document says.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { skillsDir } from 'peaks-loop-shared/paths';

import { parseFrontmatter } from '../../shared/frontmatter.js';

/** The maker skill's document, in the distributed skill tree. */
const SKILL_MD = join(skillsDir, 'peaks-maker', 'SKILL.md');

const md = readFileSync(SKILL_MD, 'utf-8');

// The body is everything after the frontmatter. The parser above reads the
// frontmatter; this reads the document it wraps.
const BODY = /^---\r?\n[\s\S]*?\r?\n---\r?\n([\s\S]*)$/.exec(md)?.[1] ?? '';

// `parseFrontmatter` throws when `name` or `description` is missing or
// empty, so a malformed document is refused here rather than published.
const metadata = parseFrontmatter(md);

export const peaksMakerManifest = {
  name: metadata.name,
  description: metadata.description,
  body: BODY
};
