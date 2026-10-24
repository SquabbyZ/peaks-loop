// tests/unit/skills/presence-role-coverage.test.ts
//
// THE ROLE CELL AND THE PUBLISHED HEADER ARE ONE CONTRACT WITH TWO COPIES.
//
// The tier of a skill and the status header a downstream agent renders are
// both published in two places: the response contract in
// `.claude/output-styles/peaks-skill-swarm.md`, and the code that projects
// them (`src/services/skills/presence-role.ts` and the contract text in
// `src/services/standards/standards-render-common.ts`). Two copies of one
// fact drift: a skill added to the shipped tree but to neither tier list
// projects a null Role, and a skill document that keeps publishing the
// three-segment header teaches every downstream agent to omit the Role and
// Context cells.
//
// Neither drift makes anything fail on its own. The linter's duty is "is
// there a status header at all", so it accepts the shorter shapes on purpose,
// and a missing tier is a null that renders as a null. The drift is silent,
// which is exactly why it needs a guard: this file walks the real shipped
// skill tree, the real response contract and the real published headers, and
// holds all three to each other.
//
// Dimensions: behavior (the tier of every shipped skill; the two lists do
// not overlap; a skill outside the shipped set has no tier), integration (the
// shipped skill tree, the response contract and AGENTS.md are read from
// disk), render (the published header's segment structure, compared with the
// contract text). a11y omitted — the assertions read published text and tier
// values; the guard renders no human-facing surface of its own.
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/presence-role-coverage.test.ts

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  BEE_ROLE_SKILLS,
  ORCHESTRATOR_ROLE_SKILLS,
  presenceRoleTier
} from '../../../src/services/skills/presence-role.js';
import { PRESENCE_CONTRACT_TEXT } from '../../../src/services/standards/standards-render-common.js';

declareDimensions(
  'tests/unit/skills/presence-role-coverage.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason:
        'the assertions read published text and tier values; the guard renders no human-facing surface of its own'
    }
  ]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SKILLS_DIR = join(REPO_ROOT, 'skills');
const SWARM_DOC = join(REPO_ROOT, '.claude', 'output-styles', 'peaks-skill-swarm.md');
const AGENTS_MD = join(REPO_ROOT, 'AGENTS.md');
const MARKER = '<!-- peaks:loop-hygiene';
const END_MARKER = '<!-- /peaks:loop-hygiene -->';

/**
 * Walk with `fs`, never a hardcoded name list.
 *
 * A pinned list is the defect this guard exists to catch: the twenty-third
 * skill landed, the list still said twenty-two, and the guard stayed green
 * because it never looked. The population has to come from the tree.
 */
function skillFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...skillFiles(full));
    else if (entry.name === 'SKILL.md') found.push(full);
  }
  return found.sort();
}

/** The skill's own name, read from its frontmatter — the name the CLI reports. */
function skillName(file: string): string {
  const src = readFileSync(file, 'utf8');
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
  const frontmatter = m?.[1];
  if (frontmatter === undefined) throw new Error(`${file} has no frontmatter`);
  const parsed = parseYaml(frontmatter) as { name?: unknown } | null;
  const name = parsed?.name;
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`${file} carries no usable frontmatter name`);
  }
  return name;
}

/**
 * Extract the loop-hygiene block by its explicit delimiters.
 *
 * What follows the block differs per skill, so a heading-based boundary would
 * report drift that is not drift.
 */
function extractBlock(src: string): string | null {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(MARKER));
  if (start === -1) return null;
  const end = lines.indexOf(END_MARKER, start);
  if (end === -1) return null;
  return lines.slice(start, end + 1).join('\n');
}

/**
 * The status-header line the loop-hygiene block publishes, or null when it
 * publishes none.
 */
function blockHeaderLine(src: string): string | null {
  const block = extractBlock(src);
  if (block === null) return null;
  const line = block.split('\n').find((l) => l.includes('`Peaks-Loop Skill:'));
  return line ?? null;
}

/** The status-header line a source publishes anywhere, or null when it publishes none. */
function headerLine(src: string): string | null {
  const line = src.split('\n').find((l) => l.includes('`Peaks-Loop Skill:'));
  return line ?? null;
}

/**
 * The segment labels of a published header, in order.
 *
 * A label is the cell's name, so the shape is compared as `Skill | Role |
 * Gate | Context | Next` rather than as a literal string — the cell values
 * are placeholders in every copy, and a shape assertion that compared values
 * would pass on a header whose cells were in the wrong order.
 */
function segments(header: string): string[] {
  const span = /`Peaks-Loop Skill:[^`]*`/.exec(header)?.[0] ?? '';
  return span
    .replace(/`/g, '')
    .split('|')
    .map((cell) => (cell.split(':')[0] ?? '').trim());
}

/** The labels of the header the contract text publishes, in order. */
function contractSegments(): string[] {
  return segments(PRESENCE_CONTRACT_TEXT);
}

