/**
 * v2.14.0 G1 AC-1.4 — Fixture capture service unit tests.
 *
 * Covers historical capture (with a real fixture dropped into a tmp
 * dir), derived-variant capture (each of 5 edge cases), and the
 * failure modes (source not found, parent not found).
 */
import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  captureDerivedVariant,
  captureHistoricalFixture,
  type CapturedFixture
} from '../../../src/services/fixture/fixture-capture-service.js';

let tmpRoot: string;
let fixtureRoot: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-fixture-capture-'));
  // Stand in for `.peaks/_runtime/<sid>/...` by creating the same shape.
  const sessionDir = join(tmpRoot, '.peaks', '_runtime', 'test-session-001');
  fixtureRoot = join(tmpRoot, 'tests', 'fixtures', 'replay');
  // Pre-populate a real audit envelope for the historical mode.
  require('node:fs').mkdirSync(join(sessionDir, 'audit'), { recursive: true });
  require('node:fs').writeFileSync(
    join(sessionDir, 'audit', 'security.md'),
    [
      '---',
      'schemaVersion: 1',
      'artifactKind: security-audit',
      'rid: test-rid',
      'verdict: warn',
      'violationsCount: 1',
      '---',
      '## Summary',
      'Test security envelope for dogfood.',
      '',
      '## Findings',
      '- HIGH: hardcoded password in src/auth.ts:42',
      '',
      '## Verdict',
      'verdict: warn',
      'CRITICAL: 0'
    ].join('\n'),
    'utf8'
  );
  // A second envelope for variant derivation.
  require('node:fs').mkdirSync(join(sessionDir, 'rd'), { recursive: true });
  require('node:fs').writeFileSync(
    join(sessionDir, 'rd', 'karpathy-review.md'),
    [
      '## Karpathy-Gate',
      '',
      'gateAction: pass',
      'passed: true'
    ].join('\n'),
    'utf8'
  );
});

afterAll(() => {
  if (tmpRoot && existsSync(tmpRoot)) {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
});

describe('v2.14.0 G1 fixture-capture-service (AC-1.4)', () => {
  test('A: captureHistoricalFixture reads + sanitizes + writes a fixture pair', () => {
    const captured: CapturedFixture = captureHistoricalFixture({
      mode: 'historical',
      sessionId: 'test-session-001',
      envelopeKind: 'audit-security',
      fixtureId: 'test-session-001-security-fixture',
      outDir: fixtureRoot,
      projectRoot: tmpRoot,
      requireSource: true
    });

    expect(existsSync(captured.bodyPath)).toBe(true);
    expect(existsSync(captured.metaPath)).toBe(true);

    const meta = JSON.parse(readFileSync(captured.metaPath, 'utf8'));
    expect(meta.producer).toBe('peaks-fixture-capture-cli');
    expect(meta.producerVersion).toBe('2.14.0');
    expect(meta.envelopeKind).toBe('audit-security');
    expect(meta.sourceOrigin.kind).toBe('historical-artifact');
    expect(meta.sourceOrigin.sessionId).toBe('test-session-001');
    expect(meta.checksum.algorithm).toBe('sha256');
    expect(meta.checksum.value).toMatch(/^[a-f0-9]{64}$/);
    expect(meta.sanitization.passed).toBe(true);
    expect(meta.sanitization.rulesApplied.length).toBeGreaterThanOrEqual(5);
  });

  test('B: captureHistoricalFixture throws when source file is missing', () => {
    expect(() => captureHistoricalFixture({
      mode: 'historical',
      sessionId: 'test-session-002',
      envelopeKind: 'audit-security',
      fixtureId: 'should-not-write',
      outDir: fixtureRoot,
      projectRoot: tmpRoot,
      requireSource: true
    })).toThrow(/source not found/);
  });

  // The karpathy review fixture has no `## Summary` / `## Findings` body
  // sections — empty-body and chinese-colon variants produce
  // unobservable changes for it. The setup script restricts variant
  // selection to body-shape-aware envelopes; here we mirror that.
  test.each([
    'chinese-colon',
    'yaml-frontmatter-variation',
    'double-format',
    'empty-body',
    'multi-findings'
  ] as const)('C: captureDerivedVariant (audit-security) produces a deterministic %s variant', (variant) => {
    // Capture audit-security parent (has body sections, supports all variants).
    const parent = captureHistoricalFixture({
      mode: 'historical',
      sessionId: 'test-session-001',
      envelopeKind: 'audit-security',
      fixtureId: 'parent-audit-security',
      outDir: fixtureRoot,
      projectRoot: tmpRoot
    });

    const variantFixture = captureDerivedVariant({
      mode: 'derived-variant',
      parentFixturePath: parent.bodyPath,
      variant,
      fixtureId: `parent-audit-security--${variant}`,
      outDir: fixtureRoot
    });

    const variantMeta = JSON.parse(readFileSync(variantFixture.metaPath, 'utf8'));
    expect(variantMeta.sourceOrigin.kind).toBe('derived-variant');
    expect(variantMeta.sourceOrigin.variantCommand).toBe(variant);
    expect(variantMeta.edgeCases).toContain(variant);

    const variantBody = readFileSync(variantFixture.bodyPath, 'utf8');
    // Each variant must modify the body in a verifiable way.
    switch (variant) {
      case 'chinese-colon':
        // Body prose Summary / Findings must contain fullwidth colon.
        // (audit-security parent has "Test security envelope for dogfood."
        // and "HIGH: hardcoded password..." — both get mutated.)
        expect(variantBody).toMatch(/：/);
        break;
      case 'yaml-frontmatter-variation':
        // CRLF in frontmatter.
        expect(variantBody).toMatch(/\r\n/);
        break;
      case 'double-format':
        expect(variantBody).toContain('## Embedded JSON');
        break;
      case 'empty-body':
        // Body has no `## Findings` block.
        expect(variantBody).not.toContain('## Findings');
        // Summary section remains.
        expect(variantBody).toContain('## Summary');
        break;
      case 'multi-findings':
        // Findings block duplicated.
        const findingsCount = variantBody.match(/## Findings/g)?.length ?? 0;
        expect(findingsCount).toBeGreaterThanOrEqual(2);
        break;
    }
  });
});
