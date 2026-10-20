// tests/unit/services/lint/ocr-18-delegate-record.test.ts
//
// Phase 2 of the delegated review: the host agent's envelope, validated and
// recorded. The refusals are the point — a malformed envelope must never be
// coerced into a finding, and a packet cannot be invented by an envelope.
//
// Dimensions covered:
//   - behavior:    validation accept/reject, the packet binding, severity mapping
//   - render:      the recorded document (attribution, summary, state)
//   - integration: real files in a temporary project root
//   - a11y:        not applicable — a machine-facing artifact

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/lint/ocr-18-delegate-record.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'a machine-facing artifact with no terminal surface' }]
);

import {
  parseEnvelope,
  recordDelegateFindings,
  type DelegateFindingsDocument
} from '../../../../src/services/lint/ocr-18-delegate-record.js';
import type { DelegatePacket } from '../../../../src/services/lint/ocr-18-delegate-packet.js';

const RID = 'ocr-delegate-review';

function packetWith(overrides: Partial<DelegatePacket> = {}): DelegatePacket {
  return {
    schema_version: '1',
    mode: 'delegate',
    state: 'awaiting-envelope',
    findings: null,
    rid: RID,
    session: '2026-10-20-session-a545d0',
    git: { from: 'main', to: 'HEAD', commit: null },
    detection: { languages: ['typescript'], changed_file_count: 1, unsupported_files: [] },
    cost: {
      total_files: 1,
      reviewable_count: 1,
      excluded_count: 0,
      total_insertions: 4,
      total_deletions: 1
    },
    selected_files: [],
    excluded_files: [],
    rules: [],
    warnings: [],
    raw_output: null,
    ...overrides
  };
}

function envelopeFor(packetPath: string, findings: readonly unknown[] = []) {
  return JSON.stringify({ schema_version: '1', packet: packetPath, findings });
}

const FINDING = {
  path: 'src/a.ts',
  content: 'SQL string concatenation',
  start_line: 12,
  end_line: 14,
  severity: 'critical',
  category: 'security'
};

describe('behavior — envelope validation refuses rather than coerces', () => {
  it('should accept the documented shape and map through the existing severity map', () => {
    const parsed = parseEnvelope(
      JSON.stringify({ schema_version: '1', packet: 'p.json', findings: [FINDING] })
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.findings[0]).toEqual({
      filePath: 'src/a.ts',
      line: 12,
      ruleId: 'security',
      severity: 'error',
      message: 'SQL string concatenation',
      attribution: 'ocr-delegate'
    });
  });

  it('should accept an empty findings array as a clean review', () => {
    const parsed = parseEnvelope(
      JSON.stringify({ schema_version: '1', packet: 'p.json', findings: [] })
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.findings).toEqual([]);
  });

  it('should refuse a non-JSON envelope', () => {
    expect(parseEnvelope('findings: none')).toMatchObject({ ok: false });
  });

  it('should refuse a missing findings array, telling the agent what a clean review looks like', () => {
    const parsed = parseEnvelope(JSON.stringify({ schema_version: '1', packet: 'p.json' }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('findings');
    expect(parsed.message).toContain('[]');
  });

  it('should refuse an envelope that does not name its packet', () => {
    const parsed = parseEnvelope(JSON.stringify({ schema_version: '1', findings: [] }));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('packet');
  });

  it('should refuse a missing path and a missing content, naming the entry', () => {
    const noPath = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        packet: 'p.json',
        findings: [{ ...FINDING, path: '' }]
      })
    );
    const noContent = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        packet: 'p.json',
        findings: [{ ...FINDING, content: undefined }]
      })
    );

    expect(noPath).toMatchObject({ ok: false });
    expect(noContent).toMatchObject({ ok: false });
    if (noPath.ok || noContent.ok) return;
    expect(noPath.message).toContain('findings[0].path');
    expect(noContent.message).toContain('findings[0].content');
  });

  it('should refuse a non-numeric start_line', () => {
    const parsed = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        packet: 'p.json',
        findings: [{ ...FINDING, start_line: '12' }]
      })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('findings[0].start_line');
  });

  it('should refuse an unknown severity, naming the value', () => {
    const parsed = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        packet: 'p.json',
        findings: [{ ...FINDING, severity: 'blocker' }]
      })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('findings[0].severity');
    expect(parsed.message).toContain('blocker');
  });

  it('should refuse an end_line before start_line', () => {
    const parsed = parseEnvelope(
      JSON.stringify({
        schema_version: '1',
        packet: 'p.json',
        findings: [{ ...FINDING, start_line: 9, end_line: 4 }]
      })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('end_line');
  });

  it('should refuse an unknown schema_version', () => {
    const parsed = parseEnvelope(
      JSON.stringify({ schema_version: '2', packet: 'p.json', findings: [] })
    );

    expect(parsed.ok).toBe(false);
  });

  it('should refuse a numeric schema_version, which is not the documented form', () => {
    const parsed = parseEnvelope(
      JSON.stringify({ schema_version: 1, packet: 'p.json', findings: [] })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('string "1"');
  });
});

