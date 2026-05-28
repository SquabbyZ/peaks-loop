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
// ---------------------------------------------------------------------------

function createTempProject(): { root: string; peaks: string } {
  const root = mkdtempSync(join(tmpdir(), 'peaks-pipeline-verify-'));
  const peaks = join(root, '.peaks', 'test-session');
  mkdirSync(join(peaks, 'rd', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-cases'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-reports'), { recursive: true });
  // Non-.md entry to exercise the skip branch in findRequestFile
  writeFileSync(join(peaks, 'rd', 'requests', '.gitkeep'), '', 'utf8');
  return { root, peaks };
}

/** Write an RD request artifact (numbered prefix format by default). */
function writeRdArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', 'test-session', 'rd', 'requests');
  const content = `# RD Request ${rid}\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

/** Write a QA request artifact (numbered prefix format by default). */
function writeQaArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', 'test-session', 'qa', 'requests');
  const content = `# QA Request ${rid}\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

/** Write an RD request artifact using the exact-match filename format ({rid}.md). */
function writeRdArtifactExact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', 'test-session', 'rd', 'requests');
  const content = `# RD Request ${rid}\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `${rid}.md`), content, 'utf8');
}

/** Write an RD evidence file under .peaks/<session>/rd/<relativePath>. */
function writeRdEvidence(peaks: string, relativePath: string, content?: string): void {
  const full = join(peaks, 'rd', relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content ?? `# ${relativePath}\nevidence`, 'utf8');
}

