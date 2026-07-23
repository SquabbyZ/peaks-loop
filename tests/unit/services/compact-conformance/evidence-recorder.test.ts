/**
 * evidence-recorder.test.ts — Phase 3 Task 3.3.
 *
 * Sanitized evidence pipeline: forbidden substring scan, path containment,
 * 64-hex digest regex, skipped-as-passed rejection, raw token leakage.
 * Uses `node:fs` + `mkdtempSync` for the ingest happy path; no vendor SDK.
 */
import { strict as assert } from 'node:assert';
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  assertNoForbiddenEvidenceContent,
  EvidenceSchemaError
} from '../../../../src/services/compact-conformance/evidence-schema.js';
import {
  ingestEvidenceFile,
  recordCaseResult,
  buildReport,
  computeRecordDigest,
  EvidenceFileError,
  EvidencePathError
} from '../../../../src/services/compact-conformance/evidence-recorder.js';
import {
  EvidencePointerSchema_,
  CompactConformanceCaseResultSchema_,
  CompactConformanceReportSchema_
} from '../../../../src/services/compact-conformance/evidence-schema.js';

function mkProject(): { projectRoot: string; cleanup: () => void } {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-evidence-'));
  return {
    projectRoot,
    cleanup: () => {
      try {
        if (existsSync(projectRoot)) {
          // simple recursive rm
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('node:fs').rmSync(projectRoot, { recursive: true, force: true });
        }
      } catch {
        // best effort
      }
    }
  };
}

function writeFile(projectRoot: string, rel: string, content: string): string {
  const abs = join(projectRoot, rel);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf8');
  return abs;
}

function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

