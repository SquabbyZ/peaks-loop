// tests/unit/cli/commands/code-review-ocr-delegate.test.ts
//
// The delegated review's two CLI phases, driven through the real commander
// program. Phase 1's OCR/git seams are replaced at their module boundary; phase
// 2 writes real files in a temporary project root, because the binding between
// the packet and the findings is the thing under test.
//
// Dimensions covered:
//   - render:      the JSON envelope for both phases, including the refusals
//   - behavior:    flag rules (rid required, no language scope) and exit codes
//   - integration: phase 2 against real files
//   - a11y:        not applicable — hidden machine-facing verbs

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';

declareDimensions(
  'tests/unit/cli/commands/code-review-ocr-delegate.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'hidden machine-facing verbs with no terminal UI' }]
);

const seams = vi.hoisted(
  (): {
    collect: Array<Record<string, unknown>>;
    writes: Array<{ path: string; packet: unknown }>;
    result: unknown;
  } => ({ collect: [], writes: [], result: null })
);

vi.mock('../../../../src/services/lint/ocr-18-delegate-packet.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-18-delegate-packet.js'
  );
  return {
    ...actual,
    collectDelegatePacket: (options: Record<string, unknown>) => {
      seams.collect.push(options);
      return seams.result;
    },
    writeDelegatePacket: (path: string, packet: unknown) => {
      seams.writes.push({ path, packet });
    }
  };
});

import { registerCodeReviewCommands } from '../../../../src/cli/commands/code-review-commands.js';
import {
  buildDelegatePacket,
  type DelegatePacket
} from '../../../../src/services/lint/ocr-18-delegate-packet.js';

interface Envelope {
  ok: boolean;
  code?: string;
  message?: string;
  data: Record<string, unknown>;
  warnings: string[];
  nextActions: string[];
}

function packetState(state: DelegatePacket['state']): DelegatePacket {
  return buildDelegatePacket({
    rid: 'ocr-delegate-review',
    session: 'sid',
    range: { from: 'main', to: 'HEAD' },
    detection: { languages: ['typescript'], changedFileCount: 1, unsupportedFiles: [] },
    preview:
      state === 'awaiting-envelope'
        ? {
            schema_version: '1',
            mode: 'range',
            repository: 'repo',
            total_files: 1,
            reviewable_count: 1,
            excluded_count: 0,
            total_insertions: 3,
            total_deletions: 1,
            reviewable_files: [
              { path: 'src/a.ts', status: 'modified', insertions: 3, deletions: 1 }
            ],
            excluded_files: []
          }
        : null,
    rules: [],
    unavailable: state === 'ocr-unavailable' ? 'ENOENT' : null
  });
}

async function run(
  args: string[]
): Promise<{ body: Envelope; captured: ReturnType<typeof makeCapturedIo> }> {
  const captured = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerCodeReviewCommands(program, captured.io);
  await program.parseAsync(['code-review', ...args], { from: 'user' });
  return { body: JSON.parse(captured.captured.text()) as Envelope, captured };
}

let root = '';

beforeEach(() => {
  seams.collect.length = 0;
  seams.writes.length = 0;
  seams.result = { packet: packetState('awaiting-envelope'), failure: null };
  root = mkdtempSync(join(tmpdir(), 'peaks-ocr-delegate-cli-'));
  process.exitCode = 0;
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  process.exitCode = 0;
});

describe('behavior — phase 1 refuses what delegation cannot express', () => {
  it('should refuse --delegate without a rid, because the packet is named after it', async () => {
    const { body } = await run(['run-ocr-18', '--delegate', '--json']);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('RID_REQUIRED');
    expect(seams.collect).toEqual([]);
  });

  it('should refuse an explicit language list, which delegate mode cannot honour', async () => {
    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--languages',
      'ts,go',
      '--rid',
      'r',
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('LANGUAGE_FLAGS_CONFLICT');
    expect(seams.collect).toEqual([]);
  });

  it('should refuse a rid that is not a single path segment, before any path is built', async () => {
    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--rid',
      '../escape',
      '--session-id',
      'sid',
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('INVALID_RID');
    expect(seams.collect).toEqual([]);
    expect(seams.writes).toEqual([]);
  });

  it('should accept --languages auto case-insensitively, like the API path does', async () => {
    await run([
      'run-ocr-18',
      '--delegate',
      '--languages',
      'AUTO',
      '--rid',
      'r',
      '--session-id',
      'sid',
      '--json'
    ]);

    expect(seams.collect).toHaveLength(1);
  });

  it('should refuse --language alongside --delegate', async () => {
    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--language',
      'go',
      '--rid',
      'r',
      '--json'
    ]);

    expect(body.code).toBe('LANGUAGE_FLAGS_CONFLICT');
    expect(seams.collect).toEqual([]);
  });
});

