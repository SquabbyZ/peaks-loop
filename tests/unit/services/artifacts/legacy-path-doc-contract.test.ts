// tests/unit/services/artifacts/legacy-path-doc-contract.test.ts
//
// A prerequisite row whose canonical name carries the request id demotes the
// bare name to a back-compat tier. That demotion is only real if no skill
// document sends an agent to write the bare name — and nothing read the prose.
// The sweeps run for it were keyed on artifact NAMES (the bare literal, the
// word "ridless", the phrase "carries no"), so they could not see a document
// that presents a bare stem while never naming the request id at all. The class
// property is "a bare stem presented as a write target", so this file keys on
// the property, and the stems are derived from the table rather than listed.
//
// Two halves that fail separately:
//   - the stems come from `artifact-prerequisites.ts`, walked by role x state x
//     request type. A row that gains the slot is covered with no edit here; a
//     row that loses it moves the derived set and the render case says so.
//   - the write direction is read off ONE LINE: a write verb, or the label
//     `Output:`, within 80 characters before the stem, and no retirement word on
//     that line. A bare stem on an instruction to READ, or in a table cell with
//     no verb, is out of scope and stays green — this is a ban on writing the
//     bare name, not a ban on the bare name.
//
// Read: every `*.md` under `skills/`, from the working tree.
//
// Dimensions covered: render / behavior / integration / a11y.

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  getPrerequisitesFor,
  VALID_REQUEST_TYPES,
  type ArtifactPrerequisite
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { ALLOWED_STATES_PER_ROLE } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import type { RequestArtifactRole } from '../../../../src/services/artifacts/request-artifact-service.js';

declareDimensions('tests/unit/services/artifacts/legacy-path-doc-contract.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** The placeholder a canonical prerequisite path carries in place of the id. */
const RID_SLOT = '-<rid>';

/** A place a document can send an agent, with the line that sent it there. */
type WriteTargetHit = { readonly file: string; readonly line: number; readonly stem: string };

const WRITE_VERB_SOURCE =
  '(?:outputs?|produce[sd]?|writes?|written|generates?|emits?|creates?|scaffolds?)';

/**
 * A line that qualifies the mention instead of directing a write: it is what a
 * correct back-compat note looks like, and it is the line the demoted tier is
 * SUPPOSED to appear on. Matched anywhere on the line, because a note that
 * names the bare path and the tier in one sentence is one claim, not two.
 */
const RETIREMENT_QUALIFIER =
  /\b(?:legacy|back-?compat|backward-compat|deprecated|superseded|removed|pre-rid|pre-scoping)\b|\bno longer\b|\bnever writ/i;

function escapeForRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The bare names the table demotes.
 *
 * The field split is the whole rule, and it is the type's own split:
 * `legacyRelativePath` is documented as "the immediately previous location of
 * this artifact", while `legacyRelativePaths` holds "further, older locations"
 * — which for an audit row is a DIFFERENT artifact's path borrowed as a
 * fallback. So a name reaches the forbidden set only by being a row's own
 * previous location, and never by being a fallback someone else's row borrows.
 * That is what keeps `rd/perf-baseline.md` writable while `audit/perf.md` is
 * not, without naming either one here.
 */
function demotedBareStems(rows: readonly ArtifactPrerequisite[]): string[] {
  const stems = new Set<string>();
  for (const row of rows) {
    if (row.legacyRelativePath !== undefined) stems.add(row.legacyRelativePath);
    if (!row.relativePath.includes(RID_SLOT)) continue;
    const ownBare = row.relativePath.replace(RID_SLOT, '');
    // A demotion written into the list field rather than the singular one is
    // still this row's own previous location, so it still counts.
    if (row.legacyRelativePaths?.includes(ownBare) === true) stems.add(ownBare);
  }
  return [...stems].sort();
}

/** Every row the table reaches, whichever type or state is the entry point. */
function everyPrerequisiteRow(): ArtifactPrerequisite[] {
  const byPath = new Map<string, ArtifactPrerequisite>();
  for (const [role, states] of Object.entries(ALLOWED_STATES_PER_ROLE)) {
    for (const state of states) {
      for (const type of VALID_REQUEST_TYPES) {
        for (const row of getPrerequisitesFor(role as RequestArtifactRole, state, type)) {
          byPath.set(row.relativePath, row);
        }
      }
    }
  }
  return [...byPath.values()];
}

/** The hits in one document, one per stem per line. */
function writeTargetHitsIn(text: string, stems: readonly string[], file: string): WriteTargetHit[] {
  const hits: WriteTargetHit[] = [];
  text.split('\n').forEach((line, index) => {
    if (RETIREMENT_QUALIFIER.test(line)) return;
    for (const stem of stems) {
      if (!line.includes(stem)) continue;
      const governed = new RegExp(`${WRITE_VERB_SOURCE}\\b.{0,80}${escapeForRegExp(stem)}`, 'i');
      if (governed.test(line)) hits.push({ file, line: index + 1, stem });
    }
  });
  return hits;
}

function skillsMarkdownFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) files.push(full);
    }
  };
  walk(join(root, 'skills'));
  return files;
}

const toRepoPath = (root: string, absolute: string): string =>
  absolute
    .slice(root.length + 1)
    .split(sep)
    .join('/');

const REPO_ROOT = process.cwd();

/** The seven names the table demotes today. */
const DEMOTED_BARE_STEMS = [
  'audit/perf.md',
  'audit/security.md',
  'prd/handoff.md',
  'rd/bug-analysis.md',
  'rd/code-review.md',
  'rd/karpathy-review.md',
  'rd/security-review.md'
];

