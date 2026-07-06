import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock node:fs/promises so that readFile can be made to throw on demand.
// This exercises the error branch inside readFileContent.
// ---------------------------------------------------------------------------
let readFileShouldThrow = false;

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readFile: async (path: any, options?: any) => {
      if (readFileShouldThrow) {
        throw new Error('Simulated read error');
      }
      return actual.readFile(path, options);
    },
  };
});

import { verifyPipeline } from '../../src/services/workflow/pipeline-verify-service.js';

// ---------------------------------------------------------------------------
// Helpers
//
// As of slice 2026-06-05-change-id-as-unit-of-work, the on-disk scope of
// reviewable content is the change-id (the top-level dir under .peaks/),
// not the session-id. Tests write under a stable test-change-id dir
// (mimicking the new layout) and pass `sessionId: 'test-change-id'`
// explicitly to verifyPipeline so the resolved change-id is deterministic.
//
// Plan 1 followup hotfix (5cd4c87) made the on-disk root ONE-axis:
// `.peaks/_runtime/<sid>/<role>/requests/`. To preserve the verifyPipeline
// tests' intent (using test-change-id as a stable scope name), we
// treat test-change-id AS the session id and write under
// `.peaks/_runtime/test-change-id/...`. The verifyPipeline service
// then resolves the on-disk change-id from the file path, which
// equals test-change-id (the dir the file lives in).
// ---------------------------------------------------------------------------

function createTempProject(): { root: string; peaks: string } {
  const root = mkdtempSync(join(tmpdir(), 'peaks-pipeline-verify-'));
  // v2.17.0 canonical session-axis layout: request artifacts and
  // evidence live under `.peaks/_runtime/<sessionId>/<role>/...`.
  const peaks = join(root, '.peaks', '_runtime', 'test-change-id');
  mkdirSync(join(peaks, 'rd', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-cases'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-reports'), { recursive: true });
  // Non-.md entry to exercise the skip branch in findRequestFile
  writeFileSync(join(peaks, 'rd', 'requests', '.gitkeep'), '', 'utf8');
  // v2.18.1: the legacy change-axis dir (pre-v2.17.0 canonical) is
  // no longer the canonical scope. It is kept here as a back-compat
  // fallback target for tests that explicitly write evidence under
  // the change-axis form to assert DEPRECATION_LEGACY_PATH_USED
  // handling. The `writeRdEvidence` / `writeQaEvidence` helpers
  // still dual-write under both the session-axis (canonical) and
  // the change-axis (legacy) forms.
  const legacyChangeAxis = join(root, '.peaks', '_runtime', 'change', 'test-change-id');
  mkdirSync(join(legacyChangeAxis, 'rd'), { recursive: true });
  mkdirSync(join(legacyChangeAxis, 'qa', 'test-cases'), { recursive: true });
  mkdirSync(join(legacyChangeAxis, 'qa', 'test-reports'), { recursive: true });
  return { root, peaks };
}

/** Write an RD request artifact (numbered prefix format by default). */
function writeRdArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
  const content = `# RD Request ${rid}\n- session: test-change-id\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

/** Write a QA request artifact (numbered prefix format by default). */
function writeQaArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', '_runtime', 'test-change-id', 'qa', 'requests');
  const content = `# QA Request ${rid}\n- session: test-change-id\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

/** Write an RD request artifact using the exact-match filename format ({rid}.md). */
function writeRdArtifactExact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
  const content = `# RD Request ${rid}\n- session: test-change-id\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `${rid}.md`), content, 'utf8');
}

/** Write an RD evidence file under BOTH the v2.17.0 canonical session-axis
 *  `.peaks/_runtime/test-change-id/rd/<relativePath>` AND the legacy
 *  `.peaks/_runtime/change/test-change-id/rd/<relativePath>` paths.
 *  v2.18.1 path-axis update: the session-axis path is now canonical;
 *  the change-axis path is a back-compat fallback that emits the
 *  `DEPRECATION_LEGACY_PATH_USED` warning. */
function writeRdEvidence(peaks: string, relativePath: string, content?: string): void {
  const legacyChangeAxis = join(peaks, '..', 'change', 'test-change-id', 'rd', relativePath);
  mkdirSync(join(legacyChangeAxis, '..'), { recursive: true });
  writeFileSync(legacyChangeAxis, content ?? `# ${relativePath}\nevidence`, 'utf8');
  const canonical = join(peaks, 'rd', relativePath);
  mkdirSync(join(canonical, '..'), { recursive: true });
  writeFileSync(canonical, content ?? `# ${relativePath}\nevidence`, 'utf8');
}

