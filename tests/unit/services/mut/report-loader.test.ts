/**
 * Plan 2 — Task 8: loadMutReport is the read-side counterpart of
 * buildMutReport. Contract: returns `null` for missing / malformed /
 * schema-invalid reports. Never throws. The qa gate relies on this
 * to keep "peaks mut was not run" as a no-op (skipped, not failed).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadMutReport, mutReportPath, MUT_REPORT_RELATIVE_PATH } from '../../../../src/services/mut/report-loader.js';
import type { MutReportJson } from '../../../../src/services/mut/types.js';

function makeValidReport(): MutReportJson {
  return {
    version: '1.0',
    sha256: 'a'.repeat(64),
    generatedAt: '2026-06-22T00:00:00.000Z',
    inputSig: 'b'.repeat(64),
    mutation: {
      tool: 'stryker',
      mutantsTotal: 100,
      mutantsKilled: 90,
      mutantsSurvived: 10,
      mutantsTimeout: 0,
      killRate: 0.9,
      byFile: [],
    },
    assertions: {
      totalAssertions: 100,
      weakAssertions: 0,
      weakRate: 0,
      weakPatterns: [],
    },
    thresholds: {
      mutationKillRateMin: 0.8,
      weakAssertionRateMax: 0.05,
      passed: true,
    },
    followups: [],
  };
}

describe('mutReportPath', () => {
  it('builds the canonical one-axis path under .peaks/_runtime/<sid>/mut/', () => {
    expect(mutReportPath('abc-123')).toBe('.peaks/_runtime/abc-123/mut/mut-report.json');
  });

  it('exposes the relative-path constant for CLI diagnostic messages', () => {
    expect(MUT_REPORT_RELATIVE_PATH).toBe('mut/mut-report.json');
  });
});

describe('loadMutReport', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'peaks-mut-loader-'));
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  function writeReportAt(relPath: string, body: string): void {
    const full = join(workdir, relPath);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }

  it('returns null when the report file does not exist', async () => {
    const sid = 'no-such-session';
    const got = await loadMutReport(sid);
    expect(got).toBeNull();
  });

  it('returns the parsed report when the file exists and is schema-valid', async () => {
    const report = makeValidReport();
    // chdir so the relative .peaks/_runtime/<sid>/ path resolves inside
    // the tempdir. Use process.cwd() in the test runner.
    const sid = 'sess-ok';
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      writeReportAt(`.peaks/_runtime/${sid}/mut/mut-report.json`, JSON.stringify(report, null, 2));
      const got = await loadMutReport(sid);
      expect(got).not.toBeNull();
      expect(got?.sha256).toBe(report.sha256);
      expect(got?.thresholds.passed).toBe(true);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns null when the JSON is malformed (never throws)', async () => {
    const sid = 'sess-malformed';
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      writeReportAt(`.peaks/_runtime/${sid}/mut/mut-report.json`, '{ not valid json');
      const got = await loadMutReport(sid);
      expect(got).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns null when the JSON parses but fails schema validation (never throws)', async () => {
    const sid = 'sess-bad-schema';
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      // missing required fields (version, sha256, etc.)
      writeReportAt(`.peaks/_runtime/${sid}/mut/mut-report.json`, JSON.stringify({ foo: 'bar' }));
      const got = await loadMutReport(sid);
      expect(got).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('returns null when sha256 is not 64-hex (schema rejects)', async () => {
    const sid = 'sess-bad-sig';
    const report = { ...makeValidReport(), sha256: 'not-hex' };
    const originalCwd = process.cwd();
    process.chdir(workdir);
    try {
      writeReportAt(`.peaks/_runtime/${sid}/mut/mut-report.json`, JSON.stringify(report));
      const got = await loadMutReport(sid);
      expect(got).toBeNull();
    } finally {
      process.chdir(originalCwd);
    }
  });
});