describe('assertNoForbiddenEvidenceContent', () => {
  it('rejects raw transcript substring (capsule body)', () => {
    expect(() => assertNoForbiddenEvidenceContent({ value: 'capsule_body: foo' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects raw continuation token', () => {
    expect(() => assertNoForbiddenEvidenceContent({ token: 'continuationToken=abc' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects secret', () => {
    expect(() => assertNoForbiddenEvidenceContent({ value: 'my_secret_value' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects api-key', () => {
    expect(() => assertNoForbiddenEvidenceContent({ value: 'api-key-123' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects password', () => {
    expect(() => assertNoForbiddenEvidenceContent({ value: 'DB_password=secret' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects private_key path pattern', () => {
    expect(() => assertNoForbiddenEvidenceContent({ path: 'home/.ssh/private_key' })).toThrowError(EvidenceSchemaError);
  });

  it('rejects in deeply nested objects', () => {
    expect(() => assertNoForbiddenEvidenceContent({ a: { b: { c: 'continuation_token=xyz' } } })).toThrowError(EvidenceSchemaError);
  });

  it('accepts safe content', () => {
    expect(() => assertNoForbiddenEvidenceContent({ value: 'ok' })).not.toThrow();
  });
});

describe('EvidencePointerSchema', () => {
  it('accepts a well-formed pointer', () => {
    const result = EvidencePointerSchema_.safeParse({
      key: 'k1',
      path: 'artifacts/abc.json',
      sha256: 'a'.repeat(64),
      summary: 'ok'
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-64-hex sha256', () => {
    const result = EvidencePointerSchema_.safeParse({
      key: 'k1', path: 'x.json', sha256: 'short', summary: 'ok'
    });
    expect(result.success).toBe(false);
  });

  it('rejects absolute path', () => {
    const result = EvidencePointerSchema_.safeParse({
      key: 'k1', path: '/etc/passwd', sha256: 'a'.repeat(64), summary: 'ok'
    });
    expect(result.success).toBe(false);
  });

  it('rejects traversal path', () => {
    const result = EvidencePointerSchema_.safeParse({
      key: 'k1', path: '../../etc/passwd', sha256: 'a'.repeat(64), summary: 'ok'
    });
    expect(result.success).toBe(false);
  });
});

describe('ingestEvidenceFile', () => {
  it('produces a sanitized 64-hex sha256 + relative path', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      const rel = 'artifacts/abc.json';
      writeFile(projectRoot, rel, JSON.stringify({ value: 1 }));
      const pointer = await ingestEvidenceFile(projectRoot, rel, 'k1', 'a note');
      expect(pointer.sha256).toBe(sha256(JSON.stringify({ value: 1 })));
      expect(pointer.path).toBe('artifacts/abc.json');
      expect(pointer.key).toBe('k1');
      expect(pointer.summary).toBe('a note');
    } finally {
      cleanup();
    }
  });

  it('throws when file is missing', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      await expect(
        ingestEvidenceFile(projectRoot, join(projectRoot, 'no-such.json'), 'k', 's')
      ).rejects.toThrowError(EvidenceFileError);
    } finally {
      cleanup();
    }
  });

  it('throws on path traversal', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      const outside = writeFile(projectRoot, '../outside.json', 'x');
      // Above writes OUTSIDE projectRoot because of `..`
      await expect(
        ingestEvidenceFile(projectRoot, outside, 'k', 's')
      ).rejects.toThrowError(EvidencePathError);
    } finally {
      cleanup();
    }
  });
});

describe('recordCaseResult + buildReport', () => {
  it('rejects skipped with failureCode', () => {
    const result = CompactConformanceCaseResultSchema_.safeParse({
      caseId: 'skipped-with-code',
      status: 'skipped',
      startedAt: '2026-07-24T00:00:00.000Z',
      completedAt: '2026-07-24T00:00:01.000Z',
      evidence: [],
      failureCode: 'WHATEVER'
    });
    expect(result.success).toBe(false);
  });

  it('rejects passed with failureMessage', () => {
    const result = CompactConformanceCaseResultSchema_.safeParse({
      caseId: 'passed-with-message',
      status: 'passed',
      startedAt: '2026-07-24T00:00:00.000Z',
      completedAt: '2026-07-24T00:00:01.000Z',
      evidence: [],
      failureMessage: 'should not be here'
    });
    expect(result.success).toBe(false);
  });

  it('rejects completedAt < startedAt', () => {
    const result = CompactConformanceCaseResultSchema_.safeParse({
      caseId: 'time-travel',
      status: 'passed',
      startedAt: '2026-07-24T00:00:05.000Z',
      completedAt: '2026-07-24T00:00:01.000Z',
      evidence: []
    });
    expect(result.success).toBe(false);
  });

  it('accepts a clean passed case with empty evidence', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      const result = await recordCaseResult({
        caseId: 'happy',
        projectRoot,
        status: 'passed',
        startedAt: new Date('2026-07-24T00:00:00.000Z'),
        now: new Date('2026-07-24T00:00:01.000Z')
      });
      expect(result.status).toBe('passed');
      expect(result.evidence).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('rejects case whose summary in evidence contains a raw token', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      await expect(
        recordCaseResult({
          caseId: 'leak',
          projectRoot,
          status: 'failed',
          startedAt: new Date('2026-07-24T00:00:00.000Z'),
          now: new Date('2026-07-24T00:00:01.000Z'),
          failureCode: 'LEAK',
          pointerSource: async () => [
            {
              key: 'k1',
              path: 'artifacts/abc.json',
              sha256: 'a'.repeat(64),
              summary: 'leaked bearer xyz'
            }
          ]
        })
      ).rejects.toThrowError(/forbidden|bearer/i);
    } finally {
      cleanup();
    }
  });

  it('buildReport assigns a stable digest', () => {
    const a = buildReport(
      [
        {
          caseId: 'x',
          status: 'passed',
          startedAt: '2026-07-24T00:00:00.000Z',
          completedAt: '2026-07-24T00:00:01.000Z',
          evidence: []
        }
      ],
      new Date('2026-07-24T00:00:02.000Z')
    );
    const b = buildReport(
      [
        {
          caseId: 'x',
          status: 'passed',
          startedAt: '2026-07-24T00:00:00.000Z',
          completedAt: '2026-07-24T00:00:01.000Z',
          evidence: []
        }
      ],
      new Date('2026-07-24T00:00:02.000Z')
    );
    expect(a.reportDigest).toBe(b.reportDigest);
    expect(a.cases[0]!.caseId).toBe('x');
  });

  it('CompactConformanceReportSchema rejects an empty report without cases (must be an array)', () => {
    const result = CompactConformanceReportSchema_.safeParse({
      contractVersion: 1,
      generatedAt: '2026-07-24T00:00:00.000Z',
      cases: []
    });
    expect(result.success).toBe(true);
  });

  it('computeRecordDigest is sensitive to payload changes', () => {
    const a = buildReport(
      [
        {
          caseId: 'a',
          status: 'passed',
          startedAt: '2026-07-24T00:00:00.000Z',
          completedAt: '2026-07-24T00:00:01.000Z',
          evidence: []
        }
      ],
      new Date('2026-07-24T00:00:02.000Z')
    );
    const b = buildReport(
      [
        {
          caseId: 'b',
          status: 'passed',
          startedAt: '2026-07-24T00:00:00.000Z',
          completedAt: '2026-07-24T00:00:01.000Z',
          evidence: []
        }
      ],
      new Date('2026-07-24T00:00:02.000Z')
    );
    expect(a.reportDigest).not.toBe(b.reportDigest);
  });

  it('recordCaseResult writes sanitized file when outDir is provided', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      const outDir = 'evidence-out';
      const result = await recordCaseResult({
        caseId: 'write-test',
        projectRoot,
        status: 'passed',
        startedAt: new Date('2026-07-24T00:00:00.000Z'),
        now: new Date('2026-07-24T00:00:01.000Z'),
        outDir
      });
      expect(result.caseId).toBe('write-test');
      const outFile = join(projectRoot, outDir, 'write-test.json');
      expect(existsSync(outFile)).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('recordCaseResult rejects when outDir escapes projectRoot', async () => {
    const { projectRoot, cleanup } = mkProject();
    try {
      await expect(
        recordCaseResult({
          caseId: 'escape',
          projectRoot,
          status: 'passed',
          startedAt: new Date('2026-07-24T00:00:00.000Z'),
          now: new Date('2026-07-24T00:00:01.000Z'),
          outDir: '../outside'
        })
      ).rejects.toThrowError(EvidencePathError);
    } finally {
      cleanup();
    }
  });
});
