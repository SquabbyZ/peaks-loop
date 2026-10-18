// tests/unit/services/artifacts/prereq-unmet-kind.test.ts
//
// The `missing` array used to carry only `{ path, description }`, so a file
// that was PRESENT and failed its body contract looked exactly like a file
// that was absent unless a consumer parsed the prose. `kind` is the
// machine-readable discriminator, and the transition message now splits the
// total by it.
//
// MEASURED BEFORE THE CHANGE (three rd:qa-handoff FEATURE cases, same seed):
//   - `## Test cases`, no `test(` / `it(`  → 1 entry, path qa/test-cases/<rid>.md
//   - neither marker                        → 2 entries, BOTH at that same path
//   - both markers                          → 0 entries, ok:true
// The two entries in the second case are DISTINCT requirements (the heading and
// the idiom), not the same one reported twice, so the assertions below pin that
// distinction rather than collapsing the case to one entry. Removing
// `UNIT_TESTS.mustContain` would not preserve the contract here: `TEST_CASES`
// owns `## Test cases` only at `qa:running` / `qa:verdict-issued`, never at the
// `rd:qa-handoff` transition this gate observes.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  judgedDeclarationSection,
  writeJudgedFixtureSource
} from './_judged-declaration-fixture.js';
import { checkPrerequisites } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import {
  unmetPrerequisiteMessage,
  type UnmetPrerequisite
} from '../../../../src/services/artifacts/prerequisite-checks.js';
import { PrerequisitesNotSatisfiedError } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';

declareDimensions('tests/unit/services/artifacts/prereq-unmet-kind.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-09-16-session-5bcf09';
const RID = '2026-09-16-codegraph-index-integrity';
const TEST_CASES_PATH = `qa/test-cases/${RID}.md`;

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

function writeArtifact(root: string, relative: string, body: string): void {
  const absolute = join(root, '.peaks', '_runtime', SESSION_ID, relative);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

/** Every other rd:qa-handoff artifact, so only the test-cases case varies. */
function seedSlice(root: string, testCasesBody: string | null): void {
  writeJudgedFixtureSource(root);
  writeArtifact(
    root,
    'prd/handoff.md',
    '---\nschemaVersion: 2\nsha256: deadbeef\n---\n\n# Handoff\n'
  );
  writeArtifact(
    root,
    `audit/security-${RID}.md`,
    `---\nrid: ${RID}\n---\n\n## Verdict\n\nwarn\n` + judgedDeclarationSection()
  );
  writeArtifact(root, `audit/perf-${RID}.md`, '## Baseline\n\n| metric | before | after |\n');
  writeArtifact(root, `rd/code-review-${RID}.md`, '## Findings\n\nCRITICAL: none.\n');
  writeArtifact(
    root,
    `rd/karpathy-review-${RID}.md`,
    [
      '## Karpathy-Gate',
      '## Think Before Coding',
      '## Simplicity First',
      '## Surgical Changes',
      '## Goal-Driven Execution',
      ''
    ].join('\n')
  );
  writeArtifact(root, 'qa/.initiated', '');
  if (testCasesBody !== null) writeArtifact(root, TEST_CASES_PATH, testCasesBody);
}

function makeProject(testCasesBody: string | null): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-prereq-kind-'));
  tempRoots.push(root);
  seedSlice(root, testCasesBody);
  return root;
}

async function runGate(root: string): Promise<{ ok: boolean; missing: UnmetPrerequisite[] }> {
  const result = await checkPrerequisites({
    projectRoot: root,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestType: 'feature',
    requestId: RID,
    emitEvents: false
  });
  return {
    ok: result.ok,
    missing: result.missing.map((entry) => ({
      ...entry,
      path: entry.path.replace(/\\/g, '/')
    }))
  };
}

const HEADING_ONLY_BODY = '## Test cases\n\nAll tests are green, nothing to report.\n';
const NEITHER_MARKER_BODY = '# Test cases summary\n\nAll tests are green.\n';
const VALID_BODY = "## Test cases\n\nit('when x, should y', () => {});\n";

describe('render — the entry shape', () => {
  it('should keep path and description unchanged and add kind', async () => {
    const { missing } = await runGate(makeProject(HEADING_ONLY_BODY));

    expect(Object.keys(missing[0] ?? {}).sort()).toEqual(['description', 'kind', 'path']);
  });
});

describe('behavior — kind names how the file failed', () => {
  it('when the file exists but carries neither test idiom, should report kind body', async () => {
    const { ok, missing } = await runGate(makeProject(HEADING_ONLY_BODY));

    expect(ok).toBe(false);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.path).toBe(TEST_CASES_PATH);
    expect(missing[0]?.kind).toBe('body');
  });

  it('when the file is absent, should report kind absent', async () => {
    const { ok, missing } = await runGate(makeProject(null));

    expect(ok).toBe(false);
    expect(missing).toHaveLength(1);
    expect(missing[0]?.path).toBe(TEST_CASES_PATH);
    expect(missing[0]?.kind).toBe('absent');
  });

  it('when the file satisfies the contract, should pass with no missing entries', async () => {
    const { ok, missing } = await runGate(makeProject(VALID_BODY));

    expect(ok).toBe(true);
    expect(missing).toEqual([]);
  });

  it('when two distinct body requirements fail, should not repeat one requirement for a path', async () => {
    // The measured case-2 shape: two entries, one path, two DIFFERENT
    // requirements. The assertion is "no exact duplicate", not "one entry" —
    // collapsing them would drop the heading check.
    const { missing } = await runGate(makeProject(NEITHER_MARKER_BODY));

    expect(missing).toHaveLength(2);
    expect(missing.every((entry) => entry.path === TEST_CASES_PATH)).toBe(true);
    expect(missing.every((entry) => entry.kind === 'body')).toBe(true);
    expect(missing[0]?.description).not.toBe(missing[1]?.description);
    const unique = new Set(
      missing.map((entry) => `${entry.path}\u0000${entry.description}\u0000${entry.kind}`)
    );
    expect(unique.size).toBe(missing.length);
  });
});

