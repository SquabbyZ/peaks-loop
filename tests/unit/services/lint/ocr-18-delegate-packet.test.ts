// tests/unit/services/lint/ocr-18-delegate-packet.test.ts
//
// Phase 1 of the delegated review: the packet the host agent reviews from.
//
// Dimensions covered:
//   - behavior:    state selection, pattern join, orchestration order
//   - render:      the packet's JSON shape (including `findings: null`)
//   - integration: the OCR invocations and the git detection are module seams
//   - a11y:        not applicable — a machine-facing artifact

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/lint/ocr-18-delegate-packet.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'a machine-facing artifact with no terminal surface' }]
);

const seams = vi.hoisted(
  (): {
    detection: { languages: string[]; changedFileCount: number; unsupportedFiles: string[] };
    calls: Array<{ args: string[] }>;
    results: unknown[];
  } => ({
    detection: { languages: [], changedFileCount: 0, unsupportedFiles: [] },
    calls: [],
    results: []
  })
);

/** The OCR invocation seam. The payload parsers stay real, so the packet is built from real JSON. */
vi.mock('../../../../src/services/lint/ocr-multilang-adapter.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-multilang-adapter.js'
  );
  return {
    ...actual,
    invokeOcr: (args: string[]) => {
      seams.calls.push({ args });
      return seams.results.shift() ?? { ok: true, stdout: '{}', stderr: '' };
    }
  };
});

vi.mock('../../../../src/services/lint/ocr-18-multi.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-18-multi.js'
  );
  return { ...actual, detectLanguages: () => seams.detection };
});

import {
  buildDelegatePacket,
  collectDelegatePacket,
  writeDelegatePacket,
  type DelegatePacket
} from '../../../../src/services/lint/ocr-18-delegate-packet.js';
import type {
  DelegatePreview,
  DelegateRuleGroup
} from '../../../../src/services/lint/ocr-18-delegate-payload.js';

const PREVIEW: DelegatePreview = {
  schema_version: '1',
  mode: 'range',
  repository: 'D:/projects/peaks-loop',
  total_files: 2,
  reviewable_count: 1,
  excluded_count: 1,
  total_insertions: 30,
  total_deletions: 5,
  reviewable_files: [{ path: 'src/a.ts', status: 'modified', insertions: 30, deletions: 5 }],
  excluded_files: [
    {
      path: 'README.md',
      status: 'modified',
      insertions: 2,
      deletions: 0,
      exclude_reason: 'unsupported_ext'
    }
  ]
};

const RULES: readonly DelegateRuleGroup[] = [
  {
    group_id: 1,
    source: 'system',
    pattern: '**/*.{ts,js}',
    files: ['src/a.ts'],
    rule: '#### Dead Code'
  }
];

const DETECTION = {
  languages: ['typescript' as const],
  changedFileCount: 2,
  unsupportedFiles: ['README.md']
};

function packetInput(overrides: Partial<Parameters<typeof buildDelegatePacket>[0]> = {}) {
  return {
    rid: 'ocr-delegate-review',
    session: '2026-10-20-session-a545d0',
    range: { from: 'main', to: 'HEAD' },
    detection: DETECTION,
    preview: PREVIEW,
    rules: RULES,
    unavailable: null,
    ...overrides
  };
}

function ruleCalls(): number {
  return seams.calls.filter((call) => call.args.includes('rule')).length;
}

beforeEach(() => {
  seams.detection = {
    languages: ['typescript'],
    changedFileCount: 2,
    unsupportedFiles: ['README.md']
  };
  seams.calls.length = 0;
  seams.results = [
    { ok: true, stdout: JSON.stringify(PREVIEW), stderr: '' },
    { ok: true, stdout: JSON.stringify({ groups: RULES }), stderr: '' }
  ];
});

describe('render — the packet shape', () => {
  it('should carry the selection pattern, the language and the cost surface', () => {
    const packet = buildDelegatePacket(packetInput());

    expect(packet.state).toBe('awaiting-envelope');
    expect(packet.findings).toBeNull();
    expect(packet.selected_files).toEqual([
      {
        path: 'src/a.ts',
        status: 'modified',
        insertions: 30,
        deletions: 5,
        language: 'typescript',
        pattern: '**/*.{ts,js}'
      }
    ]);
    expect(packet.excluded_files[0]?.exclude_reason).toBe('unsupported_ext');
    expect(packet.cost).toEqual({
      total_files: 2,
      reviewable_count: 1,
      excluded_count: 1,
      total_insertions: 30,
      total_deletions: 5
    });
    expect(packet.git).toEqual({ from: 'main', to: 'HEAD', commit: null });
    expect(packet.rules).toEqual(RULES);
    expect(packet.detection.unsupported_files).toEqual(['README.md']);
  });

  it('should report a file no rule group claimed with a null pattern and a warning', () => {
    const packet = buildDelegatePacket(packetInput({ rules: [] }));

    expect(packet.selected_files[0]?.pattern).toBeNull();
    expect(packet.warnings.join(' ')).toContain('no rule group matched src/a.ts');
  });
});

