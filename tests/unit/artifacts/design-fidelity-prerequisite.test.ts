// tests/unit/artifacts/design-fidelity-prerequisite.test.ts
//
// S4.3: the fidelity verdict decides `rd:qa-handoff`. The prerequisite is
// conditional on the project, which is why it cannot be a plain file probe:
// a project with no adopted design contract must stay open, while one that has
// adopted the contract must not hand off without reading its own prototype.
//
// The five branches the brief names are exercised through the REAL
// `checkPrerequisites` on a session tree that already satisfies every other
// handoff prerequisite, so each arm isolates this artifact:
//   no contract / missing artifact / pass / fail / not-applicable
// plus the two shapes the fail branch implies: `blocked` and "one failing
// artifact among several".
//
// Dimensions:
//   - render:      OMITTED — the artifact's markdown is rendered by
//                  `fidelity-evidence.ts`, tested under tests/unit/design/
//   - behavior:    the verdict branches and the named refusal codes
//   - integration: the real gate against a real session tree and a real
//                  frontend project with the four contract files
//   - a11y:        the refusal sentence a human reads (path, code, reason)

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  makeProjectRoot,
  RID_A,
  seedCompleteSlice,
  tempRoots,
  writeArtifact
} from '../services/artifacts/_audit-artifact-rid-fixtures.js';
import {
  checkPrerequisites,
  PREREQUISITES_BY_TYPE,
  type ArtifactPrerequisite,
  type RequestType
} from '../../../src/services/artifacts/artifact-prerequisites.js';
import {
  DESIGN_FIDELITY,
  DESIGN_FIDELITY_BLOCKED,
  DESIGN_FIDELITY_FAILED,
  DESIGN_FIDELITY_MISSING,
  DESIGN_FIDELITY_RELATIVE_PATH
} from '../../../src/services/artifacts/design-fidelity-prerequisite.js';

declareDimensions(
  'tests/unit/artifacts/design-fidelity-prerequisite.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the artifact markdown is rendered and tested by tests/unit/design/fidelity-evidence.test.ts; this gate only reads it'
    }
  ]
);

const SESSION_ID = '2026-09-13-session-21878f';
const ARTIFACT_PATH = 'design/fidelity/root.md';
const CONTRACT_FILES = ['contract.md', 'tokens.json', 'paved-road.json', 'engine.json'];

const ACCEPTED_VERDICTS = ['pass', 'not-applicable'] as const;

function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

function fidelityBody(verdict: string, reason = '(none)'): string {
  return [
    'schemaVersion: 1',
    'route: /',
    `session: ${SESSION_ID}`,
    'generatedAt: 2026-11-28T00:00:00.000Z',
    'sha256: deadbeef',
    'mode: prod',
    'prototype: (none)',
    '## Fidelity',
    `design-fidelity: ${verdict}`,
    `reason: ${reason}`,
    '',
    '## Viewports',
    '- (none)',
    ''
  ].join('\n');
}

/** A session that satisfies every other feature handoff prerequisite. */
function seededSession(): string {
  const root = makeProjectRoot();
  seedCompleteSlice(root, RID_A);
  return root;
}

function writeJson(projectRoot: string, relativePath: string, value: unknown): void {
  const absolute = join(projectRoot, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, JSON.stringify(value), 'utf8');
}

/** A frontend app root with all four contract files: `readDesignStatus`
 *  reports it adopted, exactly as `design check` resolves it. */
function adoptedContract(projectRoot: string): void {
  writeJson(projectRoot, 'package.json', { dependencies: { react: '19.0.0' } });
  mkdirSync(join(projectRoot, 'design'), { recursive: true });
  for (const name of CONTRACT_FILES) {
    const body = name.endsWith('.json') ? '{}\n' : '# Design contract\n';
    writeFileSync(join(projectRoot, 'design', name), body, 'utf8');
  }
}

type GateResult = Awaited<ReturnType<typeof checkPrerequisites>>;