/** Write a QA evidence file under BOTH the canonical session-axis and
 *  the legacy change-axis paths. */
function writeQaEvidence(peaks: string, relativePath: string, content?: string): void {
  const legacyChangeAxis = join(peaks, '..', 'change', 'test-change-id', 'qa', relativePath);
  mkdirSync(join(legacyChangeAxis, '..'), { recursive: true });
  writeFileSync(legacyChangeAxis, content ?? `# ${relativePath}\nevidence`, 'utf8');
  const canonical = join(peaks, 'qa', relativePath);
  mkdirSync(join(canonical, '..'), { recursive: true });
  writeFileSync(canonical, content ?? `# ${relativePath}\nevidence`, 'utf8');
}

// Plan 1 followup hotfix (5cd4c87) made the on-disk scope path the
// source of truth for resolved sessionId. Files live under
// `.peaks/_runtime/test-change-id/...`, so the resolved sessionId is
// the full scope path (containing `_runtime/test-change-id`), not
// the bare session-id name. The path separator is platform-dependent
// (forward slash on POSIX, backslash on Windows) — use endsWith CID
// Slice 2026-06-28-solo-mode-bypass-fix (defect #3): the canonical
// change-id is the bare id (`test-change-id`); the legacy shape
// `_runtime/test-change-id` is now normalised inside `findRequestFile`
// so the path resolver builds the right canonical location. The
// resolved sessionId is the bare id, NOT a `_runtime/...` prefix.
const CID = 'test-change-id';
function isResolvedChangeId(value: string): boolean {
  return value === CID || value.endsWith(`/${CID}`) || value.endsWith(`\\${CID}`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyPipeline', { timeout: 30_000 }, () => {
  let temp: { root: string; peaks: string };

  beforeEach(() => {
    temp = createTempProject();
    readFileShouldThrow = false;
  });

  afterEach(() => {
    try {
      rmSync(temp.root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  // ==================================================================
  // requestType resolution
  // ==================================================================

  describe('requestType resolution', () => {
    test('resolves each valid request type', async () => {
      for (const rt of ['feature', 'bugfix', 'refactor', 'docs', 'config', 'chore'] as const) {
        const r = await verifyPipeline({
          projectRoot: temp.root,
          rid: 'no-invoke',
          sessionId: CID,
          requestType: rt,
        });
        expect(r.requestType).toBe(rt);
      }
    });

    test('defaults to feature when requestType is an unsupported string', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: CID,
        requestType: 'garbage',
      });
      expect(r.requestType).toBe('feature');
    });

    test('defaults to feature when requestType is undefined', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: CID,
      });
      expect(r.requestType).toBe('feature');
    });

    test('defaults to feature when requestType is an empty string', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: CID,
        requestType: '',
      });
      expect(r.requestType).toBe('feature');
    });
  });

  // ==================================================================
  // RD phase - states
  // ==================================================================

  describe('RD phase states', () => {
    test('reports RD as not invoked when no RD request artifact exists', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
      expect(r.rdPhase.state).toBe('missing');
      expect(r.rdPhase.gates[0]!.passed).toBe(false);
      expect(r.rdPhase.gates[0]!.detail).toBe('not found');
      expect(r.violations).toContainEqual(expect.stringContaining('RD phase skipped'));
    });

    test('reports RD as invoked and extracts state (numbered prefix file)', async () => {
      writeRdArtifact(temp.root, 'rd-prefix', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-prefix',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('qa-handoff');
      expect(r.rdPhase.gates[0]!.passed).toBe(true);
      expect(r.rdPhase.gates[0]!.detail).toContain('found at');
    });

    test('reports RD as invoked via exact-match filename ({rid}.md)', async () => {
      writeRdArtifactExact(temp.root, 'exact-rd', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'exact-rd',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('implemented');
    });

    test('returns "unknown" state when artifact has no "state:" line', async () => {
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
      writeFileSync(join(dir, 'no-state.md'), '# RD\nJust some content\nNo state line\n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-state',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('unknown');
    });

    test('accepts "qa-handoff" as a valid RD handoff state', async () => {
      writeRdArtifact(temp.root, 'rd-h1', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-h1',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('accepts "handed-off" as a valid RD handoff state', async () => {
      writeRdArtifact(temp.root, 'rd-h2', 'handed-off');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-h2',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('accepts "implemented" as a valid RD handoff state', async () => {
      writeRdArtifact(temp.root, 'rd-h3', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-h3',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('reports violation when RD state is "draft"', async () => {
      writeRdArtifact(temp.root, 'rd-draft', 'draft');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-draft',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations).toContainEqual(expect.stringContaining('RD not ready'));
      expect(r.violations).toContainEqual(expect.stringContaining('"draft"'));
      expect(r.nextActions).toContainEqual(
        expect.stringContaining('peaks request transition'),
      );
    });

    test('reports violation when RD state is "in-progress"', async () => {
      writeRdArtifact(temp.root, 'rd-prog', 'in-progress');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-prog',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations).toContainEqual(expect.stringContaining('RD not ready'));
      expect(r.violations).toContainEqual(expect.stringContaining('"in-progress"'));
    });
  });

  // ==================================================================
  // RD phase - evidence files
  // ==================================================================

  describe('RD phase evidence files', () => {
    test('detects all RD evidence files present for feature type', async () => {
      writeRdArtifact(temp.root, 'ev-all', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'ev-all',
        sessionId: CID,
        requestType: 'feature',
      });

      for (const g of r.rdPhase.gates) {
        expect(g.passed).toBe(true);
      }
    });

    test('reports violations when no RD evidence files exist', async () => {
      writeRdArtifact(temp.root, 'ev-none', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'ev-none',
        sessionId: CID,
        requestType: 'feature',
      });

      const evVios = r.violations.filter((v) => v.startsWith('RD evidence missing'));
      expect(evVios.length).toBeGreaterThanOrEqual(3);
      expect(evVios.some((v) => v.includes('tech-doc.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('code-review.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('security-review.md'))).toBe(true);
    });

    test('reports partial evidence correctly (some present, some missing)', async () => {
      writeRdArtifact(temp.root, 'ev-part', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      // code-review.md and security-review.md intentionally missing

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'ev-part',
        sessionId: CID,
        requestType: 'feature',
      });

      const techDoc = r.rdPhase.gates.find((g) => g.name === 'tech-doc');
      expect(techDoc?.passed).toBe(true);

      const codeReview = r.rdPhase.gates.find((g) => g.name === 'code-review');
      expect(codeReview?.passed).toBe(false);
      expect(codeReview?.detail).toContain('missing');

      const secReview = r.rdPhase.gates.find((g) => g.name === 'security-review');
      expect(secReview?.passed).toBe(false);

      expect(r.violations).toContainEqual(expect.stringContaining('code-review.md'));
      expect(r.violations).toContainEqual(expect.stringContaining('security-review.md'));
    });
  });

  // ==================================================================
  // QA phase - states
  // ==================================================================

  describe('QA phase states', () => {
    test('reports QA as not invoked when no QA request artifact exists', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-qa',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.qaPhase.invoked).toBe(false);
      expect(r.qaPhase.state).toBe('missing');
      expect(r.qaPhase.gates[0]!.passed).toBe(false);
      expect(r.qaPhase.gates[0]!.detail).toBe('not found');
      expect(r.violations).toContainEqual(expect.stringContaining('QA phase skipped'));
    });

    test('reports QA as invoked and extracts state from the artifact', async () => {
      writeQaArtifact(temp.root, 'qa-ok', 'verdict-issued');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-ok',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.qaPhase.invoked).toBe(true);
      expect(r.qaPhase.state).toBe('verdict-issued');
      expect(r.qaPhase.gates[0]!.passed).toBe(true);
      expect(r.qaPhase.gates[0]!.detail).toContain('found at');
    });

    test('reports violation when QA state is "running" (not verdict-issued)', async () => {
      writeQaArtifact(temp.root, 'qa-running', 'running');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-running',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations).toContainEqual(expect.stringContaining('QA not complete'));
      expect(r.violations).toContainEqual(expect.stringContaining('"running"'));
      expect(r.nextActions).toContainEqual(
        expect.stringContaining('peaks request transition'),
      );
    });

    test('reports violation when QA state is "draft" (not verdict-issued)', async () => {
      writeQaArtifact(temp.root, 'qa-draft', 'draft');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-draft',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations).toContainEqual(expect.stringContaining('QA not complete'));
      expect(r.violations).toContainEqual(expect.stringContaining('"draft"'));
    });
  });

  // ==================================================================
  // QA phase - evidence files
  // ==================================================================

  describe('QA phase evidence files', () => {
    test('detects all QA evidence files present for feature type', async () => {
      writeQaArtifact(temp.root, 'qa-ev-all', 'verdict-issued');
      // QA evidence gates (test-cases/test-report) read from
      // `.peaks/_runtime/<sessionId>/qa/` using the resolved sessionId. Without
      // an RD request file in the same scope, the resolver falls
      // back to the caller-provided sessionId (`test-change-id`),
      // i.e. the bare path. Write the per-rid evidence under both
      // the _runtime scope and the bare change-id scope so the gate
      // finds it on both layouts.
      const bareChangeIdDir = join(temp.root, '.peaks', 'test-change-id');
      mkdirSync(join(bareChangeIdDir, 'qa', 'test-cases'), { recursive: true });
      mkdirSync(join(bareChangeIdDir, 'qa', 'test-reports'), { recursive: true });
      writeFileSync(join(bareChangeIdDir, 'qa', 'test-cases', 'qa-ev-all.md'), '# cases', 'utf8');
      writeFileSync(join(bareChangeIdDir, 'qa', 'test-reports', 'qa-ev-all.md'), '# reports', 'utf8');
      writeQaEvidence(temp.peaks, 'test-cases/qa-ev-all.md');
      writeQaEvidence(temp.peaks, 'test-reports/qa-ev-all.md');
      // Slice 025: security + performance findings are per-rid suffixed.
      writeQaEvidence(temp.peaks, 'security-findings-qa-ev-all.md');
      writeQaEvidence(temp.peaks, 'performance-findings-qa-ev-all.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-ev-all',
        sessionId: CID,
        requestType: 'feature',
      });

      for (const g of r.qaPhase.gates) {
        expect(g.passed).toBe(true);
      }
    });

    test('reports violations when no QA evidence files exist', async () => {
      writeQaArtifact(temp.root, 'qa-ev-none', 'verdict-issued');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-ev-none',
        sessionId: CID,
        requestType: 'feature',
      });

      const evVios = r.violations.filter((v) => v.startsWith('QA evidence missing'));
      expect(evVios.length).toBeGreaterThanOrEqual(4);
      expect(evVios.some((v) => v.includes('test-cases/qa-ev-none.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('test-reports/qa-ev-none.md'))).toBe(true);
      // Slice 025: security/performance findings are now per-rid suffixed.
      expect(evVios.some((v) => v.includes('security-findings-qa-ev-none.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('performance-findings-qa-ev-none.md'))).toBe(true);
    });
  });

  // ==================================================================
  // Completeness determination
  // ==================================================================

  describe('completeness determination', () => {
    test('marks pipeline as complete for feature with all gates passed', async () => {
      writeRdArtifact(temp.root, 'complete', 'qa-handoff');
      writeQaArtifact(temp.root, 'complete', 'verdict-issued');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaEvidence(temp.peaks, 'test-cases/complete.md');
      writeQaEvidence(temp.peaks, 'test-reports/complete.md');
      // Slice 025: per-rid suffixed security + performance findings.
      writeQaEvidence(temp.peaks, 'security-findings-complete.md');
      writeQaEvidence(temp.peaks, 'performance-findings-complete.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'complete',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(true);
      expect(r.violations).toEqual([]);
    });

    test('marks pipeline as incomplete when RD evidence is missing but states are correct', async () => {
      writeRdArtifact(temp.root, 'inc-rd-ev', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      // code-review.md and security-review.md missing
      writeQaArtifact(temp.root, 'inc-rd-ev', 'verdict-issued');
      writeQaEvidence(temp.peaks, 'test-cases/inc-rd-ev.md');
      writeQaEvidence(temp.peaks, 'test-reports/inc-rd-ev.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'inc-rd-ev',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
    });

    test('marks pipeline as incomplete when QA evidence is missing but states are correct', async () => {
      writeRdArtifact(temp.root, 'inc-qa-ev', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaArtifact(temp.root, 'inc-qa-ev', 'verdict-issued');
      // all QA evidence missing

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'inc-qa-ev',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
    });

    test('marks pipeline as incomplete when RD state is wrong but all evidence present', async () => {
      writeRdArtifact(temp.root, 'inc-rd-state', 'draft');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaArtifact(temp.root, 'inc-rd-state', 'verdict-issued');
      writeQaEvidence(temp.peaks, 'test-cases/inc-rd-state.md');
      writeQaEvidence(temp.peaks, 'test-reports/inc-rd-state.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'inc-rd-state',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
      expect(r.violations).toContainEqual(expect.stringContaining('RD not ready'));
    });

    test('marks pipeline as incomplete when QA state is wrong but all evidence present', async () => {
      writeRdArtifact(temp.root, 'inc-qa-state', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaArtifact(temp.root, 'inc-qa-state', 'running');
      writeQaEvidence(temp.peaks, 'test-cases/inc-qa-state.md');
      writeQaEvidence(temp.peaks, 'test-reports/inc-qa-state.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'inc-qa-state',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
      expect(r.violations).toContainEqual(expect.stringContaining('QA not complete'));
    });

    test('marks pipeline as incomplete when QA not invoked at all', async () => {
      writeRdArtifact(temp.root, 'no-qa-at-all', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-qa-at-all',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
    });

    test('marks pipeline as incomplete when neither RD nor QA invoked', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
      expect(r.rdPhase.invoked).toBe(false);
      expect(r.qaPhase.invoked).toBe(false);
      expect(r.violations.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================================================================
  // Cross-phase violations
  // ==================================================================

  describe('cross-phase violations', () => {
    test('reports CRITICAL when RD invoked but QA not invoked', async () => {
      writeRdArtifact(temp.root, 'rd-only', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-only',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
      expect(r.rdPhase.invoked).toBe(true);
      expect(r.qaPhase.invoked).toBe(false);
      expect(r.violations).toContainEqual(expect.stringContaining('CRITICAL'));
      expect(r.nextActions).toContainEqual(expect.stringContaining('MUST invoke'));
    });

    test('does NOT report CRITICAL when both RD and QA are invoked', async () => {
      writeRdArtifact(temp.root, 'both', 'qa-handoff');
      writeQaArtifact(temp.root, 'both', 'verdict-issued');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'both',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('CRITICAL')).length).toBe(0);
    });

    test('does NOT report CRITICAL when neither RD nor QA is invoked', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'neither',
        sessionId: CID,
        requestType: 'feature',
      });

      // CRITICAL gate: rdInvoked && !qaInvoked. Neither is true so it must not fire.
      expect(r.violations.filter((v) => v.includes('CRITICAL')).length).toBe(0);
    });
  });

  // ==================================================================
  // Request type gate variations — extracted to
  // `pipeline-verify-request-type-gates.test.ts` in v2.18.1 to keep
  // this file below the Karpathy 800-line cap.
  // ==================================================================

  // ==================================================================
  // File finding patterns
  // ==================================================================

  describe('file finding patterns', () => {
    test('finds RD artifact via exact-match filename ({rid}.md)', async () => {
      writeRdArtifactExact(temp.root, 'exact', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'exact',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('implemented');
    });

    test('finds RD artifact via numbered prefix format (001-{rid}.md)', async () => {
      writeRdArtifact(temp.root, 'legacy-fmt', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'legacy-fmt',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('implemented');
    });

    test('finds QA artifact via exact-match filename', async () => {
      // Write QA artifact with exact filename
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'qa', 'requests');
      writeFileSync(join(dir, 'qa-exact.md'), '# QA\n- state: verdict-issued\n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-exact',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.qaPhase.invoked).toBe(true);
      expect(r.qaPhase.state).toBe('verdict-issued');
    });

    test('returns null when requests directory does not exist', async () => {
      // Remove the pre-created directories, then use a different change-id
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-dir',
        sessionId: 'other-change-id', // no directories created for this change-id
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
      expect(r.qaPhase.invoked).toBe(false);
    });

    test('returns null when requests directory exists but contains no matching files', async () => {
      // Pre-created dirs exist for test-change-id. Write non-matching files.
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
      writeFileSync(join(dir, 'other.md'), 'nope', 'utf8');
      writeFileSync(join(dir, 'unrelated.md'), 'nope', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-match',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
    });
  });

  // ==================================================================
  // Parameter isolation
  //
  // As of slice 2026-06-05-change-id-as-unit-of-work, the on-disk
  // location is the source of truth: the caller passes `sessionId` as a
  // hint, but the resolver scans all top-level dirs and finds the file
  // at its actual location. The "isolates by change-id" test below
  // asserts the NEW contract: the resolved change-id equals the on-disk
  // dir, not the caller's hint.
  // ==================================================================

  describe('parameter isolation', () => {
    test('on-disk change-id wins over caller hint (resolved sessionId = on-disk dir)', async () => {
      writeRdArtifact(temp.root, 'iso-rid', 'qa-handoff'); // writes to test-change-id

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'iso-rid',
        sessionId: 'other-change-id', // hint, but file is under test-change-id
        requestType: 'feature',
      });

      // The on-disk location wins. The file is found (invoked=true) and
      // the resolved change-id is the actual dir the file lives in
      // (the full scope path `_runtime/test-change-id`), not the
      // caller's hint (other-change-id).
      expect(r.rdPhase.invoked).toBe(true);
      expect(isResolvedChangeId(r.sessionId)).toBe(true);
    });

    test('isolates by rid - files for one rid are not found when querying another', async () => {
      writeRdArtifact(temp.root, 'rid-a', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rid-b', // different rid
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
    });
  });

  // ==================================================================
  // State extraction edge cases
  // ==================================================================

  describe('state extraction edge cases', () => {
    test('extracts state with leading whitespace and trailing whitespace', async () => {
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
      writeFileSync(join(dir, 'ws.md'), '  - state:   qa-handoff  \n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'ws',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('qa-handoff');
    });

    test('extracts state when other metadata lines are present', async () => {
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
      writeFileSync(
        join(dir, 'multi.md'),
        '- request-id: multi\n- role: rd\n- state: handed-off\n- created: 2026-05-28\n',
        'utf8',
      );

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'multi',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('handed-off');
    });

    test('handles CRLF line endings in artifact content', async () => {
      const dir = join(temp.root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
      writeFileSync(
        join(dir, 'crlf.md'),
        '- request-id: crlf\r\n- state: implemented\r\n- role: rd\r\n',
        'utf8',
      );

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'crlf',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('implemented');
    });
  });

  // ==================================================================
  // readFile failure handling: as of slice 2026-06-05-change-id-as-unit-of-work,
  // the readFile error path lives inside showRequestArtifact's
  // readRequestArtifact helper (it catches and returns null), so the
  // caller sees the file as not found. Verified at the request-artifact-service
  // level — pipeline-verify now delegates path resolution there.
  // ==================================================================

  // ==================================================================
  // Structure and response shape
  // ==================================================================

  describe('response shape', () => {
    test('returns all expected top-level fields', async () => {
      writeRdArtifact(temp.root, 'shape', 'qa-handoff');
      writeQaArtifact(temp.root, 'shape', 'verdict-issued');
      writeRdEvidence(temp.peaks, 'tech-doc.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaEvidence(temp.peaks, 'test-cases/shape.md');
      writeQaEvidence(temp.peaks, 'test-reports/shape.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'shape',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.rid).toBe('shape');
      expect(isResolvedChangeId(r.sessionId)).toBe(true);
      expect(r.requestType).toBe('feature');
      expect(typeof r.complete).toBe('boolean');
      expect(Array.isArray(r.violations)).toBe(true);
      expect(Array.isArray(r.nextActions)).toBe(true);
      expect(r.rdPhase).toHaveProperty('invoked');
      expect(r.rdPhase).toHaveProperty('state');
      expect(r.rdPhase).toHaveProperty('gates');
      expect(r.qaPhase).toHaveProperty('invoked');
      expect(r.qaPhase).toHaveProperty('state');
      expect(r.qaPhase).toHaveProperty('gates');
    });

    test('gate objects have name, description, passed, and detail', async () => {
      writeRdArtifact(temp.root, 'gate-shape', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gate-shape',
        sessionId: CID,
        requestType: 'feature',
      });

      for (const g of r.rdPhase.gates) {
        expect(g).toHaveProperty('name');
        expect(g).toHaveProperty('description');
        expect(g).toHaveProperty('passed');
        expect(g).toHaveProperty('detail');
        expect(typeof g.passed).toBe('boolean');
        expect(typeof g.detail).toBe('string');
      }
      for (const g of r.qaPhase.gates) {
        expect(g).toHaveProperty('name');
        expect(g).toHaveProperty('description');
        expect(g).toHaveProperty('passed');
        expect(g).toHaveProperty('detail');
        expect(typeof g.passed).toBe('boolean');
        expect(typeof g.detail).toBe('string');
      }
    });
  });

  // ==================================================================
  // Evidence detail messages
  // ==================================================================

  describe('evidence gate detail messages', () => {
    test('passed evidence gate detail contains the file path', async () => {
      writeRdArtifact(temp.root, 'det-pass', 'qa-handoff');
      writeRdEvidence(temp.peaks, 'tech-doc.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'det-pass',
        sessionId: CID,
        requestType: 'feature',
      });

      const techDoc = r.rdPhase.gates.find((g) => g.name === 'tech-doc');
      expect(techDoc?.passed).toBe(true);
      expect(techDoc?.detail).toContain('tech-doc.md');
      expect(techDoc?.detail).not.toContain('missing');
    });

    test('failed evidence gate detail starts with "missing:"', async () => {
      writeRdArtifact(temp.root, 'det-fail', 'qa-handoff');
      // no evidence files

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'det-fail',
        sessionId: CID,
        requestType: 'feature',
      });

      const codeReview = r.rdPhase.gates.find((g) => g.name === 'code-review');
      expect(codeReview?.passed).toBe(false);
      expect(codeReview?.detail).toContain('missing:');
    });
  });

  // ==================================================================
  // nextActions population
  // ==================================================================

  describe('nextActions population', () => {
    test('includes RD evidence creation actions for missing evidence', async () => {
      writeRdArtifact(temp.root, 'na-rd', 'qa-handoff');
      // missing RD evidence

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'na-rd',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(expect.stringContaining('Create .peaks/'));
      expect(r.nextActions).toContainEqual(expect.stringContaining('tech-doc.md'));
    });

    test('includes QA evidence creation actions for missing evidence', async () => {
      writeQaArtifact(temp.root, 'na-qa', 'verdict-issued');
      // missing QA evidence

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'na-qa',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(expect.stringContaining('Create .peaks/'));
    });

    test('includes RD transition action when state is not qa-handoff', async () => {
      writeRdArtifact(temp.root, 'na-trans', 'draft');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'na-trans',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(
        expect.stringContaining('peaks request transition'),
      );
    });

    test('includes QA invocation action when QA is missing', async () => {
      writeRdArtifact(temp.root, 'na-qa-miss', 'qa-handoff');
      // QA not invoked

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'na-qa-miss',
        sessionId: CID,
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(expect.stringContaining('peaks-qa'));
    });
  });
});
