import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  DesignEvidencePathError,
  markerOf,
  renderConformanceMarkdown,
  sha256OfResult,
  writeConformanceEvidence
} from '../../../src/services/design/design-evidence.js';
import type { DesignCheckResult } from '../../../src/services/design/design-check.js';

declareDimensions('tests/unit/design/design-evidence.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

const GENERATED_AT = '2026-11-24T00:00:00.000Z';

/** The digest of `passResult()` as the check returns it — pinned, not recomputed. */
const PASS_RESULT_SHA256 = '43bb2864a94a65f1c3116ff8469788729a1a9db5840c068234e9a4a0bb245123';

function metaFor(sha256: string) {
  return { rid: 'r1', sessionId: 'sid-1', generatedAt: GENERATED_AT, sha256 };
}

function passResult(overrides: Partial<DesignCheckResult> = {}): DesignCheckResult {
  return {
    schemaVersion: 1,
    rid: 'r1',
    verdict: 'pass',
    surface: { isUi: true, reasons: ['changed: app/src/a.tsx'] },
    checks: {
      g1_source: { status: 'pass', findings: [] },
      g2_render: { status: 'pass', pages: 1, evidence: ['ok'] }
    },
    findings: [],
    coverage: null,
    ...overrides
  };
}

function failingResult(): DesignCheckResult {
  const finding = {
    code: 'DESIGN_INLINE_STYLE' as const,
    file: 'app/src/a.tsx',
    line: 3,
    severity: 'fail' as const,
    message: 'inline style attribute'
  };
  return passResult({
    verdict: 'fail',
    checks: {
      g1_source: { status: 'fail', findings: [finding] },
      g2_render: { status: 'skipped', reason: 'source-only' }
    },
    findings: [finding]
  });
}

const roots: string[] = [];
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-design-evidence-'));
  roots.push(root);
  return root;
}

function writeInput(root: string, result: DesignCheckResult) {
  return {
    projectRoot: root,
    sessionId: 'sid-1',
    rid: 'r1',
    result,
    now: () => new Date(GENERATED_AT)
  };
}

describe('Scenario: behavior — the marker outranks the verdict it came from', () => {
  it('when acceptedBy is set, should mark accepted rather than pass', () => {
    // given: a source-only pass with a recorded acceptance
    // when: the conformance marker is read
    // then: the marker names the acceptance, not the underlying verdict
    expect(markerOf(passResult({ acceptedBy: 'sid-1' }))).toBe('accepted');
  });

  it('when a fail carries an acceptance, should keep the fail marker', () => {
    // given: a failing check that also recorded an acceptance
    // when: the conformance marker is read
    // then: an acceptance cannot upgrade a fail — the marker stays fail
    expect(markerOf(passResult({ verdict: 'fail', acceptedBy: 'sid-1' }))).toBe('fail');
  });

  it('when a blocked check carries an acceptance, should keep the blocked marker', () => {
    // given: a blocked check that also recorded an acceptance
    // when: the conformance marker is read
    // then: an acceptance cannot upgrade a blocked check — the marker stays blocked
    expect(markerOf(passResult({ verdict: 'blocked', acceptedBy: 'sid-1' }))).toBe('blocked');
  });

  it('when no acceptance is recorded, should map each verdict one to one', () => {
    // given: one result per check verdict, none of them accepted
    // when: each marker is read
    // then: every verdict names itself
    const verdicts = ['pass', 'fail', 'blocked', 'not-adopted', 'not-applicable'] as const;
    for (const verdict of verdicts) {
      expect(markerOf(passResult({ verdict }))).toBe(verdict);
    }
  });

  it('when the result is hashed, should return the digest of that exact result', () => {
    // given: the fixed result envelope the other tests render
    // when: its evidence hash is computed
    // then: the digest is the pinned sha256 of the result as the check returned
    //       it — recomputing the same hash on both sides would hide a no-op
    expect(sha256OfResult(passResult())).toBe(PASS_RESULT_SHA256);
  });
});