describe('behavior — the four outcomes plus not-executed stay distinguishable', () => {
  it('should report a range with zero changed files as no-routed-language', () => {
    const packet = buildDelegatePacket(
      packetInput({
        preview: null,
        rules: [],
        detection: { languages: [], changedFileCount: 0, unsupportedFiles: [] }
      })
    );

    expect(packet.state).toBe('no-routed-language');
    expect(packet.findings).toBeNull();
    expect(packet.cost).toBeNull();
  });

  it('should report changed files with no routed language as unsupported-files-only', () => {
    const packet = buildDelegatePacket(
      packetInput({
        preview: null,
        rules: [],
        detection: { languages: [], changedFileCount: 1, unsupportedFiles: ['README.md'] }
      })
    );

    expect(packet.state).toBe('unsupported-files-only');
    expect(packet.findings).toBeNull();
  });

  it('should report an unusable CLI as ocr-unavailable, keeping the raw output', () => {
    const packet = buildDelegatePacket(
      packetInput({ preview: null, rules: [], unavailable: 'ENOENT: ocr not found' })
    );

    expect(packet.state).toBe('ocr-unavailable');
    expect(packet.findings).toBeNull();
    expect(packet.raw_output).toContain('ENOENT');
  });
});

describe('integration — collection', () => {
  it('should run preview then rules and return an awaiting-envelope packet', () => {
    const collected = collectDelegatePacket({
      cwd: process.cwd(),
      rid: 'ocr-delegate-review',
      session: '2026-10-20-session-a545d0',
      range: {}
    });

    expect(ruleCalls()).toBe(1);
    expect(seams.calls).toHaveLength(2);
    expect(collected.failure).toBeNull();
    expect(collected.packet.state).toBe('awaiting-envelope');
    expect(collected.packet.rid).toBe('ocr-delegate-review');
    expect(collected.packet.selected_files[0]?.pattern).toBe('**/*.{ts,js}');
  });

  it('should skip both invocations when no language is routed', () => {
    seams.detection = { languages: [], changedFileCount: 3, unsupportedFiles: ['a.md', 'b.yaml'] };

    const collected = collectDelegatePacket({
      cwd: process.cwd(),
      rid: 'ocr-delegate-review',
      session: '2026-10-20-session-a545d0',
      range: {}
    });

    expect(seams.calls).toHaveLength(0);
    expect(collected.packet.state).toBe('unsupported-files-only');
    expect(collected.packet.rules).toEqual([]);
  });

  it('should not resolve rules when the preview payload is not a delegation spec', () => {
    seams.results = [{ ok: true, stdout: JSON.stringify({ comments: [] }), stderr: '' }];

    const collected = collectDelegatePacket({
      cwd: process.cwd(),
      rid: 'ocr-delegate-review',
      session: '2026-10-20-session-a545d0',
      range: {}
    });

    expect(ruleCalls()).toBe(0);
    expect(collected.failure).toMatchObject({ state: 'execution-failed' });
    expect(collected.packet.state).toBe('ocr-unavailable');
    expect(collected.packet.raw_output).toContain('reviewable_files');
  });

  it('should refuse a rid that is not a single path segment', () => {
    expect(() =>
      collectDelegatePacket({
        cwd: process.cwd(),
        rid: '../escape',
        session: '2026-10-20-session-a545d0',
        range: {}
      })
    ).toThrow(/invalid rid/);
  });
});

describe('integration — the durable write', () => {
  let root = '';

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-delegate-packet-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('should create the directory and write the packet as JSON', () => {
    const packet: DelegatePacket = buildDelegatePacket(packetInput());
    const packetPath = join(root, 'rd', 'ocr-delegate', 'rid-packet.json');

    writeDelegatePacket(packetPath, packet);

    const written = JSON.parse(readFileSync(packetPath, 'utf8')) as Record<string, unknown>;
    expect(written['state']).toBe('awaiting-envelope');
    expect(written['findings']).toBeNull();
    expect(written['rid']).toBe('ocr-delegate-review');
  });
});