describe('a11y — the refusal message a producer reads', () => {
  function message(missing: UnmetPrerequisite[]): string {
    return new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', SESSION_ID, missing).message;
  }

  it('when only body checks failed, should say present but invalid and never missing artifact', () => {
    const text = message([
      { kind: 'body', path: TEST_CASES_PATH, description: 'body contract failed' }
    ]);

    expect(text).toContain('1 unmet requirement');
    expect(text).toContain('1 present but invalid');
    expect(text).not.toContain('missing artifact');
  });

  it('when only files are absent, should say missing artifact and not present but invalid', () => {
    const text = message([{ kind: 'absent', path: TEST_CASES_PATH, description: 'absent' }]);

    expect(text).toContain('1 missing artifact');
    expect(text).not.toContain('present but invalid');
  });

  it('when both kinds are present, should split the counts rather than print a bare total', () => {
    const text = message([
      { kind: 'absent', path: 'a.md', description: 'absent' },
      { kind: 'body', path: 'b.md', description: 'invalid' }
    ]);

    expect(text).toContain('2 unmet requirements: 1 missing artifact, 1 present but invalid');
    expect(unmetPrerequisiteMessage('rd', 'qa-handoff', SESSION_ID, [])).toContain(
      '0 unmet requirements under'
    );
  });

  it('when the missing list is empty, should still name the total without a count clause', () => {
    const text = unmetPrerequisiteMessage('rd', 'qa-handoff', SESSION_ID, []);

    expect(text).toBe(
      `Cannot transition rd to qa-handoff: 0 unmet requirements under .peaks/_runtime/${SESSION_ID}/`
    );
  });
});

describe('integration — the measured before/after shape on disk', () => {
  it('when the artifact is absent on disk, should resolve kind absent through the real resolver', async () => {
    const root = makeProject(null);
    const { missing } = await runGate(root);

    expect(missing.map((entry) => entry.kind)).toEqual(['absent']);
  });

  it('when the same seed as the body-only measurement is used, should keep the one-entry shape', async () => {
    // Pins the measured "before" shape: case 1 produced exactly one entry.
    const { missing } = await runGate(makeProject(HEADING_ONLY_BODY));

    expect(missing).toHaveLength(1);
    expect(missing[0]?.description).toContain('none of the escape-hatch markers present');
  });
});
