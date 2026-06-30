/**
 * v2.18.1 PATCH — extracted from `pipeline-verify-service.test.ts` to
 * keep the Karpathy 800-line file cap green.
 *
 * The original file grew past 800 lines in v2.15.x and has been
 * growing ever since as new describe blocks accumulate. The
 * "request type gate variations" block (per-request-type RD/QA gate
 * shape assertions) is self-contained — it depends only on the
 * shared helpers in `pipeline-verify-service.test.ts` (which are
 * NOT in scope here: this file imports `verifyPipeline` and the
 * helpers from the parent module via the `setup-shared.ts`-style
 * helper file pattern below).
 *
 * This split is purely a file-size housekeeping refactor; it does
 * NOT change any test behavior. All tests in this file were
 * verbatim in `pipeline-verify-service.test.ts` before v2.18.1.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyPipeline } from '../../src/services/workflow/pipeline-verify-service.js';

// Shared helpers — re-imported from the parent test file's setup
// pattern. We duplicate the helpers here (rather than extracting them
// to a shared file) because the original parent test file inlines
// them and Karpathy #3 says "do not refactor adjacent code 'while
// you're there'." The duplication is minimal (~15 lines) and keeps
// the parent test file structure unchanged.

function createTempProject(): { root: string; peaks: string } {
  const root = mkdtempSync(join(tmpdir(), 'peaks-pipeline-verify-'));
  const peaks = join(root, '.peaks', '_runtime', 'test-change-id');
  mkdirSync(join(peaks, 'rd', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'requests'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-cases'), { recursive: true });
  mkdirSync(join(peaks, 'qa', 'test-reports'), { recursive: true });
  return { root, peaks };
}

function writeRdArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', '_runtime', 'test-change-id', 'rd', 'requests');
  const content = `# RD Request ${rid}\n- session: test-change-id\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

function writeQaArtifact(root: string, rid: string, state: string): void {
  const dir = join(root, '.peaks', '_runtime', 'test-change-id', 'qa', 'requests');
  const content = `# QA Request ${rid}\n- session: test-change-id\n- state: ${state}\n- type: feature\n`;
  writeFileSync(join(dir, `001-${rid}.md`), content, 'utf8');
}

const CID = 'test-change-id';

describe('verifyPipeline — request type gate variations', () => {
  let temp: { root: string; peaks: string };

  beforeEach(() => {
    temp = createTempProject();
  });

  afterEach(() => {
    try {
      rmSync(temp.root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  test('feature has all RD and QA gates', async () => {
    const r = await verifyPipeline({
      projectRoot: temp.root,
      rid: 'gates-f',
      sessionId: CID,
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
      sessionId: CID,
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
      sessionId: CID,
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
      sessionId: CID,
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
      sessionId: CID,
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
      sessionId: CID,
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
    // Minimal evidence dirs (the parent test file owns the helper details;
    // here we just need the bare dirs so existsSync returns true for the
    // resolver to find the files written below).
    mkdirSync(join(temp.peaks, 'rd'), { recursive: true });
    mkdirSync(join(temp.peaks, 'qa', 'test-cases'), { recursive: true });
    mkdirSync(join(temp.peaks, 'qa', 'test-reports'), { recursive: true });
    writeFileSync(join(temp.peaks, 'rd', 'bug-analysis.md'), '# bug-analysis');
    writeFileSync(join(temp.peaks, 'rd', 'code-review.md'), '# cr');
    writeFileSync(join(temp.peaks, 'rd', 'security-review.md'), '# sr');
    writeFileSync(join(temp.peaks, 'qa', 'test-cases', 'bug-fix.md'), '# cases');
    writeFileSync(join(temp.peaks, 'qa', 'test-reports', 'bug-fix.md'), '# reports');
    writeFileSync(join(temp.peaks, 'qa', 'security-findings-bug-fix.md'), '# sec');

    const r = await verifyPipeline({
      projectRoot: temp.root,
      rid: 'bug-fix',
      sessionId: CID,
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
      sessionId: CID,
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
      sessionId: CID,
      requestType: 'chore',
    });

    expect(r.complete).toBe(true);
    expect(r.rdPhase.gates.length).toBe(1);
    expect(r.qaPhase.gates.length).toBe(1);
  });

  test('complete config pipeline needs only security evidence', async () => {
    writeRdArtifact(temp.root, 'config-only', 'qa-handoff');
    writeQaArtifact(temp.root, 'config-only', 'verdict-issued');
    mkdirSync(join(temp.peaks, 'rd'), { recursive: true });
    mkdirSync(join(temp.peaks, 'qa'), { recursive: true });
    writeFileSync(join(temp.peaks, 'rd', 'security-review.md'), '# sr');
    writeFileSync(join(temp.peaks, 'qa', 'security-findings-config-only.md'), '# sec');

    const r = await verifyPipeline({
      projectRoot: temp.root,
      rid: 'config-only',
      sessionId: CID,
      requestType: 'config',
    });

    expect(r.complete).toBe(true);
    expect(r.rdPhase.gates.some((g) => g.name === 'security-review')).toBe(true);
    expect(r.rdPhase.gates.some((g) => g.name === 'tech-doc')).toBe(false);
    expect(r.qaPhase.gates.some((g) => g.name === 'security-findings')).toBe(true);
    expect(r.qaPhase.gates.some((g) => g.name === 'test-cases')).toBe(false);
  });
});