const row = (
  parts: Partial<ArtifactPrerequisite> & { relativePath: string }
): ArtifactPrerequisite => parts as ArtifactPrerequisite;

describe('(render) the stems the check is aimed at', () => {
  it('derives every demoted bare name off the table', () => {
    expect(demotedBareStems(everyPrerequisiteRow())).toEqual(DEMOTED_BARE_STEMS);
  });

  it('keeps a bare name a row still writes, even though another row falls back to it', () => {
    // `audit/perf-<rid>.md` lists `rd/perf-baseline.md` as an older tier, but
    // that name is a live artifact of its own (Gate B9 writes it). Measured:
    // the row carrying it hangs off no table, so the walk cannot see it either
    // way — the field split is the only thing keeping it out of the set, and
    // this case fails if that split is ever collapsed into one list field.
    const stems = demotedBareStems(everyPrerequisiteRow());

    expect(stems).not.toContain('rd/perf-baseline.md');
    expect(stems).toContain('audit/perf.md');
  });

  it('takes no stem from a path that only carries the placeholder inline', () => {
    // `qa/test-cases/<rid>.md` has no bare form to return to, and the table
    // gives it no tier. A naive strip would invent `qa/test-cases/.md`.
    const stems = demotedBareStems(everyPrerequisiteRow());

    expect(stems).not.toContain('qa/test-cases/.md');
    expect(stems.every((stem) => !stem.includes('<'))).toBe(true);
  });
});

describe('(behavior) the derivation, on rows built to be rejected', () => {
  const scoped = row({
    relativePath: 'audit/security-<rid>.md',
    legacyRelativePath: 'audit/security.md'
  });

  it('demotes the bare name of a row whose canonical path carries the slot', () => {
    expect(demotedBareStems([scoped])).toEqual(['audit/security.md']);
  });

  it('demotes nothing when the canonical path IS the bare name', () => {
    // The shape the table had before the row was scoped. This is the input the
    // render case above exists to reject: reverted, the set loses a member.
    expect(demotedBareStems([row({ relativePath: 'audit/security.md' })])).toEqual([]);
  });

  it('demotes nothing for a fallback borrowed from a different artifact', () => {
    // `rd/perf-baseline.md` in the list field is another artifact's path, so it
    // is not this row's demoted name.
    const withBorrowedTier = row({
      relativePath: 'audit/perf-<rid>.md',
      legacyRelativePath: 'audit/perf.md',
      legacyRelativePaths: ['rd/perf-baseline.md']
    });

    expect(demotedBareStems([withBorrowedTier])).toEqual(['audit/perf.md']);
  });

  it('demotes a bare name that is this row’s own previous location, whichever field holds it', () => {
    const inTheListField = row({
      relativePath: 'audit/perf-<rid>.md',
      legacyRelativePaths: ['audit/perf.md']
    });

    expect(demotedBareStems([inTheListField])).toEqual(['audit/perf.md']);
  });
});

describe('(behavior) the write direction, on lines built to be rejected', () => {
  const stems = ['audit/security.md'];

  it('flags the labelled output line, which is the shape the name-keyed sweeps missed', () => {
    const hits = writeTargetHitsIn(
      '  Output: `.peaks/_runtime/<sessionId>/audit/security.md`.\n',
      stems,
      'x.md'
    );

    expect(hits.map((hit) => hit.stem)).toEqual(['audit/security.md']);
  });

  it('flags a bare stem given as what the run produces', () => {
    const hits = writeTargetHitsIn(
      'those are produced by the audit run as `audit/security.md`\n',
      stems,
      'x.md'
    );

    expect(hits).toHaveLength(1);
  });

  it('leaves a read instruction alone', () => {
    // Same stem, opposite direction.
    expect(
      writeTargetHitsIn('Read `audit/security.md` for the tier list.\n', stems, 'x.md')
    ).toEqual([]);
  });

  it('leaves the back-compat note alone, which is where the bare name belongs', () => {
    const note =
      'The bare `audit/security.md` is still read as a legacy fallback, but never write there.\n';

    expect(writeTargetHitsIn(note, stems, 'x.md')).toEqual([]);
  });

  it('leaves a mention with no verb before it alone', () => {
    expect(writeTargetHitsIn('| `audit/security.md` | the oldest tier |\n', stems, 'x.md')).toEqual(
      []
    );
  });

  it('reports the line it found, one-based', () => {
    expect(writeTargetHitsIn('a\nb\nOutput: `audit/security.md`\n', stems, 'x.md')).toEqual([
      { file: 'x.md', line: 3, stem: 'audit/security.md' }
    ]);
  });
});

describe('(integration) the live skill documents', () => {
  const files = skillsMarkdownFiles(REPO_ROOT);
  const stems = demotedBareStems(everyPrerequisiteRow());

  it('reads a non-empty set of documents, so an empty walk cannot pass as clean', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('sends no agent to write a demoted bare name', () => {
    const hits = files.flatMap((file) =>
      writeTargetHitsIn(readFileSync(file, 'utf8'), stems, toRepoPath(REPO_ROOT, file))
    );

    expect(
      hits.map((hit) => `${hit.file}:${hit.line} presents \`${hit.stem}\` as a write target`)
    ).toEqual([]);
  });
});

describe('(a11y) the failure text a human reads', () => {
  it('names the file, the line and the stem, so the site can be opened', () => {
    const [hit] = writeTargetHitsIn('Output: `audit/security.md`\n', ['audit/security.md'], 'x.md');

    expect(`${hit?.file}:${hit?.line}`).toBe('x.md:1');
    expect(hit?.stem).toBe('audit/security.md');
  });
});