describe('Scenario: render — the markdown carries the markers the gate reads', () => {
  it('when the markdown is rendered, should carry the three prerequisite markers', () => {
    // given: a pass result and its evidence metadata
    // when: the markdown is rendered
    // then: schemaVersion, sha256 and the design conformance heading are all present
    const sha256 = sha256OfResult(passResult());
    const markdown = renderConformanceMarkdown(passResult(), {
      rid: 'r1',
      sessionId: 'sid-1',
      generatedAt: GENERATED_AT,
      sha256
    });

    expect(markdown).toContain('schemaVersion: 1');
    expect(markdown).toContain(`sha256: ${sha256}`);
    expect(markdown).toContain('## Design conformance');
    expect(markdown).toContain('design-conformance: pass');
  });

  it('when the result has no findings, should render every section deterministically', () => {
    // given: a pass result whose sections are empty
    // when: the markdown is rendered
    // then: the header, surface, checks and findings sections are all present
    const markdown = renderConformanceMarkdown(passResult(), {
      rid: 'r1',
      sessionId: 'sid-1',
      generatedAt: GENERATED_AT,
      sha256: 'abc'
    });

    expect(markdown).toContain('rid: r1');
    expect(markdown).toContain('session: sid-1');
    expect(markdown).toContain('- isUi: true');
    expect(markdown).toContain('- g1_source: pass (0 findings)');
    expect(markdown).toContain('- g2_render: pass');
    expect(markdown).toContain('## Findings\n- (none)\n');
  });

  it('when the document is rendered, should emit every line the gate and a reader see', () => {
    // given: a pass result and its evidence metadata
    // when: the whole markdown is rendered
    // then: it is exactly this document — separators, headings, metadata and
    //       the per-section lines included, with no extra or missing line
    const markdown = renderConformanceMarkdown(passResult(), metaFor(PASS_RESULT_SHA256));

    expect(markdown).toBe(
      [
        'schemaVersion: 1',
        'rid: r1',
        'session: sid-1',
        `generatedAt: ${GENERATED_AT}`,
        `sha256: ${PASS_RESULT_SHA256}`,
        '',
        '## Design conformance',
        'design-conformance: pass',
        '',
        '## Surface',
        '- isUi: true',
        '- reason: changed: app/src/a.tsx',
        '',
        '## Checks',
        '- g1_source: pass (0 findings)',
        '- g2_render: pass',
        '',
        '## Findings',
        '- (none)',
        ''
      ].join('\n')
    );
  });

  it('when the surface carries reasons, should render each as its own line', () => {
    // given: a result whose surface detection recorded two reasons
    // when: the markdown is rendered
    // then: both reasons appear as bullets and the none marker does not
    const result = passResult({
      surface: { isUi: true, reasons: ['changed: app/src/b.tsx', 'route: /pricing'] }
    });

    const markdown = renderConformanceMarkdown(result, metaFor('abc'));

    expect(markdown).toContain('- reason: changed: app/src/b.tsx\n- reason: route: /pricing');
    expect(markdown).not.toContain('- reason: (none)');
  });

  it('when the surface has no reasons, should render the none marker only', () => {
    // given: a result with no UI surface and no recorded reasons
    // when: the markdown is rendered
    // then: the surface section says none instead of carrying bullets
    const result = passResult({ surface: { isUi: false, reasons: [] } });

    const markdown = renderConformanceMarkdown(result, metaFor('abc'));

    expect(markdown).toContain('- isUi: false\n- reason: (none)\n');
    expect(markdown).not.toContain('- reason: changed');
  });

  it('when findings exist, should render every finding with its code and location', () => {
    // given: a failing result whose finding names the file, line and message
    // when: the markdown is rendered
    // then: the findings section carries that exact line, not the none marker
    const markdown = renderConformanceMarkdown(failingResult(), metaFor('abc'));

    expect(markdown).toContain(
      '- DESIGN_INLINE_STYLE (fail) app/src/a.tsx:3: inline style attribute'
    );
    expect(markdown).not.toContain('- (none)');
  });
});

