// tests/unit/skills/published-status-header-surfaces.test.ts
//
// THE SHIPPED SURFACES AND THE STATUS HEADER ARE ONE CONTRACT WITH TWO COPIES.
//
// WHAT THIS GUARD IS FOR. The status header is a five-cell contract —
// `Skill | Role | Gate | Context | Next` — and it is published on the
// surfaces a user's agent actually reads. Two of those surfaces are shipped
// in the npm package (`package.json#files` names `skills/**` and
// `output-styles/**`), and the shipped `output-styles/peaks-skill-swarm.md`
// is the copy the installer READS: `scripts/install-skills-output-styles.mjs`
// takes the package's own `output-styles/` root and writes it over the IDE's
// style directory. The repository's `.claude/output-styles/peaks-skill-swarm.md`
// is that directory's local copy — an install TARGET, not the source.
//
// The two had drifted. The shipped copy still published the three-segment
// header with NO Role and NO Context, and no tier lists at all, so every
// installed user got the shorter header and the Role and Context cells never
// reached them — while the repository's own copy was already correct. A
// downstream agent reads the shipped file, so a correct local copy proves
// nothing about what users get.
//
// Three facts are therefore held together here, and each one is a way the
// drift can come back:
//
//   1. NO SHORTER HEADER ON ANY SHIPPED SURFACE — every header mention on
//      every shipped markdown file carries the five contract cells. The
//      comparison is by SEGMENT STRUCTURE (the cell labels), never by a
//      literal: the cell values are machine facts that change every turn, and
//      a literal would miss the shapes it was not written for.
//   2. THE SHIPPED COPY IS THE INSTALLED COPY — byte for byte. Two files
//      that are supposed to be one file are one file only if something
//      checks it.
//   3. THE SHIPPED COPY'S TIER LISTS ARE THE CODE'S TIER LISTS — the Role
//      cell is a machine fact read from `presence-role.ts`, so the list that
//      documents the tiers and the list that computes them are the same
//      list.
//
// The exemptions below are the escape hatch, and they are EMPTY BY DESIGN.
// A published surface that intentionally shows the shorter header would name
// itself here with the reason; an unused entry fails the suite, so an
// exemption cannot outlive the thing it excuses.
//
// Dimensions: behavior (how a header run is read and compared), integration
// (the shipped tree, the shipped file and the installer on disk), render (the
// published text of the shipped output style). a11y omitted — the guard
// asserts published text and file bytes; it renders no human-facing surface
// of its own.
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/published-status-header-surfaces.test.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BEE_ROLE_SKILLS,
  ORCHESTRATOR_ROLE_SKILLS
} from '../../../src/services/skills/presence-role.js';

declareDimensions(
  'tests/unit/skills/published-status-header-surfaces.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason:
        'the guard asserts published text and file bytes; it renders no human-facing surface of its own'
    }
  ]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');

/** The five cells of the status header, in contract order. */
const CONTRACT_LABELS: readonly string[] = [
  'Peaks-Loop Skill',
  'Peaks-Loop Role',
  'Peaks-Loop Gate',
  'Peaks-Loop Context',
  'Next'
];

/** The copy the npm package ships — the one the installer reads. */
const PUBLISH_SOURCE = join(REPO_ROOT, 'output-styles', 'peaks-skill-swarm.md');
/** The copy the installer writes — this repository's own install target. */
const INSTALL_TARGET = join(REPO_ROOT, '.claude', 'output-styles', 'peaks-skill-swarm.md');
/** The installer that copies the shipped file over the install target. */
const INSTALLER = join(REPO_ROOT, 'scripts', 'install-skills-output-styles.mjs');

/**
 * The shipped surfaces: the two roots `package.json#files` names.
 *
 * `.claude/**` is NOT one of them — it is an install TARGET, and it is held
 * to the shipped copy by the byte-identity assertion instead.
 */
const PUBLISHED_ROOTS: readonly string[] = [
  join(REPO_ROOT, 'skills'),
  join(REPO_ROOT, 'output-styles')
];

/**
 * Shipped surfaces that intentionally publish a shorter header.
 *
 * EMPTY BY DESIGN: every shipped surface carries the five-cell contract. An
 * entry must name the file and say WHY the shorter shape is correct there —
 * an exemption without a reason is not an exemption — and an entry that no
 * longer matches an offender fails the suite, so a fixed file cannot hide
 * behind a leftover exemption.
 */
const INTENTIONAL_SHORT_HEADERS: ReadonlyMap<string, string> = new Map();

