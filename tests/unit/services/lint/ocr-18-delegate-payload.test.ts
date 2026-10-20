// tests/unit/services/lint/ocr-18-delegate-payload.test.ts
//
// The pinned CLI's delegation payloads, parsed at their boundary.
//
// Dimensions covered:
//   - behavior:    argv construction, strict parsing, batch merge
//   - integration: the two `delegate` calls are module seams here (no process)
//   - render:      the parsed preview the preview verb prints
//   - a11y:        not applicable — no human-facing text in this module

import { describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/lint/ocr-18-delegate-payload.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'no human-facing surface in a payload parser' }]
);

/** The invocation seam. Everything else in the adapter stays real. */
const seam = vi.hoisted(() => ({
  invocations: [] as Array<{ args: string[]; cwd: string }>,
  next: [] as unknown[]
}));

vi.mock('../../../../src/services/lint/ocr-multilang-adapter.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-multilang-adapter.js'
  );
  return {
    ...actual,
    invokeOcr: (args: string[], cwd: string) => {
      seam.invocations.push({ args, cwd });
      return seam.next.shift() ?? { ok: true, stdout: '{}', stderr: '' };
    }
  };
});

import {
  buildDelegatePreviewArgs,
  buildDelegateRuleArgs,
  parseDelegatePreview,
  parseDelegateRules,
  runDelegatePreview
} from '../../../../src/services/lint/ocr-18-delegate-payload.js';
import { collectDelegateRules } from '../../../../src/services/lint/ocr-18-delegate-packet.js';
import { OCR_18_PACKAGE } from '../../../../src/services/lint/ocr-multilang-adapter.js';

/** Verbatim-shaped `ocr delegate preview --format json` (1.13.1, measured 2026-10-20). */
const PREVIEW = {
  schema_version: '1',
  mode: 'range',
  repository: 'D:/projects/peaks-loop',
  from: '77a38b82',
  to: 'e905f8eb',
  merge_base: '77a38b823a7af27942cc34c1a8422e7200d91095',
  total_files: 3,
  reviewable_count: 2,
  excluded_count: 1,
  total_insertions: 40,
  total_deletions: 5,
  reviewable_files: [
    { path: 'src/a.ts', status: 'modified', insertions: 30, deletions: 5 },
    { path: 'package.json', status: 'modified', insertions: 10, deletions: 0 }
  ],
  excluded_files: [
    {
      path: 'README.md',
      status: 'modified',
      insertions: 1,
      deletions: 0,
      exclude_reason: 'unsupported_ext'
    }
  ]
};

/** Verbatim-shaped `ocr delegate rule --format json` (1.13.1, measured 2026-10-20). */
const RULES = {
  schema_version: '1',
  groups: [
    {
      group_id: 1,
      source: 'system',
      pattern: '**/*.{ts,js,tsx,jsx,mjs,cjs}',
      files: ['src/a.ts'],
      rule: '#### Dead Code\n- Variables that are declared but never read'
    }
  ]
};

const reviewPayload = {
  status: 'success',
  comments: [{ path: 'src/a.ts', content: 'x', start_line: 1, severity: 'high' }]
};

describe('behavior — the argv is the pinned CLI, not a review', () => {
  it('should pin the package, name delegate preview and ask for json', () => {
    const args = buildDelegatePreviewArgs({ from: 'main', to: 'HEAD' });

    expect(args).toContain(OCR_18_PACKAGE);
    expect(args).toEqual(expect.arrayContaining(['ocr', 'delegate', 'preview']));
    expect(args).toEqual(expect.arrayContaining(['--from', 'main', '--to', 'HEAD']));
    expect(args).toEqual(expect.arrayContaining(['--format', 'json']));
    expect(args).not.toContain('review');
  });

  it('should pass the paths to delegate rule as argv entries', () => {
    const args = buildDelegateRuleArgs(['src/a.ts', 'src/b go.ts'], { commit: 'abc123' });

    expect(args).toEqual(expect.arrayContaining(['ocr', 'delegate', 'rule']));
    expect(args).toContain('src/a.ts');
    expect(args).toContain('src/b go.ts');
    expect(args).toEqual(expect.arrayContaining(['--commit', 'abc123', '--format', 'json']));
  });
});

