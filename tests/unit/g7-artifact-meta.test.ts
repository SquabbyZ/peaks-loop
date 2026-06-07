/**
 * G7 — ArtifactMeta + sha256 + size + contentInlined:false + ContextImpact.
 *
 * Coverage:
 *  - ArtifactMeta schema (path / size / sha256 / status / contentInlined:false / summary)
 *  - computeSha256() determinism + actual sha256 values
 *  - buildArtifactMeta() 0-byte -> status: failed
 *  - buildArtifactMeta() non-empty -> sha256 + size populated correctly
 *  - buildArtifactMeta() summary > 200 chars throws
 *  - buildContextImpact() batch > 4MB -> contextWarning: 'high'
 *  - buildContextImpact() artifact > 1MB -> contextWarning: 'critical'
 *  - buildContextImpact() small batch -> contextWarning: 'normal'
 *  - contentInlined: false is a mandatory literal (type-system enforced)
 */
import { mkdtempSync, rmSync, writeFileSync, existsSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildArtifactMeta,
  buildContextImpact,
  computeSha256,
  type ArtifactMeta
} from '../../src/services/context/artifact-meta.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-g7-artifact-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('G7 ArtifactMeta schema + sha256', () => {
  it('buildArtifactMeta populates path / size / sha256 / contentInlined:false', () => {
    const file = join(root, '003-rd-001.md');
    writeFileSync(file, 'hello world', 'utf8');
    const meta = buildArtifactMeta({
      path: file,
      rid: '003-2026-06-07',
      role: 'rd',
      idx: 1,
      summary: 'wrote RD tech-doc'
    });
    expect(meta.path).toBe(file);
    expect(meta.size).toBe(11);
    expect(meta.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.sha256).toBe(computeSha256(file));
    expect(meta.contentInlined).toBe(false);
    expect(meta.summary).toBe('wrote RD tech-doc');
    expect(meta.status).toBe('created');
    expect(meta.rid).toBe('003-2026-06-07');
    expect(meta.role).toBe('rd');
    expect(meta.idx).toBe(1);
    expect(meta.writtenAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('contentInlined literal false is the only legal value (compile-time check)', () => {
    // Type system: `contentInlined: false` is the only literal that satisfies the
    //   readonly contentInlined: false;
    // contract. Any attempt to set true is a compile error. We assert at runtime
    // that the produced value is the literal `false`.
    const file = join(root, '003-rd-002.md');
    writeFileSync(file, 'x', 'utf8');
    const meta: ArtifactMeta = buildArtifactMeta({
      path: file,
      rid: '003',
      role: 'rd',
      idx: 2,
      summary: null
    });
    const literal: false = meta.contentInlined; // type-level assertion
    expect(literal).toBe(false);
  });

  it('0-byte file => status: failed, sha256 = "0" * 64', () => {
    const file = join(root, '003-rd-003.md');
    writeFileSync(file, '', 'utf8');
    const meta = buildArtifactMeta({
      path: file,
      rid: '003',
      role: 'rd',
      idx: 3,
      summary: null
    });
    expect(meta.size).toBe(0);
    expect(meta.status).toBe('failed');
    expect(meta.sha256).toBe('0'.repeat(64));
  });

  it('non-empty file: sha256 determinism', () => {
    const file = join(root, '003-rd-004.md');
    writeFileSync(file, 'consistent content', 'utf8');
    const m1 = buildArtifactMeta({ path: file, rid: '003', role: 'rd', idx: 4, summary: null });
    const m2 = buildArtifactMeta({ path: file, rid: '003', role: 'rd', idx: 4, summary: null });
    expect(m1.sha256).toBe(m2.sha256);
    // known sha256 of "consistent content"
    const known = computeSha256(file);
    expect(m1.sha256).toBe(known);
  });

  it('summary > 200 chars throws', () => {
    const file = join(root, '003-rd-005.md');
    writeFileSync(file, 'x', 'utf8');
    expect(() =>
      buildArtifactMeta({
        path: file,
        rid: '003',
        role: 'rd',
        idx: 5,
        summary: 'a'.repeat(201)
      })
    ).toThrow(/summary must be ≤ 200 chars/);
  });

  it('precomputed {size, sha256} override skips disk read', () => {
    const file = join(root, '003-rd-006.md');
    writeFileSync(file, 'on-disk content', 'utf8');
    const meta = buildArtifactMeta({
      path: file,
      rid: '003',
      role: 'rd',
      idx: 6,
      summary: null,
      precomputed: { size: 999, sha256: 'a'.repeat(64) }
    });
    expect(meta.size).toBe(999);
    expect(meta.sha256).toBe('a'.repeat(64));
    expect(meta.status).toBe('created');
  });
});

describe('G7 ContextImpact', () => {
  it('small batch => contextWarning: normal', () => {
    const ci = buildContextImpact({ promptSize: 50_000, artifactSizes: [10_000, 8_000] });
    expect(ci.promptSize).toBe(50_000);
    expect(ci.batchTotalSize).toBe(68_000);
    expect(ci.contextWarning).toBe('normal');
  });

  it('batch > 4MB (no single artifact > 1MB) => contextWarning: high', () => {
    // 6 sub-agents × 600KB = 3.6MB, plus 800KB prompt = 4.4MB. Each artifact
    // is under 1MB so this is 'high', not 'critical'.
    const ci = buildContextImpact({
      promptSize: 800_000,
      artifactSizes: [600_000, 600_000, 600_000, 600_000, 600_000, 600_000]
    });
    expect(ci.batchTotalSize).toBe(4_400_000);
    expect(ci.contextWarning).toBe('high');
  });

  it('any artifact > 1MB => contextWarning: critical', () => {
    const ci = buildContextImpact({ promptSize: 50_000, artifactSizes: [500_000, 1_500_000] });
    expect(ci.contextWarning).toBe('critical');
  });

  it('empty artifactSizes => batchTotalSize = promptSize', () => {
    const ci = buildContextImpact({ promptSize: 100_000, artifactSizes: [] });
    expect(ci.batchTotalSize).toBe(100_000);
    expect(ci.contextWarning).toBe('normal');
  });
});

describe('G7 computeSha256', () => {
  it('returns hex digest of file content', () => {
    const file = join(root, 'sha.txt');
    writeFileSync(file, 'abc', 'utf8');
    const sha = computeSha256(file);
    // sha256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    expect(sha).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('throws on missing file', () => {
    const file = join(root, 'nope.txt');
    expect(() => computeSha256(file)).toThrow();
  });
});

describe('G7 backward compat (AC-34 / AC-65)', () => {
  it('ArtifactMeta can be JSON.stringify + JSON.parse roundtrip', () => {
    const file = join(root, 'roundtrip.md');
    writeFileSync(file, 'roundtrip content', 'utf8');
    const meta = buildArtifactMeta({ path: file, rid: '003', role: 'rd', idx: 7, summary: 'rt' });
    const json = JSON.stringify(meta);
    const parsed = JSON.parse(json) as ArtifactMeta;
    expect(parsed.contentInlined).toBe(false);
    expect(parsed.sha256).toBe(meta.sha256);
    expect(parsed.size).toBe(meta.size);
    // contentInlined is preserved as the literal false (not coerced to "false")
    expect(parsed.contentInlined).toBe(false);
    expect(typeof parsed.contentInlined).toBe('boolean');
  });
});