/** Every markdown file under `dir`, sorted. */
function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(full));
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found.sort();
}

/** The repo-relative, POSIX-spelled path of `file`, for a failure message. */
function repoRelative(file: string): string {
  return relative(REPO_ROOT, file).replace(/\\/g, '/');
}

/**
 * The cell's label, or null when the cell is not a header cell.
 *
 * The label is the text before the cell's first colon, compared by NAME. The
 * cell's VALUE never enters the comparison: the values are machine facts
 * (the skill, the tier, the ratio) that differ from turn to turn, and the
 * header is a shape.
 */
function cellLabel(cell: string): string | null {
  const colon = cell.indexOf(':');
  if (colon === -1) return null;
  const label = cell.slice(0, colon).replace(/[`*]/g, '').trim();
  return CONTRACT_LABELS.includes(label) ? label : null;
}

/**
 * The header runs a line publishes.
 *
 * A run STARTS at every `Peaks-Loop Skill:` occurrence and takes the cells
 * that follow while they are header cells. Starting at the literal rather
 * than at a cell boundary is what makes a header embedded in prose
 * ("...the `Peaks-Loop Skill: peaks-code` line...") count as a header: the
 * prose in front of it is not a cell, so a run that started at cell
 * boundaries would miss the header entirely.
 */
function headerRuns(line: string): string[][] {
  const runs: string[][] = [];
  let index = line.indexOf('Peaks-Loop Skill:');
  while (index !== -1) {
    const labels: string[] = [];
    for (const cell of line.slice(index).split('|')) {
      const label = cellLabel(cell);
      if (label === null) break;
      labels.push(label);
    }
    runs.push(labels);
    index = line.indexOf('Peaks-Loop Skill:', index + 1);
  }
  return runs;
}

/** One header a published file publishes. */
interface HeaderMention {
  /** Repo-relative path of the published file. */
  readonly file: string;
  /** 1-based line number. */
  readonly line: number;
  /** The cell labels, in the order the file publishes them. */
  readonly labels: readonly string[];
}

/** Every header mention in a file. */
function headerMentions(file: string): HeaderMention[] {
  const mentions: HeaderMention[] = [];
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((text, index) => {
      for (const labels of headerRuns(text)) {
        mentions.push({ file: repoRelative(file), line: index + 1, labels });
      }
    });
  return mentions;
}

/** The shipped markdown files, across both published roots. */
function publishedFiles(): string[] {
  return PUBLISHED_ROOTS.flatMap((root) => markdownFiles(root));
}

/** The mentions that do NOT carry the five-cell contract. */
function contractOffenders(): HeaderMention[] {
  return publishedFiles()
    .flatMap((file) => headerMentions(file))
    .filter((mention) => mention.labels.join('|') !== CONTRACT_LABELS.join('|'));
}

/**
 * The two tier lists the shipped output style names.
 *
 * Read from the SHIPPED copy, not from the repository's install target: the
 * shipped copy is the one a user's agent reads.
 */
function publishedTiers(source: string): { orchestrator: string[]; bee: string[] } {
  const lines = source.split('\n');
  const pick = (marker: string): string[] => {
    const line = lines.find((l) => l.startsWith(marker));
    if (line === undefined) throw new Error(`the shipped output style has no "${marker}" list`);
    return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
  };
  return {
    orchestrator: pick('- **orchestrator**'),
    bee: pick('- **bee**')
  };
}

describe('Scenario: behavior — the status header has one shape', () => {
  it('when a three-segment header is parsed, should report the cells it is missing', () => {
    // given: a line publishing the three-segment header
    // when: the header runs on that line are read
    // then: the run carries Skill, Gate and Next and neither Role nor Context
    const runs = headerRuns(
      'Then display: `Peaks-Loop Skill: peaks-sop | Peaks-Loop Gate: startup | Next: <one short action>`.'
    );
    expect(runs).toEqual([['Peaks-Loop Skill', 'Peaks-Loop Gate', 'Next']]);
  });

  it('when a five-segment header is parsed, should report the contract labels', () => {
    // given: a line publishing the five-cell contract header
    // when: the header runs on that line are read
    // then: the run carries the five contract labels, in order
    const runs = headerRuns(
      '`Peaks-Loop Skill: <skill> | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`'
    );
    expect(runs).toEqual([[...CONTRACT_LABELS]]);
  });

  it('when a header sits inside prose, should still be found', () => {
    // given: a line whose header sits inside a sentence
    // when: the header runs on that line are read
    // then: the run is found — the prose in front of it is not a cell
    const runs = headerRuns(
      'This keeps the header accurate (`Peaks-Loop Skill: peaks-code | Peaks-Loop Role: <role> | Peaks-Loop Gate: <gate> | Peaks-Loop Context: <ratio%> (<zone>) | Next: <one short action>`) instead of showing a stale role name.'
    );
    expect(runs).toEqual([[...CONTRACT_LABELS]]);
  });
});

describe('Scenario: integration — the shipped surfaces and the install target', () => {
  it('when the published roots are walked, should reach both of them', () => {
    // given: the two roots the package manifest ships
    // when: they are walked for markdown files
    // then: both roots contribute files, and the skill tree contributes more than one
    const skillFiles = markdownFiles(join(REPO_ROOT, 'skills'));
    const styleFiles = markdownFiles(join(REPO_ROOT, 'output-styles'));
    expect(skillFiles.length).toBeGreaterThan(1);
    expect(styleFiles.length).toBeGreaterThan(0);
    expect(publishedFiles().length).toBe(skillFiles.length + styleFiles.length);
  });

  it('when every published header mention is read, should carry the five-cell contract', () => {
    // given: every shipped markdown file
    // when: every header mention in it is read
    // then: each carries the contract's five cells in order — no shorter shape survives
    const offenders = contractOffenders().filter(
      (mention) => !INTENTIONAL_SHORT_HEADERS.has(mention.file)
    );
    expect(
      offenders.map((mention) => `${mention.file}:${mention.line} — ${mention.labels.join(' | ')}`)
    ).toEqual([]);
  });

  it('when the exemptions are read, should carry no stale entry and no missing reason', () => {
    // given: the explicit exemption list for surfaces that intentionally show a shorter header
    // when: each entry is checked against the offenders it claims to excuse
    // then: every entry still matches an offender and states why — an unused exemption is removed
    const offenders = contractOffenders();
    const stale = [...INTENTIONAL_SHORT_HEADERS.keys()].filter(
      (file) => !offenders.some((mention) => mention.file === file)
    );
    expect(stale).toEqual([]);
    const unreasoned = [...INTENTIONAL_SHORT_HEADERS.entries()].filter(
      ([, reason]) => reason.trim().length === 0
    );
    expect(unreasoned).toEqual([]);
  });

  it('when the shipped copy and the install target are compared, should be byte-identical', () => {
    // given: the file the npm package ships and the file the installer writes
    // when: their bytes are compared
    // then: they are identical — the installer writes the shipped file over the target
    const shipped = readFileSync(PUBLISH_SOURCE);
    const installed = readFileSync(INSTALL_TARGET);
    expect(
      shipped.equals(installed),
      'the shipped output style and the install target have drifted — the installer copies the shipped one over the target'
    ).toBe(true);
  });

  it('when the installer and the package manifest are read, should confirm the shipped file is the one that reaches the user', () => {
    // given: the installer that writes the IDE's style directory
    // when: its source and the package manifest's file list are read
    // then: the installer reads the package's own `output-styles/` root — the shipped copy
    const installer = readFileSync(INSTALLER, 'utf8');
    expect(installer).toMatch(/join\(\s*packageRoot\s*,\s*'output-styles'\s*\)/);
    const manifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
      files?: readonly string[];
    };
    expect(manifest.files).toContain('output-styles/**');
    expect(manifest.files).toContain('skills/**');
  });
});

describe('Scenario: render — the published text of the shipped output style', () => {
  it('when the shipped tier lists are read, should name exactly the code lists', () => {
    // given: the shipped output style
    // when: its two tier lists are read
    // then: they name the code lists item for item, in the same order
    const published = publishedTiers(readFileSync(PUBLISH_SOURCE, 'utf8'));
    expect(published.orchestrator).toEqual([...ORCHESTRATOR_ROLE_SKILLS]);
    expect(published.bee).toEqual([...BEE_ROLE_SKILLS]);
  });

  it('when the shipped header is read, should publish the five-cell contract', () => {
    // given: the shipped output style
    // when: its header mentions are read
    // then: it publishes the contract header, and it publishes at least one
    const mentions = headerMentions(PUBLISH_SOURCE);
    expect(mentions.length).toBeGreaterThan(0);
    expect(
      mentions.filter((mention) => mention.labels.join('|') !== CONTRACT_LABELS.join('|'))
    ).toEqual([]);
  });
});