async function runGate(
  projectRoot: string,
  requestType: RequestType = 'feature'
): Promise<GateResult> {
  return checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestId: RID_A,
    requestType,
    emitEvents: false
  });
}

/** The unmet entries this prerequisite owns, path-normalised for Windows. */
function fidelityEntries(
  result: GateResult
): Array<{ path: string; kind: string; description: string }> {
  return result.missing
    .filter((entry) => posix(entry.path).startsWith('design/fidelity/'))
    .map((entry) => ({
      path: posix(entry.path),
      kind: entry.kind,
      description: entry.description
    }));
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('render — the prerequisite is declared beside design conformance', () => {
  it('when the handoff tables are read, should carry one DESIGN_FIDELITY in feature and bugfix', () => {
    // given: the two tables the brief names
    // when: their rd:qa-handoff rows are filtered by the artifact class
    // then: each carries exactly one entry, and it is the shipped object
    for (const type of ['feature', 'bugfix'] as const) {
      const row = PREREQUISITES_BY_TYPE[type]['rd:qa-handoff'] ?? [];
      const matches: ReadonlyArray<ArtifactPrerequisite> = row.filter(
        (entry) => entry.dynamicGate === 'design-fidelity'
      );
      expect(matches, type).toHaveLength(1);
      expect(matches[0], type).toBe(DESIGN_FIDELITY);
    }
    expect(DESIGN_FIDELITY.relativePath).toBe(DESIGN_FIDELITY_RELATIVE_PATH);
    // Separate from conformance: no verdict marker of one satisfies the other.
    expect(DESIGN_FIDELITY.mustContainAny).toBeUndefined();
  });

  it('when refactor hands off, should carry it through the feature-table alias', () => {
    // given: refactor is documented as an alias of the feature table
    // when: their rd:qa-handoff rows are read
    // then: refactor resolves to the same table, and it carries DESIGN_FIDELITY
    expect(PREREQUISITES_BY_TYPE.refactor).toBe(PREREQUISITES_BY_TYPE.feature);
    const row = PREREQUISITES_BY_TYPE.refactor['rd:qa-handoff'] ?? [];
    expect(row).toContain(DESIGN_FIDELITY);
  });

  it('when docs, config or chore hand off, should not carry it', () => {
    // given: the three request types that adopt no design contract
    // when: each rd:qa-handoff row is read
    // then: none carries DESIGN_FIDELITY
    for (const type of ['docs', 'config', 'chore'] as const) {
      const row = PREREQUISITES_BY_TYPE[type]['rd:qa-handoff'] ?? [];
      expect(row, type).not.toContain(DESIGN_FIDELITY);
    }
  });
});

describe('behavior — the verdict branches decide the handoff', () => {
  it('when the project has no adopted design contract, should leave the handoff open', async () => {
    // given: a complete session in a project that is not a frontend and has no contract
    // when: the real gate runs
    // then: the prerequisite is not-applicable, with nothing written for it
    const result = await runGate(seededSession());

    expect(fidelityEntries(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('when a contract is adopted and no artifact exists, should refuse with DESIGN_FIDELITY_MISSING', async () => {
    // given: an adopted contract and no design/fidelity artifact at all
    // when: the real gate runs
    // then: the artifact class is absent and its description names the code
    const root = seededSession();
    adoptedContract(root);
    const result = await runGate(root);

    const entries = fidelityEntries(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(DESIGN_FIDELITY_RELATIVE_PATH);
    expect(entries[0]?.kind).toBe('absent');
    expect(entries[0]?.description).toContain(DESIGN_FIDELITY_MISSING);
    expect(result.ok).toBe(false);
  });

  it.each(ACCEPTED_VERDICTS)(
    'when the artifact records %s, should leave the handoff open',
    async (verdict) => {
      // given: an adopted contract and one acceptable verdict
      // when: the real gate runs
      // then: no fidelity requirement is unmet
      const root = seededSession();
      adoptedContract(root);
      writeArtifact(root, ARTIFACT_PATH, fidelityBody(verdict));
      const result = await runGate(root);

      expect(fidelityEntries(result)).toEqual([]);
      expect(result.ok).toBe(true);
    }
  );

  it('when the artifact records fail, should refuse with DESIGN_FIDELITY_FAILED and its reason', async () => {
    // given: a failing run whose reason names the measured score
    // when: the real gate runs
    // then: the refusal names the code, the artifact and the recorded reason
    const root = seededSession();
    adoptedContract(root);
    writeArtifact(root, ARTIFACT_PATH, fidelityBody('fail', 'score 0.62 below 0.95'));
    const result = await runGate(root);

    const entries = fidelityEntries(result);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(ARTIFACT_PATH);
    expect(entries[0]?.kind).toBe('body');
    expect(entries[0]?.description).toContain(DESIGN_FIDELITY_FAILED);
    expect(entries[0]?.description).toContain('score 0.62 below 0.95');
    expect(result.ok).toBe(false);
  });

  it('when the artifact records blocked, should refuse with DESIGN_FIDELITY_BLOCKED', async () => {
    // given: the verdict the writer emits when the oracle could not run
    // when: the real gate runs
    // then: a missing capability is never read as a pass
    const root = seededSession();
    adoptedContract(root);
    writeArtifact(root, ARTIFACT_PATH, fidelityBody('blocked', 'no spacing tokens'));
    const result = await runGate(root);

    const entries = fidelityEntries(result);
    expect(entries[0]?.description).toContain(DESIGN_FIDELITY_BLOCKED);
    expect(entries[0]?.description).toContain('no spacing tokens');
    expect(result.ok).toBe(false);
  });

  it('when one of two artifacts fails, should refuse the handoff', async () => {
    // given: a passing route and a failing route in the same session
    // when: the real gate runs
    // then: the failing artifact alone refuses, and the passing one is not named
    const root = seededSession();
    adoptedContract(root);
    writeArtifact(root, 'design/fidelity/root.md', fidelityBody('pass'));
    writeArtifact(root, 'design/fidelity/settings.md', fidelityBody('fail', 'anchor mismatch'));
    const result = await runGate(root);

    const entries = fidelityEntries(result);
    expect(entries.map((entry) => entry.path)).toEqual(['design/fidelity/settings.md']);
    expect(result.ok).toBe(false);
  });

  it('when the artifact carries no verdict line, should refuse rather than read it as a pass', async () => {
    // given: a file that exists but records no conclusion
    // when: the real gate runs
    // then: the absence of a verdict is a refusal, never a green handoff
    const root = seededSession();
    adoptedContract(root);
    writeArtifact(root, ARTIFACT_PATH, 'schemaVersion: 1\nsha256: deadbeef\n');
    const result = await runGate(root);

    const entries = fidelityEntries(result);
    expect(entries[0]?.description).toContain(DESIGN_FIDELITY_BLOCKED);
    expect(entries[0]?.description).toContain('no design-fidelity verdict');
    expect(result.ok).toBe(false);
  });

  it('when the bugfix table hands off, should apply the same verdict rule', async () => {
    // given: a bugfix slice with no artifact under an adopted contract
    // when: the gate runs with the bugfix table
    // then: the same refusal applies, so the row is wired in both arrays
    const root = seededSession();
    adoptedContract(root);
    const result = await runGate(root, 'bugfix');

    expect(fidelityEntries(result)[0]?.description).toContain(DESIGN_FIDELITY_MISSING);
    expect(result.ok).toBe(false);
  });
});

describe('integration — the check reads and never writes', () => {
  it('when the gate runs over an adopted contract, should leave the fidelity directory byte-identical', async () => {
    // given: one artifact on disk
    // when: the gate runs
    // then: nothing was created, deleted or rewritten
    const root = seededSession();
    adoptedContract(root);
    writeArtifact(root, ARTIFACT_PATH, fidelityBody('pass'));
    const directory = join(root, '.peaks', '_runtime', SESSION_ID, 'design', 'fidelity');
    const before = readdirSync(directory).sort();

    await runGate(root);

    expect(readdirSync(directory).sort()).toEqual(before);
  });
});
