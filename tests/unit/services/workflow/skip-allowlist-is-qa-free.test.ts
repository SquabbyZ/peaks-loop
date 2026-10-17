// tests/unit/services/workflow/skip-allowlist-is-qa-free.test.ts
//
// rid `2026-10-17-skip-allowlist-is-the-qa-free-set`. The arms for the skip
// allowlist being DERIVED from the type tables instead of hand-written.
//
// THE DEFECT, MEASURED WITH THE SHIPPED FUNCTIONS BEFORE THIS FILE EXISTED:
// `typeRequiresQaPhase('config')` is true — the config table carries
// `SECURITY_REVIEW` at `rd:qa-handoff` and `TEST_REPORT` at `qa:verdict-issued` —
// yet `SKIPPABLE_TYPES` spelled `['docs', 'config', 'chore']`. A plantable record
// for a config rid therefore bypassed a QA phase the contract requires, and the
// read path re-asserted only that hand-written list. The arms below pin both
// halves: the allowlist IS the QA-free symbol (reference identity plus a
// source-level check, so a literal with the same values is red), and a record the
// write path could not have produced is not honoured.
//
// Dimensions: `render` is omitted — nothing here renders. The provenance and
// refusal strings are asserted under `a11y`, and the file/verdict transitions
// under `behavior` / `integration`.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import {
  VALID_REQUEST_TYPES,
  type RequestType
} from '../../../../src/services/artifacts/artifact-prerequisites.js';
import {
  createRequestArtifact,
  type RequestArtifactState
} from '../../../../src/services/artifacts/request-artifact-service.js';
import { updateStatusBlock } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import {
  QA_FREE_TYPES,
  typeRequiresQaPhase
} from '../../../../src/services/workflow/pipeline-verify-qa-phase.js';
import { verifyPipeline } from '../../../../src/services/workflow/pipeline-verify-service.js';
import { mayHonourSkip } from '../../../../src/services/workflow/request-type-resolution.js';
import {
  applySkip,
  canSkipSlice,
  SKIPPABLE_TYPES
} from '../../../../src/services/workflow/workflow-skip-service.js';
import { readSkipState } from '../../../../src/services/workflow/workflow-state-store.js';

declareDimensions(
  'tests/unit/services/workflow/skip-allowlist-is-qa-free.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'nothing here renders: the arms assert a derived list, a null read and a verdict object'
    }
  ]
);

const SESSION_ID = 'sess-skip-allowlist';
const TS = '2026-10-17T00:00:00.000Z';

/** The production source, read so a literal revert is visible to the suite. */
const SKIP_SERVICE_SOURCE = readFileSync(
  new URL('../../../../src/services/workflow/workflow-skip-service.ts', import.meta.url),
  'utf8'
);
/** The one assignment the allowlist may have: the derived symbol. */
const DERIVED_ASSIGNMENT = /export const SKIPPABLE_TYPES\b[^=]*=\s*QA_FREE_TYPES;/;

/** The filter the allowlist must equal, taken from the shipped functions. */
function qaFreeFilter(): RequestType[] {
  return VALID_REQUEST_TYPES.filter((requestType) => !typeRequiresQaPhase(requestType));
}

const ws = withTmpWorkspacePerTest('peaks-skip-allowlist-');

async function seedRequest(
  projectRoot: string,
  rid: string,
  requestType: RequestType,
  state: RequestArtifactState = 'qa-handoff'
): Promise<void> {
  const created = await createRequestArtifact({
    role: 'rd',
    requestId: rid,
    projectRoot,
    sessionId: SESSION_ID,
    requestType,
    apply: true
  });
  writeFileSync(
    created.path,
    updateStatusBlock(readFileSync(created.path, 'utf8'), state, TS).updated,
    'utf8'
  );
}

/** Where the writer writes — and where a planted record is placed. */
function statePath(root: string, rid: string): string {
  return join(root, '.peaks', '_runtime', SESSION_ID, 'workflow-state', `${rid}.json`);
}