describe('integration — recording against a real packet', () => {
  let root = '';
  let packetPath = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-delegate-record-'));
    packetPath = join(
      root,
      '.peaks',
      '_runtime',
      'sid',
      'rd',
      'ocr-delegate',
      `${RID}-packet.json`
    );
    mkdirSync(join(root, '.peaks', '_runtime', 'sid', 'rd', 'ocr-delegate'), { recursive: true });
    writeFileSync(packetPath, `${JSON.stringify(packetWith(), null, 2)}\n`, 'utf8');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should record findings beside the packet with ocr-delegate attribution', () => {
    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [FINDING])
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.state).toBe('recorded');
    expect(result.document.attribution).toBe('ocr-delegate');
    expect(result.document.rid).toBe(RID);
    expect(result.document.findings[0]?.attribution).toBe('ocr-delegate');
    expect(result.document.summary.total).toBe(1);
    expect(result.document.summary.bySeverity.error).toBe(1);
    const written = JSON.parse(
      readFileSync(result.findingsPath, 'utf8')
    ) as DelegateFindingsDocument;
    expect(written.packet).toBe(packetPath);
  });

  it('should record a clean review as findings [] with a zero summary', () => {
    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [])
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.findings).toEqual([]);
    expect(result.document.summary.total).toBe(0);
  });

  it('should refuse an envelope that names a different packet', () => {
    const other = join(root, 'other-packet.json');

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(other, [])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_MISMATCH' });
  });

  it('should refuse an envelope whose packet does not exist', () => {
    const missing = join(root, 'nope-packet.json');

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath: missing,
      envelopeText: envelopeFor(missing, [])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
  });

  it('should refuse findings against a packet that records no review at all', () => {
    writeFileSync(
      packetPath,
      `${JSON.stringify(packetWith({ state: 'no-routed-language' }), null, 2)}\n`,
      'utf8'
    );

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [FINDING])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
    if (result.ok) return;
    expect(result.message).toContain('no-routed-language');
  });

  it('should refuse a packet that is not a delegation packet', () => {
    writeFileSync(packetPath, `${JSON.stringify({ schema_version: '1', comments: [] })}\n`, 'utf8');

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
  });

  it('should refuse a packet that carries a findings array', () => {
    writeFileSync(
      packetPath,
      `${JSON.stringify({ ...packetWith(), findings: [] }, null, 2)}\n`,
      'utf8'
    );

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
    if (result.ok) return;
    expect(result.message).toContain('carries findings');
  });

  it('should not read an omitted findings key as a packet that carries findings', () => {
    const bare: Record<string, unknown> = { ...packetWith() };
    delete bare['findings'];
    writeFileSync(packetPath, `${JSON.stringify(bare, null, 2)}\n`, 'utf8');

    const result = recordDelegateFindings({
      projectRoot: root,
      packetPath,
      envelopeText: envelopeFor(packetPath, [])
    });

    expect(result.ok).toBe(true);
  });

  it('should refuse a packet outside the project root', () => {
    const outside = mkdtempSync(join(tmpdir(), 'peaks-delegate-outside-'));
    const outsidePacket = join(outside, 'rid-packet.json');
    writeFileSync(outsidePacket, `${JSON.stringify(packetWith(), null, 2)}\n`, 'utf8');
    try {
      const result = recordDelegateFindings({
        projectRoot: root,
        packetPath: outsidePacket,
        envelopeText: envelopeFor(outsidePacket, [])
      });

      expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it('should refuse a project root that does not exist rather than throwing', () => {
    const result = recordDelegateFindings({
      projectRoot: join(root, 'no-such-project'),
      packetPath,
      envelopeText: envelopeFor(packetPath, [])
    });

    expect(result).toMatchObject({ ok: false, code: 'PACKET_INVALID' });
    if (result.ok) return;
    expect(result.message).toContain('project root does not exist');
  });
});

describe('render — not-executed and clean-zero are not the same shape', () => {
  it('should distinguish a packet awaiting an envelope from a recorded clean review', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-delegate-shape-'));
    const packetPath = join(root, 'rid-packet.json');
    const packet = packetWith();
    writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
    try {
      const result = recordDelegateFindings({
        projectRoot: root,
        packetPath,
        envelopeText: envelopeFor(packetPath, [])
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // Not executed: the packet exists, no review ran.
      expect(packet.state).toBe('awaiting-envelope');
      expect(packet.findings).toBeNull();
      // Executed and clean: a recorded document with an empty array.
      expect(result.document.state).toBe('recorded');
      expect(result.document.findings).toEqual([]);
      // The two shapes differ in BOTH the state and the findings value, so a
      // count-only reader cannot report "never ran" as "zero findings".
      expect(result.document.state).not.toBe(packet.state);
      expect(result.document.findings).not.toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