/** Write a QA evidence file under .peaks/<session>/qa/<relativePath>. */
function writeQaEvidence(peaks: string, relativePath: string, content?: string): void {
  const full = join(peaks, 'qa', relativePath);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content ?? `# ${relativePath}\nevidence`, 'utf8');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('verifyPipeline', () => {
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
          sessionId: 'test-session',
          requestType: rt,
        });
        expect(r.requestType).toBe(rt);
      }
    });

    test('defaults to feature when requestType is an unsupported string', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: 'test-session',
        requestType: 'garbage',
      });
      expect(r.requestType).toBe('feature');
    });

    test('defaults to feature when requestType is undefined', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: 'test-session',
      });
      expect(r.requestType).toBe('feature');
    });

    test('defaults to feature when requestType is an empty string', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('implemented');
    });

    test('returns "unknown" state when artifact has no "state:" line', async () => {
      const dir = join(temp.root, '.peaks', 'test-session', 'rd', 'requests');
      writeFileSync(join(dir, 'no-state.md'), '# RD\nJust some content\nNo state line\n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-state',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('accepts "handed-off" as a valid RD handoff state', async () => {
      writeRdArtifact(temp.root, 'rd-h2', 'handed-off');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-h2',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('accepts "implemented" as a valid RD handoff state', async () => {
      writeRdArtifact(temp.root, 'rd-h3', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-h3',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('RD not ready')).length).toBe(0);
    });

    test('reports violation when RD state is "draft"', async () => {
      writeRdArtifact(temp.root, 'rd-draft', 'draft');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-draft',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
      writeQaEvidence(temp.peaks, 'test-cases/qa-ev-all.md');
      writeQaEvidence(temp.peaks, 'test-reports/qa-ev-all.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-ev-all',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      const evVios = r.violations.filter((v) => v.startsWith('QA evidence missing'));
      expect(evVios.length).toBeGreaterThanOrEqual(4);
      expect(evVios.some((v) => v.includes('test-cases/qa-ev-none.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('test-reports/qa-ev-none.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('security-findings.md'))).toBe(true);
      expect(evVios.some((v) => v.includes('performance-findings.md'))).toBe(true);
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
      writeQaEvidence(temp.peaks, 'security-findings.md');
      writeQaEvidence(temp.peaks, 'performance-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'complete',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.complete).toBe(false);
    });

    test('marks pipeline as incomplete when neither RD nor QA invoked', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-invoke',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.violations.filter((v) => v.includes('CRITICAL')).length).toBe(0);
    });

    test('does NOT report CRITICAL when neither RD nor QA is invoked', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'neither',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      // CRITICAL gate: rdInvoked && !qaInvoked. Neither is true so it must not fire.
      expect(r.violations.filter((v) => v.includes('CRITICAL')).length).toBe(0);
    });
  });

  // ==================================================================
  // Request type gate variations
  // ==================================================================

  describe('request type gate variations', () => {
    test('feature has all RD and QA gates', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-f',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.gates.map((g) => g.name)).toEqual([
        'rd-request-exists',
        'tech-doc',
        'code-review',
        'security-review',
      ]);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual([
        'qa-request-exists',
        'test-cases',
        'test-report',
        'security-findings',
        'performance-findings',
      ]);
    });

    test('bugfix has bug-analysis instead of tech-doc and excludes performance-findings', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-b',
        sessionId: 'test-session',
        requestType: 'bugfix',
      });

      expect(r.rdPhase.gates.map((g) => g.name)).toEqual([
        'rd-request-exists',
        'bug-analysis',
        'code-review',
        'security-review',
      ]);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual([
        'qa-request-exists',
        'test-cases',
        'test-report',
        'security-findings',
      ]);
      expect(r.qaPhase.gates.map((g) => g.name)).not.toContain('performance-findings');
    });

    test('refactor has same gates as feature', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-r',
        sessionId: 'test-session',
        requestType: 'refactor',
      });

      expect(r.rdPhase.gates.map((g) => g.name)).toEqual([
        'rd-request-exists',
        'tech-doc',
        'code-review',
        'security-review',
      ]);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual([
        'qa-request-exists',
        'test-cases',
        'test-report',
        'security-findings',
        'performance-findings',
      ]);
    });

    test('docs has only request artifact gates (minimal)', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-d',
        sessionId: 'test-session',
        requestType: 'docs',
      });

      expect(r.rdPhase.gates.length).toBe(1);
      expect(r.rdPhase.gates.map((g) => g.name)).toEqual(['rd-request-exists']);
      expect(r.qaPhase.gates.length).toBe(1);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual(['qa-request-exists']);
    });

    test('chore has only request artifact gates (minimal)', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-c',
        sessionId: 'test-session',
        requestType: 'chore',
      });

      expect(r.rdPhase.gates.length).toBe(1);
      expect(r.rdPhase.gates.map((g) => g.name)).toEqual(['rd-request-exists']);
      expect(r.qaPhase.gates.length).toBe(1);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual(['qa-request-exists']);
    });

    test('config has security-review and security-findings only', async () => {
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'gates-cfg',
        sessionId: 'test-session',
        requestType: 'config',
      });

      expect(r.rdPhase.gates.map((g) => g.name)).toEqual([
        'rd-request-exists',
        'security-review',
      ]);
      expect(r.qaPhase.gates.map((g) => g.name)).toEqual([
        'qa-request-exists',
        'security-findings',
      ]);
    });

    test('complete bugfix pipeline verifies bug-analysis evidence', async () => {
      writeRdArtifact(temp.root, 'bug-fix', 'qa-handoff');
      writeQaArtifact(temp.root, 'bug-fix', 'verdict-issued');
      writeRdEvidence(temp.peaks, 'bug-analysis.md');
      writeRdEvidence(temp.peaks, 'code-review.md');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaEvidence(temp.peaks, 'test-cases/bug-fix.md');
      writeQaEvidence(temp.peaks, 'test-reports/bug-fix.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'bug-fix',
        sessionId: 'test-session',
        requestType: 'bugfix',
      });

      expect(r.complete).toBe(true);
      expect(r.rdPhase.gates.some((g) => g.name === 'bug-analysis')).toBe(true);
      expect(r.rdPhase.gates.some((g) => g.name === 'tech-doc')).toBe(false);
      expect(r.qaPhase.gates.some((g) => g.name === 'performance-findings')).toBe(false);
    });

    test('complete docs pipeline needs only request artifacts with correct states', async () => {
      writeRdArtifact(temp.root, 'docs-only', 'qa-handoff');
      writeQaArtifact(temp.root, 'docs-only', 'verdict-issued');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'docs-only',
        sessionId: 'test-session',
        requestType: 'docs',
      });

      expect(r.complete).toBe(true);
      expect(r.violations.length).toBe(0);
    });

    test('complete chore pipeline needs only request artifacts with correct states', async () => {
      writeRdArtifact(temp.root, 'chore-only', 'qa-handoff');
      writeQaArtifact(temp.root, 'chore-only', 'verdict-issued');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'chore-only',
        sessionId: 'test-session',
        requestType: 'chore',
      });

      expect(r.complete).toBe(true);
      expect(r.rdPhase.gates.length).toBe(1);
      expect(r.qaPhase.gates.length).toBe(1);
    });

    test('complete config pipeline needs only security evidence', async () => {
      writeRdArtifact(temp.root, 'config-only', 'qa-handoff');
      writeQaArtifact(temp.root, 'config-only', 'verdict-issued');
      writeRdEvidence(temp.peaks, 'security-review.md');
      writeQaEvidence(temp.peaks, 'security-findings.md');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'config-only',
        sessionId: 'test-session',
        requestType: 'config',
      });

      expect(r.complete).toBe(true);
      expect(r.rdPhase.gates.some((g) => g.name === 'security-review')).toBe(true);
      expect(r.rdPhase.gates.some((g) => g.name === 'tech-doc')).toBe(false);
      expect(r.qaPhase.gates.some((g) => g.name === 'security-findings')).toBe(true);
      expect(r.qaPhase.gates.some((g) => g.name === 'test-cases')).toBe(false);
    });
  });

  // ==================================================================
  // File finding patterns
  // ==================================================================

  describe('file finding patterns', () => {
    test('finds RD artifact via exact-match filename ({rid}.md)', async () => {
      writeRdArtifactExact(temp.root, 'exact', 'implemented');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'exact',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(true);
      expect(r.rdPhase.state).toBe('implemented');
    });

    test('finds QA artifact via exact-match filename', async () => {
      // Write QA artifact with exact filename
      const dir = join(temp.root, '.peaks', 'test-session', 'qa', 'requests');
      writeFileSync(join(dir, 'qa-exact.md'), '# QA\n- state: verdict-issued\n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'qa-exact',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.qaPhase.invoked).toBe(true);
      expect(r.qaPhase.state).toBe('verdict-issued');
    });

    test('returns null when requests directory does not exist', async () => {
      // Remove the pre-created directories, then use a different session
      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-dir',
        sessionId: 'other-session', // no directories created for this session
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
      expect(r.qaPhase.invoked).toBe(false);
    });

    test('returns null when requests directory exists but contains no matching files', async () => {
      // Pre-created dirs exist for test-session. Write non-matching files.
      const dir = join(temp.root, '.peaks', 'test-session', 'rd', 'requests');
      writeFileSync(join(dir, 'other.md'), 'nope', 'utf8');
      writeFileSync(join(dir, 'unrelated.md'), 'nope', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'no-match',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
    });
  });

  // ==================================================================
  // Parameter isolation
  // ==================================================================

  describe('parameter isolation', () => {
    test('isolates by sessionId - files from one session are not found in another', async () => {
      writeRdArtifact(temp.root, 'iso-rid', 'qa-handoff'); // writes to test-session

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'iso-rid',
        sessionId: 'other-session', // different session
        requestType: 'feature',
      });

      expect(r.rdPhase.invoked).toBe(false);
    });

    test('isolates by rid - files for one rid are not found when querying another', async () => {
      writeRdArtifact(temp.root, 'rid-a', 'qa-handoff');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rid-b', // different rid
        sessionId: 'test-session',
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
      const dir = join(temp.root, '.peaks', 'test-session', 'rd', 'requests');
      writeFileSync(join(dir, 'ws.md'), '  - state:   qa-handoff  \n', 'utf8');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'ws',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('qa-handoff');
    });

    test('extracts state when other metadata lines are present', async () => {
      const dir = join(temp.root, '.peaks', 'test-session', 'rd', 'requests');
      writeFileSync(
        join(dir, 'multi.md'),
        '- request-id: multi\n- role: rd\n- state: handed-off\n- created: 2026-05-28\n',
        'utf8',
      );

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'multi',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('handed-off');
    });

    test('handles CRLF line endings in artifact content', async () => {
      const dir = join(temp.root, '.peaks', 'test-session', 'rd', 'requests');
      writeFileSync(
        join(dir, 'crlf.md'),
        '- request-id: crlf\r\n- state: implemented\r\n- role: rd\r\n',
        'utf8',
      );

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'crlf',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rdPhase.state).toBe('implemented');
    });
  });

  // ==================================================================
  // readFile failure branch (covers readFileContent error path)
  // ==================================================================

  describe('readFile failure handling', () => {
    test('treats a matching request file as not found when readFile throws', async () => {
      writeRdArtifact(temp.root, 'rd-readerr', 'qa-handoff');
      readFileShouldThrow = true;

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'rd-readerr',
        sessionId: 'test-session',
        requestType: 'feature',
      });

      // readFileContent catches the error and returns null,
      // findRequestFile skips the file, RD is treated as not invoked.
      expect(r.rdPhase.invoked).toBe(false);
      expect(r.rdPhase.state).toBe('missing');
    });
  });

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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.rid).toBe('shape');
      expect(r.sessionId).toBe('test-session');
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(expect.stringContaining('Create .peaks/'));
    });

    test('includes RD transition action when state is not qa-handoff', async () => {
      writeRdArtifact(temp.root, 'na-trans', 'draft');

      const r = await verifyPipeline({
        projectRoot: temp.root,
        rid: 'na-trans',
        sessionId: 'test-session',
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
        sessionId: 'test-session',
        requestType: 'feature',
      });

      expect(r.nextActions).toContainEqual(expect.stringContaining('peaks-qa'));
    });
  });
});
