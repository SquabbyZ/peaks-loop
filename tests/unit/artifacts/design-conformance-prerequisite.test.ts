import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  makeProjectRoot,
  RID_A,
  seedCompleteSlice,
  sessionRootOf,
  tempRoots,
  writeArtifact
} from '../services/artifacts/_audit-artifact-rid-fixtures.js';
import {
  checkPrerequisites,
  PREREQUISITES_BY_TYPE,
  type ArtifactPrerequisite,
  type RequestType
} from '../../../src/services/artifacts/artifact-prerequisites.js';
import { DESIGN_CONFORMANCE } from '../../../src/services/artifacts/design-conformance-prerequisite.js';
import { prerequisiteBodyViolations } from '../../../src/services/artifacts/prerequisite-checks.js';
import type { DesignCheckResult } from '../../../src/services/design/design-check.js';
import {
  renderConformanceMarkdown,
  sha256OfResult
} from '../../../src/services/design/design-evidence.js';

declareDimensions(
  'tests/unit/artifacts/design-conformance-prerequisite.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'the prerequisite prints nothing; the warning text a human reads is rendered by the transition CLI and pinned in tests/unit/services/artifacts/back-compat-warning-code.test.ts'
    }
  ]
);

const SESSION_ID = '2026-09-13-session-21878f';
const DESIGN_RELATIVE = 'design/check-<rid>.md';
const DESIGN_PATH = `design/check-${RID_A}.md`;

const VALID_BODY = [
  'schemaVersion: 1',
  `rid: ${RID_A}`,
  'sha256: 0000000000000000000000000000000000000000000000000000000000000000',
  '',
  '## Design conformance',
  'design-conformance: pass',
  ''
].join('\n');

const NO_HEADING_BODY = [
  'schemaVersion: 1',
  `rid: ${RID_A}`,
  'sha256: 0000000000000000000000000000000000000000000000000000000000000000',
  '',
  'design-conformance: pass',
  ''
].join('\n');

function rowsFor(type: RequestType): readonly ArtifactPrerequisite[] {
  return PREREQUISITES_BY_TYPE[type]['rd:qa-handoff'] ?? [];
}

function carriesDesign(type: RequestType): boolean {
  return rowsFor(type).some((row) => row.relativePath === DESIGN_CONFORMANCE.relativePath);
}

function posix(path: string): string {
  return path.replace(/\\/g, '/');
}

/**
 * Re-import the constant inside a test. The declaration is a module-level
 * object literal, so evaluating it during collection hides every literal in it
 * from a mutation runner; clearing the module registry and importing again
 * evaluates the (possibly mutated) module WHILE the test is running.
 */
async function reloadDesignConformance(): Promise<ArtifactPrerequisite> {
  vi.resetModules();
  const module = await import('../../../src/services/artifacts/design-conformance-prerequisite.js');
  return module.DESIGN_CONFORMANCE;
}

/** The real gate, on a tree that already satisfies every HARD rd:qa-handoff
 *  prerequisite, so each arm isolates the design-conformance artifact. */
async function runGate(projectRoot: string): Promise<{
  ok: boolean;
  missing: Array<{ path: string; kind: 'absent' | 'body' }>;
  warnings: Array<{ path: string; code: string }>;
}> {
  const result = await checkPrerequisites({
    projectRoot,
    sessionId: SESSION_ID,
    role: 'rd',
    newState: 'qa-handoff',
    requestType: 'feature',
    requestId: RID_A,
    emitEvents: false
  });
  return {
    ok: result.ok,
    missing: result.missing.map((entry) => ({ path: posix(entry.path), kind: entry.kind })),
    warnings: result.warnings.map((entry) => ({ path: posix(entry.path), code: entry.code }))
  };
}