/** The skill names the response contract's two tier lists name. */
function docTiers(): { orchestrator: string[]; bee: string[] } {
  const lines = readFileSync(SWARM_DOC, 'utf8').split('\n');
  const pick = (marker: string): string[] => {
    const line = lines.find((l) => l.startsWith(marker));
    if (line === undefined) throw new Error(`the response contract has no "${marker}" list`);
    return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '');
  };
  return {
    orchestrator: pick('- **orchestrator**'),
    bee: pick('- **bee**')
  };
}

describe('(behavior) the tier of every skill this repository ships', () => {
  it('when every shipped skill is asked for its tier, should report a tier', () => {
    // given: the skill tree as it is on disk
    // when: each shipped skill is asked for its tier
    // then: every one of them has a tier — no shipped skill projects a null Role
    const files = skillFiles(SKILLS_DIR);
    // The population has to be non-empty, or "none of them lacks a tier" is
    // true of a tree that was never read.
    expect(files.length).toBeGreaterThan(0);
    const untiered = files
      .map((f) => skillName(f))
      .filter((name) => presenceRoleTier(name) === null);
    expect(untiered).toEqual([]);
  });

  it('when the two tier lists are compared, should share no skill', () => {
    // given: the orchestrator list and the bee list
    // when: they are compared
    // then: no skill is in both — a skill has exactly one tier
    const overlap = ORCHESTRATOR_ROLE_SKILLS.filter((skill) => BEE_ROLE_SKILLS.includes(skill));
    expect(overlap).toEqual([]);
  });

  it('when a skill outside the shipped tree is asked for its tier, should report no tier', () => {
    // given: a skill name the family does not name
    // when: its tier is asked for
    // then: the answer is null — the list is closed, and it never guesses
    expect(presenceRoleTier('peaks-not-a-skill')).toBeNull();
    expect(presenceRoleTier('')).toBeNull();
  });
});

describe('(integration) the code lists and the response contract hold each other', () => {
  it('when the contract lists are read, should name exactly the code lists', () => {
    // given: the two tier lists in the response contract document
    // when: they are compared with the two tier lists in code
    // then: they are equal, item for item — one authority, two copies
    const doc = docTiers();
    expect([...doc.orchestrator].sort()).toEqual([...ORCHESTRATOR_ROLE_SKILLS].sort());
    expect([...doc.bee].sort()).toEqual([...BEE_ROLE_SKILLS].sort());
  });

  it('when the tier lists are counted, should cover the shipped skills exactly', () => {
    // given: the skill tree as it is on disk
    // when: the two tier lists are counted against it
    // then: the lists hold every shipped skill once — no extra, none missing
    const shipped = skillFiles(SKILLS_DIR)
      .map((f) => skillName(f))
      .sort();
    const tiered = [...ORCHESTRATOR_ROLE_SKILLS, ...BEE_ROLE_SKILLS].sort();
    expect(tiered).toEqual(shipped);
  });
});

describe('(render) the published status header has the contract segment shape', () => {
  it('when every skill document is read, should publish the contract segment shape', () => {
    // given: every skill document in the shipped tree
    // when: the status header each one publishes is read
    // then: every one of them has the contract's segments, in the contract's order
    const expected = contractSegments();
    // The expected shape has to be the five-segment one, or a header that
    // published nothing would match it.
    expect(expected.join('|')).toBe(
      'Peaks-Loop Skill|Peaks-Loop Role|Peaks-Loop Gate|Peaks-Loop Context|Next'
    );
    const files = skillFiles(SKILLS_DIR);
    const drifted = files
      .map((f) => ({ f, segments: segments(blockHeaderLine(readFileSync(f, 'utf8')) ?? '') }))
      .filter((r) => r.segments.join('|') !== expected.join('|'))
      .map((r) => r.f);
    expect(drifted).toEqual([]);
  });

  it('when the constitution is read, should publish the contract segment shape', () => {
    // given: the repository constitution
    // when: the status header it publishes is read
    // then: it has the contract's segments, in the contract's order
    const expected = contractSegments();
    const header = headerLine(readFileSync(AGENTS_MD, 'utf8'));
    expect(header).not.toBeNull();
    expect(segments(header ?? '').join('|')).toBe(expected.join('|'));
  });

  it('when every published header is read, should publish no three-segment shape', () => {
    // given: every skill document and the constitution
    // when: their published headers are read
    // then: none of them still teaches the shorter three-segment header
    const sources = [
      ...skillFiles(SKILLS_DIR).map((f) => readFileSync(f, 'utf8')),
      readFileSync(AGENTS_MD, 'utf8')
    ];
    const short = sources.filter((s) =>
      s.includes('`Peaks-Loop Skill: <skill> | Peaks-Loop Gate: <gate> | Next: <one short action>`')
    );
    expect(short).toEqual([]);
  });
});