describe('render — phase 1 writes and returns the packet', () => {
  it('should accept --languages auto, write under the session tree, and name the record verb', async () => {
    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--languages',
      'auto',
      '--rid',
      'ocr-delegate-review',
      '--session-id',
      'sid',
      '--from',
      'main',
      '--to',
      'HEAD',
      '--json'
    ]);

    expect(body.ok).toBe(true);
    expect(body.data['state']).toBe('awaiting-envelope');
    expect(body.data['findings']).toBeNull();
    const packetPath = body.data['packetPath'] as string;
    expect(packetPath.replace(/\\/g, '/')).toContain(
      '.peaks/_runtime/sid/rd/ocr-delegate/ocr-delegate-review-packet.json'
    );
    expect(seams.writes).toHaveLength(1);
    expect(seams.writes[0]?.path).toBe(packetPath);
    expect(body.nextActions.join(' ')).toContain('ocr-delegate-record');
  });

  it('should say nothing was reviewed when the range has no routed language', async () => {
    seams.result = {
      packet: packetState('unsupported-files-only'),
      failure: null
    };

    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--rid',
      'r',
      '--session-id',
      'sid',
      '--json'
    ]);

    expect(body.ok).toBe(true);
    expect(body.data['state']).toBe('unsupported-files-only');
    expect(body.warnings.join(' ')).toContain('not a clean review');
  });

  it('should fail the envelope when OCR itself could not run, keeping the packet', async () => {
    seams.result = {
      packet: packetState('ocr-unavailable'),
      failure: { state: 'ocr18-missing', rawOutput: 'ENOENT' }
    };

    const { body } = await run([
      'run-ocr-18',
      '--delegate',
      '--rid',
      'r',
      '--session-id',
      'sid',
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('OCR18_MISSING');
    expect(body.data['state']).toBe('ocr-unavailable');
    expect(seams.writes).toHaveLength(1);
  });
});

describe('render — phase 2 records validated findings', () => {
  function writePacket(packet: DelegatePacket): string {
    const dir = join(root, '.peaks', '_runtime', 'sid', 'rd', 'ocr-delegate');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, 'ocr-delegate-review-packet.json');
    writeFileSync(path, `${JSON.stringify(packet, null, 2)}\n`, 'utf8');
    return path;
  }

  function writeEnvelope(packetPath: string, findings: readonly unknown[]): string {
    const path = join(root, 'envelope.json');
    writeFileSync(
      path,
      JSON.stringify({ schema_version: '1', packet: packetPath, findings }),
      'utf8'
    );
    return path;
  }

  it('should record the findings with attribution and report where they landed', async () => {
    const packetPath = writePacket(packetState('awaiting-envelope'));
    const envelopePath = writeEnvelope(packetPath, [
      {
        path: 'src/a.ts',
        content: 'hardcoded credential',
        start_line: 4,
        end_line: 4,
        severity: 'high',
        category: 'security'
      }
    ]);

    const { body } = await run([
      'ocr-delegate-record',
      '--packet',
      packetPath,
      '--envelope',
      envelopePath,
      '--project',
      root,
      '--json'
    ]);

    expect(body.ok).toBe(true);
    expect(body.data['state']).toBe('recorded');
    expect(body.data['attribution']).toBe('ocr-delegate');
    const findingsPath = body.data['findingsPath'] as string;
    const written = JSON.parse(readFileSync(findingsPath, 'utf8')) as {
      findings: Array<Record<string, unknown>>;
    };
    expect(written.findings[0]?.['attribution']).toBe('ocr-delegate');
    expect(written.findings[0]?.['severity']).toBe('error');
    expect(process.exitCode).toBe(0);
  });

  it('should refuse an unknown severity, naming the entry, and exit non-zero', async () => {
    const packetPath = writePacket(packetState('awaiting-envelope'));
    const envelopePath = writeEnvelope(packetPath, [
      { path: 'src/a.ts', content: 'x', start_line: 1, severity: 'blocker' }
    ]);

    const { body } = await run([
      'ocr-delegate-record',
      '--packet',
      packetPath,
      '--envelope',
      envelopePath,
      '--project',
      root,
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('ENVELOPE_INVALID');
    expect(body.message).toContain('findings[0].severity');
    expect(process.exitCode).toBe(1);
  });

  it('should refuse inline JSON passed as the envelope, naming the flag as a path', async () => {
    const { body } = await run([
      'ocr-delegate-record',
      '--packet',
      join(root, 'missing-packet.json'),
      '--envelope',
      '{"schema_version":"1","packet":"p","findings":[]}',
      '--project',
      root,
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('ENVELOPE_INVALID');
    expect(body.message).toContain('path to a readable JSON file');
    expect(process.exitCode).toBe(1);
  });

  it('should refuse an unreadable envelope path', async () => {
    const { body } = await run([
      'ocr-delegate-record',
      '--packet',
      join(root, 'missing-packet.json'),
      '--envelope',
      join(root, 'missing-envelope.json'),
      '--project',
      root,
      '--json'
    ]);

    expect(body.ok).toBe(false);
    expect(body.code).toBe('ENVELOPE_INVALID');
    expect(process.exitCode).toBe(1);
  });
});