function projectWithDesignBody(body: string | null): string {
  const root = makeProjectRoot();
  seedCompleteSlice(root, RID_A);
  if (body !== null) writeArtifact(root, DESIGN_PATH, body);
  return root;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('render — the prerequisite is declared once per gated table', () => {
  it('when the declaration is read, should pin the accepted verdicts and the back-compat window', async () => {
    // given: the shipped DESIGN_CONFORMANCE constant, loaded inside this test
    // when: its declared contract is read off the object
    // then: the path, the hard markers, the four accepted verdicts and the
    //       one-minor back-compat window are exactly what the gate reads
    const declaration = await reloadDesignConformance();
    expect(declaration.relativePath).toBe(DESIGN_RELATIVE);
    expect(declaration.mustContain).toEqual([
      'schemaVersion: 1',
      'sha256:',
      '## Design conformance'
    ]);
    expect(declaration.mustContainAny).toEqual([
      'design-conformance: pass',
      'design-conformance: not-applicable',
      'design-conformance: not-adopted',
      'design-conformance: accepted'
    ]);
    expect(declaration.backCompat).toBe(true);
    expect(declaration.backCompatUntil).toBe('v4.4.0');
    expect(declaration.description).toContain('blocked');
  });

  it('when feature and bugfix hand off, should carry it once in each table', () => {
    // given: the two tables the plan names
    // when: their rd:qa-handoff rows are filtered by the artifact path
    // then: each carries exactly one entry, and it is the shipped object — a
    //       copy would drift from the constant the body contract is read from
    for (const type of ['feature', 'bugfix'] as const) {
      const matches = rowsFor(type).filter(
        (row) => row.relativePath === DESIGN_CONFORMANCE.relativePath
      );
      expect(matches, type).toHaveLength(1);
      expect(matches[0], type).toBe(DESIGN_CONFORMANCE);
    }
  });

  it('when refactor hands off, should carry it through the feature-table alias', () => {
    // given: REFACTOR_TABLE is a reference to FEATURE_TABLE
    // when: the refactor row is read
    // then: the prerequisite is present without a second wiring edit
    expect(PREREQUISITES_BY_TYPE.refactor).toBe(PREREQUISITES_BY_TYPE.feature);
    expect(carriesDesign('refactor')).toBe(true);
  });

  it('when docs, config or chore hand off, should not carry it', () => {
    // given: the three types with no design surface
    // when: their rd:qa-handoff rows are read
    // then: the prerequisite appears in none of them
    for (const type of ['docs', 'config', 'chore'] as const) {
      expect(carriesDesign(type), type).toBe(false);
    }
  });
});

describe('behavior — the body contract decides pass or fail', () => {
  it('when the body carries every marker, should pass the gate', async () => {
    // given: a body with schemaVersion, sha256, the heading and a pass verdict
    // when: the real rd:qa-handoff gate runs
    // then: the design path is neither missing nor warned about
    const result = await runGate(projectWithDesignBody(VALID_BODY));

    expect(result.missing.map((entry) => entry.path)).not.toContain(DESIGN_PATH);
    expect(result.warnings.map((entry) => entry.path)).not.toContain(DESIGN_PATH);
    expect(result.ok).toBe(true);
  });

  it('when the verdict is fail, should refuse the handoff', async () => {
    // given: a complete evidence file whose verdict is fail
    // when: the real gate runs
    // then: the path is reported as a body violation, and the gate is not ok
    const result = await runGate(
      projectWithDesignBody(
        VALID_BODY.replace('design-conformance: pass', 'design-conformance: fail')
      )
    );

    expect(result.missing).toContainEqual({ path: DESIGN_PATH, kind: 'body' });
    expect(result.ok).toBe(false);
  });

  it('when the verdict is blocked, should refuse rather than treat it as a pass', async () => {
    // given: the verdict the checker emits when it could not run at all
    // when: the real gate runs
    // then: blocked is not among the accepted markers, so the handoff is refused
    const result = await runGate(
      projectWithDesignBody(
        VALID_BODY.replace('design-conformance: pass', 'design-conformance: blocked')
      )
    );

    expect(result.missing).toContainEqual({ path: DESIGN_PATH, kind: 'body' });
    expect(result.ok).toBe(false);
  });

  it('when a fail reason names the pass marker, should still refuse the handoff', () => {
    // given: a failing check whose surface reasons carry the pass marker, a lone CR and a CRLF
    // when: the prerequisite reads the gate-relevant body it was given
    // then: the only violation is the fail refusal — no accepted marker was injected
    const result: DesignCheckResult = {
      schemaVersion: 1,
      rid: RID_A,
      verdict: 'fail',
      surface: {
        isUi: true,
        reasons: [
          'changed: design-conformance: pass.tsx',
          'changed: a.tsx\r## forged\r\n## Design conformance'
        ]
      },
      checks: {
        g1_source: { status: 'fail', findings: [] },
        g2_render: { status: 'skipped', reason: 'source-only' },
        g3_exemplar: { g3a: [], g3b: [] }
      },
      findings: [],
      coverage: null
    };
    const markdown = renderConformanceMarkdown(result, {
      rid: RID_A,
      sessionId: SESSION_ID,
      generatedAt: '2026-11-24T00:00:00.000Z',
      sha256: sha256OfResult(result)
    });

    const violations = prerequisiteBodyViolations(DESIGN_CONFORMANCE, markdown);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toContain('none of the escape-hatch markers present');
    expect(markdown.toLowerCase()).not.toContain('design-conformance: pass');
    expect(markdown).toContain('- reason: changed: design-conformance_ pass.tsx');
    expect(markdown).not.toContain('\r');
    expect(markdown.split('\n').filter((line) => /^#{1,3}\s/.test(line))).toHaveLength(4);
  });

  it('when the body lacks the design-conformance heading, should refuse it', async () => {
    // given: a body with the verdict but no `## Design conformance` section
    // when: the real gate runs
    // then: the missing heading is a body violation, not a silent pass
    const result = await runGate(projectWithDesignBody(NO_HEADING_BODY));

    expect(result.missing).toContainEqual({ path: DESIGN_PATH, kind: 'body' });
    expect(result.ok).toBe(false);
  });
});

describe('integration — a missing file soft-blocks inside the declared window', () => {
  it('when the evidence file is absent, should warn by name instead of failing', async () => {
    // given: a session tree with every hard prerequisite and no design evidence
    // when: the real gate runs at rd:qa-handoff
    // then: the warning names the artifact and its closing release, and the
    //       handoff still succeeds because the window is open
    const result = await runGate(projectWithDesignBody(null));

    const designWarning = result.warnings.find((entry) => entry.path === DESIGN_PATH);
    expect(designWarning).toBeDefined();
    expect(designWarning?.code).toBe('check-<rid>-missing-deprecated-in-v4.4.0');
    expect(result.missing.map((entry) => entry.path)).not.toContain(DESIGN_PATH);
    expect(result.ok).toBe(true);
  });

  it('when the file is written by --gate, should resolve the rid-scoped path on disk', async () => {
    // given: the exact path the evidence writer targets
    // when: the file is laid down and the gate reads the session tree
    // then: it resolves (no numbered-prefix tolerance is needed for this shape)
    const root = projectWithDesignBody(VALID_BODY);
    const result = await runGate(root);

    expect(existsSync(join(sessionRootOf(root), 'design', `check-${RID_A}.md`))).toBe(true);
    expect(result.missing).toEqual([]);
  });
});