describe('Scenario: integration — the evidence pair is written under the session', () => {
  it('when the verdict is fail, should still write the evidence and carry the fail marker', async () => {
    // given: a failing check result
    // when: the evidence is written
    // then: both files exist and the markdown says the verdict failed
    const root = makeRoot();
    const written = await writeConformanceEvidence(writeInput(root, failingResult()));

    expect(existsSync(written.markdownPath)).toBe(true);
    expect(existsSync(written.jsonPath)).toBe(true);
    expect(readFileSync(written.markdownPath, 'utf8')).toContain('design-conformance: fail');
  });

  it('when the json is re-read, should carry a sha256 that recomputes over the result', async () => {
    // given: a written evidence pair
    // when: the json is parsed and its metadata stripped
    // then: the stored sha256 is the hash of the result as the check returned it
    const root = makeRoot();
    const result = passResult();
    const written = await writeConformanceEvidence(writeInput(root, result));
    const document = JSON.parse(readFileSync(written.jsonPath, 'utf8')) as Record<string, unknown>;
    const { sha256, session, generatedAt, evidencePath, ...storedResult } = document;

    expect(sha256).toBe(sha256OfResult(storedResult as DesignCheckResult));
    expect(sha256).toBe(sha256OfResult(result));
    expect(written.sha256).toBe(sha256OfResult(result));
    expect(session).toBe('sid-1');
    expect(generatedAt).toBe(GENERATED_AT);
    expect(evidencePath).toBe('.peaks/_runtime/sid-1/design/check-r1.md');

    const markdown = readFileSync(written.markdownPath, 'utf8');
    expect(markdown).toContain('rid: r1');
    expect(markdown).toContain('session: sid-1');
    expect(markdown).toContain(`generatedAt: ${GENERATED_AT}`);
    expect(markdown).toContain(`sha256: ${written.sha256}`);
  });

  it('when the session directory is missing, should create the design directory', async () => {
    // given: a project root with no runtime tree
    // when: the evidence is written
    // then: the session design directory is created under _runtime
    const root = makeRoot();
    const written = await writeConformanceEvidence(writeInput(root, passResult()));

    expect(existsSync(join(root, '.peaks', '_runtime', 'sid-1', 'design', 'check-r1.md'))).toBe(
      true
    );
    expect(existsSync(dirname(written.jsonPath))).toBe(true);
  });

  it('when no clock is injected, should stamp the write with the current time', async () => {
    // given: a write input that carries no `now` override
    // when: the evidence pair is written
    // then: generatedAt is a real ISO timestamp from the system clock
    const root = makeRoot();
    const { projectRoot, sessionId, rid, result } = writeInput(root, passResult());

    const written = await writeConformanceEvidence({ projectRoot, sessionId, rid, result });
    const document = JSON.parse(readFileSync(written.jsonPath, 'utf8')) as { generatedAt: string };

    expect(document.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('when the json write fails, should leave no markdown behind', async () => {
    // given: a directory occupying the json path, so the json write must fail
    // when: the evidence pair is written
    // then: the write error surfaces and the gate-read markdown was never written
    const root = makeRoot();
    const designDir = join(root, '.peaks', '_runtime', 'sid-1', 'design');
    mkdirSync(join(designDir, 'check-r1.json'), { recursive: true });

    await expect(writeConformanceEvidence(writeInput(root, passResult()))).rejects.toThrow();

    expect(existsSync(join(designDir, 'check-r1.md'))).toBe(false);
  });

  it('when the markdown write fails, should remove the json this call wrote', async () => {
    // given: a directory occupying the markdown path, so the final write must fail
    // when: the evidence pair is written
    // then: the json written by this call is removed, and the pre-existing
    //       directory is left untouched
    const root = makeRoot();
    const designDir = join(root, '.peaks', '_runtime', 'sid-1', 'design');
    mkdirSync(join(designDir, 'check-r1.md'), { recursive: true });

    await expect(writeConformanceEvidence(writeInput(root, passResult()))).rejects.toThrow();

    expect(existsSync(join(designDir, 'check-r1.json'))).toBe(false);
    expect(statSync(join(designDir, 'check-r1.md')).isDirectory()).toBe(true);
  });

  it('when a path segment is not safe, should refuse before writing anything', async () => {
    // given: request and session ids that are not one path segment
    // when: the evidence is written
    // then: each refusal is a path error and the tree stays untouched
    const root = makeRoot();
    const unsafe = [
      { field: 'rid', rid: '../escape', sessionId: 'sid-1' },
      { field: 'rid', rid: 'a/b', sessionId: 'sid-1' },
      { field: 'rid', rid: 'a\\b', sessionId: 'sid-1' },
      { field: 'rid', rid: '..', sessionId: 'sid-1' },
      { field: 'sessionId', rid: 'r1', sessionId: '.' },
      { field: 'sessionId', rid: 'r1', sessionId: 'a/b' },
      { field: 'sessionId', rid: 'r1', sessionId: '' }
    ] as const;

    for (const entry of unsafe) {
      await expect(
        writeConformanceEvidence({ ...writeInput(root, passResult()), ...entry })
      ).rejects.toMatchObject({ field: entry.field });
    }
    expect(existsSync(join(root, '.peaks'))).toBe(false);
  });
});

describe('Scenario: a11y — the refusal text names the offending field', () => {
  it('when a segment is refused, should name the field and the single-segment rule', async () => {
    // given: a request id containing a path separator
    // when: the write is attempted
    // then: the error text names the rid field and no file was written
    const root = makeRoot();
    const attempt = writeConformanceEvidence({
      ...writeInput(root, passResult()),
      rid: 'a/b'
    });

    await expect(attempt).rejects.toBeInstanceOf(DesignEvidencePathError);
    await expect(attempt).rejects.toThrow(/rid.*single path segment/);
    await expect(attempt).rejects.toMatchObject({
      name: 'DesignEvidencePathError',
      code: 'DESIGN_EVIDENCE_PATH_INVALID',
      field: 'rid'
    });
  });
});
