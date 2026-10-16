// tests/unit/services/artifacts/artifact-contract-block.test.ts
//
// The dispatch prompt must name, for the dispatched role and the request's
// actual type, every artifact the prerequisite gate will demand and the exact
// body markers each one must carry. Before this module the gate matched literal
// strings the producer was never shown, so a producer that had done the work was
// refused by a predicate it could not see, and the only exit was editing the
// artifact afterwards.
//
// The pinning case is generated, not transcribed: it walks
// `artifact-prerequisites.ts` itself and reads each prerequisite's markers off
// the prerequisite OBJECT, never through the module under test. The module
// exposes no marker extractor, deliberately — a test that called one would not be
// independent of the renderer it checks.
//
// CONTROL ARM, named so its absence is not read as an omission. The brief asked
// for "an injected marker that is not in the table must not appear". What is
// built is that control on the REAL input: the block must not carry the
// `bugfix`-only `## Root cause`, and must not carry a token only the composed
// PROMPT has — which is what shows these assertions read the block and not the
// prompt around it. A synthetic never-in-any-table string would pass, proving
// neither.
//
// Dimensions: render (block shape, marker quoting, the printed command being
// runnable), behavior (rows per role/type, the empty cases, one block per
// prompt), integration (a real `peaks sub-agent dispatch`), a11y (the sentences
// a producer reads).

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerRequestCommands } from '../../../../src/cli/commands/request-commands.js';
import { ALLOWED_STATES_PER_ROLE } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import {
  VALID_REQUEST_TYPES,
  getPrerequisitesFor,
  type ArtifactPrerequisite,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import type { RequestArtifactRole } from '../../../../src/services/artifacts/artifact-templates.js';
import {
  buildArtifactContractBlock,
  ensureArtifactContractBlock,
  readArtifactContractBlock
} from '../../../../src/services/artifacts/artifact-contract-block.js';

declareDimensions('tests/unit/services/artifacts/artifact-contract-block.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-13-contract-block';
const RID = 'rid-contract-block-probe';
const ROLES = Object.keys(ALLOWED_STATES_PER_ROLE) as RequestArtifactRole[];

/** The markers of one entry, read off the object — NOT via the module under test. */
function markersOf(prerequisite: ArtifactPrerequisite): string[] {
  return [
    ...(prerequisite.mustContain ?? []),
    ...(prerequisite.mustContainAny ?? []),
    ...(prerequisite.headingMustContain ?? [])
  ];
}

type TableEntry = {
  role: RequestArtifactRole;
  requestType: RequestType;
  state: string;
  prerequisite: ArtifactPrerequisite;
};

/** Every (role, type, state, prerequisite) the table declares, in table order. */
function* tableEntries(): Generator<TableEntry> {
  for (const role of ROLES) {
    for (const requestType of VALID_REQUEST_TYPES) {
      for (const state of ALLOWED_STATES_PER_ROLE[role]) {
        for (const prerequisite of getPrerequisitesFor(role, state, requestType)) {
          yield { role, requestType, state, prerequisite };
        }
      }
    }
  }
}

function block(
  role: string,
  requestType: RequestType,
  requestTypeSource: 'declared' | 'default' = 'declared'
): string {
  return buildArtifactContractBlock({ role, requestType, requestTypeSource, requestId: RID });
}

/** Write `<project>/.peaks/_runtime/<sid>/<role>/requests/<rid>.md` with a type line. */
function writeRequest(project: string, role: string, typeLine: string | null): void {
  const dir = join(project, '.peaks', '_runtime', SESSION_ID, role, 'requests');
  mkdirSync(dir, { recursive: true });
  const body = `# Request ${RID}\n\n- session: ${SESSION_ID}\n${typeLine === null ? '' : `- type: ${typeLine}\n`}`;
  writeFileSync(join(dir, `${RID}.md`), body, 'utf8');
}

const BLOCK_HEADING = '## Artifact contract (generated from the prerequisite table)';

/** How many artifact-contract sections a text carries. */
function headingCount(text: string): number {
  return text.split(BLOCK_HEADING).length - 1;
}

/** The block's own line for one artifact path, or a loud failure when absent. */
function lineFor(text: string, artifactPath: string): string {
  const line = text.split('\n').find((candidate) => candidate.startsWith(`- \`${artifactPath}\``));
  if (line === undefined) throw new Error(`the block carries no line for ${artifactPath}`);
  return line;
}

/** The `peaks request transition …` invocations the block prints, tokenised. */
function emittedTransitionCommands(text: string): string[][] {
  return text
    .split('`')
    .filter((part) => part.startsWith('peaks request transition '))
    .map((part) => part.split(/\s+/));
}

/** The flags `peaks request transition` itself declares as MANDATORY. */
function mandatoryTransitionFlags(): string[] {
  const { io } = makeCapturedIo();
  const program = new Command();
  registerRequestCommands(program, io);
  const request = program.commands.find((candidate) => candidate.name() === 'request');
  const transition = request?.commands.find((candidate) => candidate.name() === 'transition');
  if (transition === undefined) {
    throw new Error('peaks request transition is not registered — the block prints a dead command');
  }
  // `option.required` in commander means "takes a value" and is true for every
  // flag; `mandatory` is the one `requiredOption` sets. Reading the wrong one
  // would make this control vacuous.
  return transition.options
    .filter((option) => option.mandatory === true)
    .flatMap((option) => (option.long === undefined ? [] : [option.long]));
}

describe('render — the block names what the table demands', () => {
  it('should quote every marker reachable by the role and type, verbatim in the block', () => {
    // given: the whole table, walked
    let rowsWalked = 0;
    for (const { role, requestType, state, prerequisite } of tableEntries()) {
      rowsWalked += 1;
      const where = `${role}/${requestType}/${state}/${prerequisite.relativePath}`;

      // when: the block the composer would inject for that pair
      const text = block(role, requestType);

      // then: the path and every marker the gate will match are named
      expect(text, `${where}: path`).toContain(prerequisite.relativePath.replace('<rid>', RID));
      for (const marker of markersOf(prerequisite)) {
        expect(text, `${where}: marker ${JSON.stringify(marker)}`).toContain(marker);
      }
    }
    // non-vacuity: an empty table would make every assertion above pass by
    // never running, which is the failure this whole file exists to prevent
    expect(rowsWalked).toBeGreaterThan(0);
  });

  it('should name the state each row belongs to, so a producer knows when it applies', () => {
    // given: the rd role under the feature table
    const text = block('rd', 'feature');

    // when: the block names the only rd state that demands anything
    // then: the state is named, with the transition that reaches it, and an
    // empty state is not rendered as an obligation
    expect(text).toContain('`rd:qa-handoff`');
    expect(text).toContain(`peaks request transition ${RID} --role rd --state qa-handoff`);
    expect(text).not.toContain('`rd:implemented`');
  });

  it('should print a transition command carrying every flag the CLI declares as mandatory', () => {
    // given: the flags `peaks request transition` registers with `requiredOption`
    const mandatory = mandatoryTransitionFlags();

    // then: the control is not vacuous — the CLI really does demand these
    expect(mandatory.length).toBeGreaterThan(0);
    expect(mandatory).toContain('--project');

    // when: every transition line the block can print is collected
    let emitted = 0;
    for (const role of ROLES) {
      for (const requestType of VALID_REQUEST_TYPES) {
        const text = block(role, requestType);
        for (const tokens of emittedTransitionCommands(text)) {
          emitted += 1;
          for (const flag of mandatory) {
            expect(tokens, `${role}/${requestType}: ${tokens.join(' ')} omits ${flag}`).toContain(
              flag
            );
          }
        }
      }
    }

    // then: the walk saw the commands it is asserting about
    expect(emitted).toBeGreaterThan(0);
  });

  it('should keep the meaning of an alternative set, not restate it as an all-of list', () => {
    // The label is the ONLY carrier of `mustContainAny`'s meaning. Relabelling it
    // "must contain" leaves every marker present — so the membership walk above
    // still passes — while telling a producer the gate needs ALL the escape-hatch
    // markers, the single-idiom mistake that field exists to undo. So this walk
    // asserts the MEANING, per line.

    // given: every prerequisite in the table that declares an alternative set
    let setsWalked = 0;
    for (const { role, requestType, state, prerequisite } of tableEntries()) {
      const alternatives = prerequisite.mustContainAny ?? [];
      if (alternatives.length === 0) continue;
      setsWalked += 1;

      // when: the block's own line for that artifact is read
      const line = lineFor(
        block(role, requestType),
        prerequisite.relativePath.replace('<rid>', RID)
      );

      // then: it says the gate needs one of them, not all of them
      expect(line, `${role}/${requestType}/${state}: ${prerequisite.relativePath}`).toContain(
        'at least one of'
      );
      for (const marker of alternatives) expect(line).toContain(marker);
    }
    expect(setsWalked).toBeGreaterThan(0);

    // and the sharp case: one prerequisite carrying BOTH fields must show two
    // distinct obligations rather than one merged list
    const unitTestsLine = lineFor(block('rd', 'feature'), `qa/test-cases/${RID}.md`);
    expect(unitTestsLine).toContain('must contain: `## Test cases`');
    expect(unitTestsLine).toContain('must contain at least one of: `test(`, `it(`');
  });

  it('should carry nothing that belongs to the prompt rather than to the block', () => {
    // The control arm on the REAL input. The composed prompt always carries the
    // superpowers refusal; the block must not, which is what shows these
    // assertions read the block and not the prompt around it.
    const text = block('rd', 'feature');

    expect(text).not.toContain('MUST NOT follow the superpowers chain');
    // a marker the table carries only for a DIFFERENT type must be absent too,
    // which fires the moment the block dumps the whole table
    expect(text).not.toContain('## Root cause');
  });
});

describe('behavior — the block follows the type, and is empty when it should be', () => {
  it('when the text already carries a block, should keep exactly one', () => {
    // given: a caller prompt that already holds a block (a re-dispatch, or a
    // resume from a stored prompt) — and a DIFFERENT block from the fresh run,
    // because the type was declared in between
    const carried = `PRIOR BRIEF\n${block('rd', 'bugfix')}`;

    // when: a default-labelled block is appended
    const composed = ensureArtifactContractBlock(carried, block('rd', 'feature', 'default'));

    // then: exactly one section survives, and it is the carried one — two
    // sections that disagree leave a reader no way to pick the authoritative one
    expect(headingCount(composed)).toBe(1);
    expect(composed).toBe(carried);
    expect(composed).toContain('## Root cause');
    expect(composed).not.toContain('the DEFAULT, not a recorded choice');
  });

  it('when the text carries no block, should append exactly one — the control', () => {
    // given: no block in the text, and one to add
    const composed = ensureArtifactContractBlock('PRIOR BRIEF\n', block('rd', 'feature'));

    // then: exactly one is added...
    expect(headingCount(composed)).toBe(1);
    expect(composed.startsWith('PRIOR BRIEF\n')).toBe(true);
    // ...and an EMPTY block adds zero bytes, even when the text already has one
    const carried = `PRIOR BRIEF\n${block('rd', 'feature')}`;
    expect(ensureArtifactContractBlock(carried, '')).toBe(carried);
  });

  it('when the type is bugfix, should name the bug-analysis markers a feature block omits', () => {
    // given: the same role under two types
    const bugfix = block('rd', 'bugfix');
    const feature = block('rd', 'feature');

    // when/then: the type selects the row — the second arm of the control, since
    // a block that carried every marker in the table would pass the walk above
    expect(bugfix).toContain('## Root cause');
    expect(bugfix).toContain('## Fix approach');
    expect(feature).not.toContain('## Root cause');
    expect(feature).not.toContain('## Fix approach');
  });

  it.each(['docs', 'chore'] as const)(
    'when the type is %s, should add zero bytes for rd — nothing is gated',
    (requestType) => {
      expect(block('rd', requestType)).toBe('');
    }
  );

  it.each(['ui', 'sc'] as const)(
    'when the role is %s, should add zero bytes — no gated rows',
    (role) => {
      for (const requestType of VALID_REQUEST_TYPES) {
        expect(block(role, requestType), `${role}/${requestType}`).toBe('');
      }
    }
  );

  it('when the role is not a request-artifact role, should add zero bytes', () => {
    expect(block('txt', 'feature')).toBe('');
    expect(block('reviewer', 'feature')).toBe('');
  });

  it('when the artifact is on disk and declares a type, should read that type rather than the default', async () => {
    // given: a temp project whose only artifact for the id is a sibling role's
    const project = mkdtempSync(join(tmpdir(), 'contract-block-read-'));
    try {
      writeRequest(project, 'rd', 'bugfix');

      // when: the block is composed for a QA dispatch of the same id
      const text = await readArtifactContractBlock({
        projectRoot: project,
        sessionId: SESSION_ID,
        requestId: RID,
        role: 'qa'
      });

      // then: the declared type wins over DEFAULT_REQUEST_TYPE
      expect(text).toContain('recorded by a `- type:` line');
      expect(text).toContain('`bugfix`');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when nothing declares the type, should still name a table — the default one', async () => {
    // given: a project with no artifact for the id at all
    const project = mkdtempSync(join(tmpdir(), 'contract-block-default-'));
    try {
      // when: the block is composed
      const text = await readArtifactContractBlock({
        projectRoot: project,
        sessionId: SESSION_ID,
        requestId: RID,
        role: 'rd'
      });

      // then: the feature table is named, and the substitution is visible
      expect(text).toContain('the DEFAULT, not a recorded choice');
      expect(text).toContain('`## Findings`');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('a11y — what the producer reads', () => {
  it('should label a defaulted type as a default, and not a declared one as a substitution', () => {
    const defaulted = block('rd', 'feature', 'default');
    const declared = block('rd', 'feature', 'declared');

    expect(defaulted).toContain('the DEFAULT, not a recorded choice');
    expect(defaulted).toContain('records no `- type:` line');
    expect(declared).toContain('recorded by a `- type:` line');
    expect(declared).not.toContain('the DEFAULT, not a recorded choice');
  });

  it('should state the matching rule, so a marker is not read as optional prose', () => {
    expect(block('rd', 'feature')).toContain('case-insensitive substring');
  });

  it('should bound its own claim, since the table is only part of the gate', () => {
    const text = block('rd', 'feature');

    expect(text).toContain('generated from the prerequisite table alone');
    expect(text).toContain('not a complete contract');
  });

  it('should say the handoff transition is guarded by more than this table', () => {
    // `rd:qa-handoff` really is: the judged-declaration and gateEvidence checks
    // run for every rd dispatch that reaches it, none of them a table row. An
    // earlier wording said a gate "may also check something the table does not
    // carry", which under-claimed a systematic gap at exactly this state.
    const text = block('rd', 'feature');

    expect(text).toContain('also runs checks that are not rows of this table');
    expect(text).toContain('does not by itself open that transition');
  });

  it('should claim the extra handoff checks only where a handoff row is rendered', () => {
    // qa states demand artifacts but are not guarded by those checks, so the
    // sentence is conditional on the ROWS rather than on a hand-written list
    expect(block('qa', 'feature')).not.toContain('not rows of this table');
    expect(block('prd', 'feature')).not.toContain('not rows of this table');
    // and a type with no handoff row at all renders nothing to be conditional about
    expect(block('rd', 'docs')).toBe('');
  });

  it('should mark the prerequisites a missing file only warns about', () => {
    // given: the mut report and the third-party review are back-compat prereqs
    const text = block('rd', 'feature');

    // then: the producer is told the marker is still required, but absence warns
    expect(text).toContain('a missing file only warns until v2.14.0');
    expect(text).toContain('a missing file only warns until v2.15.0');
  });

  it('should name the declaration the handoff gate also requires', () => {
    // The handoff transition refuses an artifact that satisfies the row's markers
    // and carries no judged declaration. Naming it in the carrier is the fix: the
    // producer reads the requirement before writing, instead of meeting it at a
    // refusal that reported the artifact as merely absent.
    const text = block('rd', 'bugfix');

    expect(text).toContain('## Judged content');
    // The same check runs for a CONFIG handoff, where the security artifact is
    // `rd/security-review-<rid>.md` — measured through the real `checkPrerequisites`,
    // which refuses that path with `declaration-missing` when no block is present.
    // So the clause must not be gated on the canonical audit path, and it must not
    // name a producer: no single producer writes both artifacts.
    expect(block('rd', 'config')).toContain('## Judged content');
    expect(block('rd', 'config')).not.toContain('peaks security-audit run');
    // conditional on the same ROWS the handoff note is: a role whose transition
    // never runs that check is not told about it
    expect(block('qa', 'feature')).not.toContain('## Judged content');
    expect(block('prd', 'feature')).not.toContain('## Judged content');
  });

  it('should name the body-lint gate in every block that has rows, and in none that has not', () => {
    // The lint gate runs when the artifact leaves `draft` — for every role and every
    // type — so it belongs to every non-empty block. It said nothing about that
    // gate before, so a producer met a refusal the carrier had never mentioned.
    let nonEmpty = 0;
    for (const role of ROLES) {
      for (const requestType of VALID_REQUEST_TYPES) {
        const text = block(role, requestType);
        if (text.length === 0) continue;
        nonEmpty += 1;
        expect(text, `${role}/${requestType}`).toContain('leaving `draft` runs the body lint');
      }
    }
    // non-vacuity: a block builder that emitted nothing would pass the loop above
    expect(nonEmpty).toBeGreaterThan(0);

    // and the control on the real input: the blocks pinned as byte-empty get none of
    // it, because the empty string is the whole byte-identity contract
    expect(block('rd', 'docs')).toBe('');
    expect(block('txt', 'feature')).toBe('');
    expect(block('reviewer', 'feature')).toBe('');
  });
});