describe('behavior — preview parsing refuses a review payload', () => {
  it('should parse the measured preview payload', () => {
    const parsed = parseDelegatePreview(JSON.stringify(PREVIEW));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.preview.reviewable_files).toHaveLength(2);
    expect(parsed.preview.excluded_files[0]?.exclude_reason).toBe('unsupported_ext');
    expect(parsed.preview.total_insertions).toBe(40);
  });

  it('should refuse a comments[] review payload rather than read it as a selection', () => {
    const parsed = parseDelegatePreview(JSON.stringify(reviewPayload));

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('reviewable_files');
  });

  it('should refuse output that is not JSON', () => {
    const parsed = parseDelegatePreview('Delegation Mode\nWill review 3 files');

    expect(parsed.ok).toBe(false);
  });

  it('should refuse a preview whose cost fields are missing', () => {
    const parsed = parseDelegatePreview(JSON.stringify({ reviewable_files: [] }));

    expect(parsed.ok).toBe(false);
  });

  it('should name the offending index when a file entry is malformed', () => {
    const parsed = parseDelegatePreview(
      JSON.stringify({ ...PREVIEW, reviewable_files: [{ path: 'src/a.ts' }] })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toContain('reviewable_files[0]');
  });
});

describe('behavior — rule parsing', () => {
  it('should parse the measured groups payload', () => {
    const parsed = parseDelegateRules(JSON.stringify(RULES));

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.groups[0]?.pattern).toBe('**/*.{ts,js,tsx,jsx,mjs,cjs}');
    expect(parsed.groups[0]?.rule).toContain('Dead Code');
  });

  it('should refuse output with no groups[]', () => {
    const parsed = parseDelegateRules(JSON.stringify({ schema_version: '1' }));

    expect(parsed.ok).toBe(false);
  });

  it('should refuse a group whose rule text is not a string', () => {
    const parsed = parseDelegateRules(
      JSON.stringify({ ...RULES, groups: [{ ...RULES.groups[0], rule: null }] })
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.rawOutput).toContain('groups[0]');
  });
});

describe('integration — rule resolution batches and merges', () => {
  it('should split a large file list and merge groups by source|pattern', () => {
    const paths = Array.from({ length: 55 }, (_, index) => `src/f${String(index)}.ts`);
    seam.invocations.length = 0;
    seam.next.length = 0;
    seam.next.push(
      {
        ok: true,
        stdout: JSON.stringify({
          groups: [{ ...RULES.groups[0], files: paths.slice(0, 50) }]
        }),
        stderr: ''
      },
      {
        ok: true,
        stdout: JSON.stringify({
          groups: [{ ...RULES.groups[0], group_id: 2, files: paths.slice(50) }]
        }),
        stderr: ''
      }
    );

    const parsed = collectDelegateRules(process.cwd(), paths, {});

    expect(seam.invocations).toHaveLength(2);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0]?.files).toHaveLength(55);
  });

  it('should not spawn anything for an empty file list', () => {
    seam.invocations.length = 0;

    const parsed = collectDelegateRules(process.cwd(), [], {});

    expect(seam.invocations).toHaveLength(0);
    expect(parsed).toEqual({ ok: true, groups: [] });
  });

  it('should carry the invocation state when delegate rule cannot run', () => {
    seam.next.length = 0;
    seam.next.push({ ok: false, state: 'ocr18-missing', rawOutput: 'ENOENT' });

    const parsed = collectDelegateRules(process.cwd(), ['src/a.ts'], {});

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.state).toBe('ocr18-missing');
  });
});

describe('render — the preview verb payload', () => {
  it('should return the parsed preview, never a review result', () => {
    seam.next.length = 0;
    seam.next.push({ ok: true, stdout: JSON.stringify(PREVIEW), stderr: '' });

    const result = runDelegatePreview(process.cwd());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.preview.reviewable_count).toBe(2);
  });

  it('should report a non-preview payload as execution-failed, not as a clean run', () => {
    seam.next.length = 0;
    seam.next.push({ ok: true, stdout: JSON.stringify(reviewPayload), stderr: '' });

    const result = runDelegatePreview(process.cwd());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.state).toBe('execution-failed');
    expect(result.rawOutput).toContain('reviewable_files');
  });
});