/** A plantable record: every field present, shape otherwise well-formed. */
function writeRecord(root: string, rid: string, overrides: Record<string, unknown>): void {
  const path = statePath(root, rid);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        rid,
        skippedGates: ['QA'],
        skipReason: 'planted by an arm, never by the writer',
        skipAppliedAt: '2026-01-01T00:00:00.000Z',
        skipAppliedBy: 'planted',
        callerKind: 'human',
        ...overrides
      },
      null,
      2
    )}\n`,
    'utf8'
  );
}

// ---------------------------------------------------------------------------
// behavior — the allowlist is the QA-free set, in both directions
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the allowlist is derived from the QA-free types', () => {
  it('when the shipped functions answer, should equal the QA-free filter', () => {
    // given: the tables, read through the same function the pipeline uses
    const expected = qaFreeFilter();

    // when:  the allowlist is read
    // then:  it is that filter — not a list that happens to agree today
    expect(SKIPPABLE_TYPES).toEqual(expected);
    expect(expected).toEqual(['docs', 'chore']);
  });

  it('when the production symbol is compared, should be the SAME object, not an equal list', () => {
    // A literal `['docs', 'chore']` has the same values today, so `toEqual` above
    // cannot see a revert. Reference identity can: an alias of `QA_FREE_TYPES` is
    // the derivation, a copy of its current value is not.
    expect(SKIPPABLE_TYPES).toBe(QA_FREE_TYPES);
  });

  it('when the skip service source is read, should import the derived symbol, not spell names', () => {
    // given: the production file itself, not a local recomputation
    // then:  the import and the assignment name the symbol
    expect(SKIP_SERVICE_SOURCE).toMatch(
      /import \{[^}]*QA_FREE_TYPES[^}]*\} from '\.\/pipeline-verify-qa-phase\.js';/
    );
    expect(SKIP_SERVICE_SOURCE).toMatch(DERIVED_ASSIGNMENT);

    // control: a literal revert fails the same assertion, so it can be observed
    expect(
      DERIVED_ASSIGNMENT.test(
        "export const SKIPPABLE_TYPES: ReadonlyArray<RequestType> = ['docs', 'chore'];"
      )
    ).toBe(false);
  });

  it('when the filter is asked, should exclude config and include docs and chore', () => {
    expect(SKIPPABLE_TYPES).not.toContain('config');
    expect(SKIPPABLE_TYPES).toContain('docs');
    expect(SKIPPABLE_TYPES).toContain('chore');
    expect(typeRequiresQaPhase('config')).toBe(true);
  });

  it('when the OLD hand-written list is compared, should be the control that fails', () => {
    // given: the list this slice replaced — `config` is its extra member
    const oldHandWritten: readonly RequestType[] = ['docs', 'config', 'chore'];

    // then:  it fails the derivation assertion, so the assertion discriminates
    //        between a derived allowlist and a restatement that gained a member
    expect(oldHandWritten).not.toEqual(qaFreeFilter());
    expect(qaFreeFilter()).not.toContain('config');
  });

  it('when the same skip is applied twice, should be an idempotent no-op', async () => {
    // given: a docs rid and a repeatable writer call — the one-time rule
    await seedRequest(ws().path, 'rid-docs-idempotent', 'docs');
    const args = { rid: 'rid-docs-idempotent', gatesRaw: 'QA', reason: 'documentation only' };

    // when:  the same gates are applied again
    const first = await applySkip(ws().path, SESSION_ID, args);
    const second = await applySkip(ws().path, SESSION_ID, args);

    // then:  the first writes; the second reports the no-op rather than rewriting
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.idempotent).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration — the read path is silent on a record the writer could not make
// ---------------------------------------------------------------------------

describe('Scenario: integration — malformed records are not honoured', () => {
  it('when skipReason is empty on a docs rid, should read null and evaluate its RD gates', async () => {
    // given: a QA-FREE type — so the arm proves the shape check itself, not the
    //        type gate — and a record with an empty justification
    await seedRequest(ws().path, 'rid-docs-empty-reason', 'docs');
    writeRecord(ws().path, 'rid-docs-empty-reason', {
      skipReason: '',
      skippedGates: ['RD']
    });

    // when:  the state is read and the pipeline is checked
    // then:  silence, and the RD gates stand on their own verdict instead of
    //        being marked skipped
    expect(readSkipState(ws().path, SESSION_ID, 'rid-docs-empty-reason')).toBeNull();
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: 'rid-docs-empty-reason',
      sessionId: SESSION_ID
    });
    expect(result.requestType).toBe('docs');
    expect(result.rdPhase.gates.some((g) => g.status === 'skipped')).toBe(false);
    expect(result.rdPhase.gates.find((g) => g.name === 'rd-request-exists')?.detail).toContain(
      'found at'
    );
    expect(result.nextActions.join('\n')).not.toContain('Skipped gates (via peaks workflow skip)');
  });

  it('when skippedGates is empty on a chore rid, should read null and honour no skip', async () => {
    // given: the other half of the malformed shape on the other QA-free type
    await seedRequest(ws().path, 'rid-chore-no-gates', 'chore');
    writeRecord(ws().path, 'rid-chore-no-gates', { skippedGates: [] });

    // when:  the state is read and the pipeline is checked
    // then:  silence, and no skip line is printed as though a bypass applied
    expect(readSkipState(ws().path, SESSION_ID, 'rid-chore-no-gates')).toBeNull();
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: 'rid-chore-no-gates',
      sessionId: SESSION_ID
    });
    expect(result.requestType).toBe('chore');
    expect(result.rdPhase.gates.some((g) => g.status === 'skipped')).toBe(false);
    expect(result.nextActions.join('\n')).not.toContain('Skipped gates (via peaks workflow skip)');
  });

  it('when a skipped gate is only whitespace, should read null', () => {
    // A gate name that matches nothing still printed a "Skipped gates: [ ]" line,
    // which reads as a bypass that never happened.
    writeRecord(ws().path, 'rid-blank-gate', { skippedGates: [' '] });
    expect(readSkipState(ws().path, SESSION_ID, 'rid-blank-gate')).toBeNull();
  });

  it('when a skipped gate carries a control character, should read null', () => {
    // The gate list is the one printed field that was not control-checked: a
    // newline in a gate name forges a second line of the skip report.
    writeRecord(ws().path, 'rid-control-gate', { skippedGates: ['QA\nX'] });
    expect(readSkipState(ws().path, SESSION_ID, 'rid-control-gate')).toBeNull();
  });

  it('when a skipped gate is not trimmed, should read null', () => {
    // `parseGatesList` trims on the way in, so `["  QA "]` is a shape the writer
    // cannot produce; honouring it printed a line that skipped nothing.
    writeRecord(ws().path, 'rid-untrimmed-gate', { skippedGates: ['  QA '] });
    expect(readSkipState(ws().path, SESSION_ID, 'rid-untrimmed-gate')).toBeNull();
  });

  it.each([
    ['skipReason (C0)', { skipReason: 'line one\nline two' }],
    ['skipReason (C1)', { skipReason: 'next\u0085line' }],
    ['skipAppliedBy', { skipAppliedBy: 'planted\nby: someone else' }],
    ['skipAppliedAt', { skipAppliedAt: '2026-01-01T00:00:00.000Z\ncaller: script' }]
  ])('when %s carries a control character, should read null', (field, overrides) => {
    // A newline in a printed field spoofs a second line of the human-facing skip
    // report; C1 controls (U+0080–U+009F) do the same on some terminals.
    const rid = `rid-control-${String(field)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '-')}`;
    writeRecord(ws().path, rid, overrides);
    expect(readSkipState(ws().path, SESSION_ID, rid)).toBeNull();
  });

  it('when a CONFIG record is well-formed, should still refuse it at the read path', async () => {
    // given: field-complete record, permitted shape — but config owes a QA phase,
    //        so no record may authorize skipping it
    await seedRequest(ws().path, 'rid-config-planted', 'config');
    writeRecord(ws().path, 'rid-config-planted', {});

    // when:  the read-path rule is asked, and the pipeline is checked
    // then:  the type gate refuses, and the QA violation stands
    expect(mayHonourSkip('config')).toBe(false);
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: 'rid-config-planted',
      sessionId: SESSION_ID
    });
    expect(result.violations).toContain(
      'QA phase skipped: peaks-qa was never invoked for this request (no QA request artifact found)'
    );
    expect(result.nextActions.join('\n')).not.toContain('Skipped gates (via peaks workflow skip)');
  });

  it('when a well-formed DOCS record is read, should honour it', async () => {
    // given: a docs rid and a record with a real reason — the writer's shape
    await seedRequest(ws().path, 'rid-docs-honoured', 'docs');
    writeRecord(ws().path, 'rid-docs-honoured', { skipReason: 'docs-only change, no runtime' });

    // when:  the state is read and the pipeline is checked
    // then:  the record is honoured and named in nextActions
    expect(mayHonourSkip('docs')).toBe(true);
    expect(readSkipState(ws().path, SESSION_ID, 'rid-docs-honoured')).not.toBeNull();
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: 'rid-docs-honoured',
      sessionId: SESSION_ID
    });
    expect(result.nextActions.join('\n')).toContain('Skipped gates (via peaks workflow skip)');
  });
});

// ---------------------------------------------------------------------------
// a11y — the write refusal and the provenance a human reads
// ---------------------------------------------------------------------------

describe('Scenario: a11y — config is refused at write, and a skip names its provenance', () => {
  it('when a config rid is offered to canSkipSlice, should refuse it', async () => {
    // given: a config RD artifact — the type the old allowlist wrongly permitted
    await seedRequest(ws().path, 'rid-config-write', 'config');

    // when:  the write-path classifier is asked
    // then:  the verdict is a refusal that names the QA-free types, not config
    const verdict = await canSkipSlice(
      ws().path,
      SESSION_ID,
      { rid: 'rid-config-write', gatesRaw: 'QA', reason: 'try to bypass config QA' },
      null
    );
    expect(verdict.allowed).toBe(false);
    const reason = verdict.allowed === false ? verdict.reason : '';
    expect(reason).toContain('config');
    expect(reason).toContain('docs, chore');
  });

  it('when a reason or gate carries a control character, should refuse at the write path', async () => {
    // The writer must not produce a record the reader refuses: the same predicate
    // guards both halves, so `applied:true` can never be followed by a null read.
    await seedRequest(ws().path, 'rid-docs-control-write', 'docs');
    const newlineReason = await canSkipSlice(
      ws().path,
      SESSION_ID,
      { rid: 'rid-docs-control-write', gatesRaw: 'QA', reason: 'line one\nline two' },
      null
    );
    expect(newlineReason.allowed).toBe(false);

    const newlineGate = await canSkipSlice(
      ws().path,
      SESSION_ID,
      { rid: 'rid-docs-control-write', gatesRaw: 'QA\nX', reason: 'docs only' },
      null
    );
    expect(newlineGate.allowed).toBe(false);

    const normal = await canSkipSlice(
      ws().path,
      SESSION_ID,
      { rid: 'rid-docs-control-write', gatesRaw: 'QA', reason: 'docs only' },
      null
    );
    expect(normal.allowed).toBe(true);
  });

  it('when a real docs skip is applied, should say the RECORD claims the provenance', async () => {
    // given: a docs rid, and the REAL writer (not a planted record)
    await seedRequest(ws().path, 'rid-docs-provenance', 'docs');
    const applied = await applySkip(ws().path, SESSION_ID, {
      rid: 'rid-docs-provenance',
      gatesRaw: 'QA',
      reason: 'documentation only'
    });
    expect(applied.applied).toBe(true);
    const state = readSkipState(ws().path, SESSION_ID, 'rid-docs-provenance');
    expect(state).not.toBeNull();
    if (state === null) return;

    // when:  the pipeline reports the honoured skip
    const result = await verifyPipeline({
      projectRoot: ws().path,
      rid: 'rid-docs-provenance',
      sessionId: SESSION_ID
    });
    const line = result.nextActions.find((action) => action.startsWith('Skipped gates'));

    // then:  the line carries who the RECORD says applied it, when, and from what
    //        caller — a local file cannot prove it, so the wording does not claim it
    expect(line).toBeDefined();
    expect(line).toContain(`record says applied by ${state.skipAppliedBy}`);
    expect(line).toContain(`at ${state.skipAppliedAt}`);
    expect(line).toContain(`caller: ${state.callerKind}`);
    expect(state.callerKind).toBe('human');
  });

  it('when git user.name is multi-line, should write a readable record with the fallback byline', async () => {
    // given: the function reads `git config --global user.name`, so the global
    //        file is redirected for this arm; a multi-line value is one the
    //        reader refuses, so the writer must not put it in the record
    await seedRequest(ws().path, 'rid-docs-multiline-name', 'docs');
    await seedRequest(ws().path, 'rid-docs-single-line-name', 'docs');
    const configPath = join(ws().path, 'gitconfig');
    const previous = process.env.GIT_CONFIG_GLOBAL;
    const setConfig = (name: string): void => {
      writeFileSync(configPath, `[user]\n\tname = "${name}"\n`, 'utf8');
      process.env.GIT_CONFIG_GLOBAL = configPath;
    };
    try {
      setConfig('First\\nSecond');
      const applied = await applySkip(ws().path, SESSION_ID, {
        rid: 'rid-docs-multiline-name',
        gatesRaw: 'QA',
        reason: 'documentation only'
      });
      expect(applied.applied).toBe(true);
      const multiline = readSkipState(ws().path, SESSION_ID, 'rid-docs-multiline-name');

      // then:  the record is HONOURED (non-null) and carries the fixed fallback
      expect(multiline).not.toBeNull();
      expect(multiline?.skipAppliedBy).toBe('unknown');

      // and:   a single-line name is written unchanged
      setConfig('Single Author');
      await applySkip(ws().path, SESSION_ID, {
        rid: 'rid-docs-single-line-name',
        gatesRaw: 'QA',
        reason: 'documentation only'
      });
      expect(readSkipState(ws().path, SESSION_ID, 'rid-docs-single-line-name')?.skipAppliedBy).toBe(
        'Single Author'
      );
    } finally {
      if (previous === undefined) delete process.env.GIT_CONFIG_GLOBAL;
      else process.env.GIT_CONFIG_GLOBAL = previous;
    }
  });
});
