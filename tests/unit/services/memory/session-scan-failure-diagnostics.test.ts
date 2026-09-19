// tests/unit/services/memory/session-scan-failure-diagnostics.test.ts
//
// N2 — an unreadable session artifact was swallowed by a bare
// `catch { // TODO(g2): legacy silent catch … }` in `extractSessionMemories`.
//
// WHAT THE TODO ASKS FOR. `TODO(g2)` is not a note-to-self in this function; it
// is the repo-wide grace marker read by `scripts/lint/silent-warning-detector.mjs`
// (slice A.2 of v2-14-0-anti-fake-green-hardening, see its header):
//
//   "Grace period: any source line may carry `// TODO(g2):` to suppress the
//    violation for one minor release (~6 weeks) per A2.2."
//
// The violation here is anti-pattern #1, `empty-catch`. So the marker asks for
// the swallow to be replaced by a real channel, and it has been: the file is
// named in the same envelope `warnings` array as the block drops, and the marker
// is gone from that line because the detector no longer has anything to
// suppress. Control flow is deliberately unchanged — an unreadable artifact
// still must not abort the scan of the others, which is the behaviour the grace
// period was protecting.
//
// The read failure needs a real thrown `readFileSync`: ESM module namespaces are
// frozen, so `vi.spyOn(fs, 'readFileSync')` throws "Cannot redefine property".
// The accepted workaround (same as tests/unit/code/step-08-gate.test.ts) is a
// per-file `vi.mock('node:fs', …)` over a `vi.hoisted` handle. It lives in its
// own file so the sibling diagnostics tests keep the real filesystem.
//
// Run with:
//   pnpm vitest run tests/unit/services/memory/session-scan-failure-diagnostics.test.ts

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __fsMocks = vi.hoisted(() => ({
  /** Throw instead of reading when the path matches. `null` = pass through. */
  throwFor: null as RegExp | null,
  message: 'EACCES: permission denied, open'
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      const target = args[0];
      if (typeof target === 'string' && __fsMocks.throwFor?.test(target)) {
        throw new Error(__fsMocks.message);
      }
      return (actual.readFileSync as (...inner: unknown[]) => unknown)(...args);
    }
  };
});

import {
  describeSessionScanFailures,
  extractSessionMemories
} from '~/src/services/memory/project-memory-service/index';

const START = '<!-- peaks-memory:start -->';
const END = '<!-- peaks-memory:end -->';

function block(inner: string): string {
  return `${START}\n${inner}\n${END}`;
}

describe('extractSessionMemories names session artifacts it could not read', () => {
  let root: string;
  const sessionId = '2026-09-17-session-n2';
  const handoff = (): string => join(root, '.peaks', '_runtime', sessionId, 'txt');

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'peaks-n2-scan-'));
    mkdirSync(join(root, '.peaks', 'memory'), { recursive: true });
    mkdirSync(handoff(), { recursive: true });
    writeFileSync(
      join(handoff(), 'good.md'),
      block('title: Good\nkind: lesson\n---\nReadable body.'),
      'utf8'
    );
    // This one WOULD yield a second memory if it could be read. It must not:
    // the fix adds a channel, not a read.
    writeFileSync(
      join(handoff(), 'bad.md'),
      block('title: Bad\nkind: rule\n---\nNever read.'),
      'utf8'
    );
    __fsMocks.throwFor = null;
  });

  afterEach(() => {
    __fsMocks.throwFor = null;
    rmSync(root, { recursive: true, force: true });
  });

  it('names the unreadable file, with the thrown message, through the warnings channel', () => {
    __fsMocks.throwFor = /bad\.md$/;
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: false });

    expect(result.scanFailures, 'the swallow must now say what it swallowed').toHaveLength(1);
    expect(result.scanFailures[0]!.file).toBe(`.peaks/_runtime/${sessionId}/txt/bad.md`);
    expect(result.scanFailures[0]!.detail).toBe(__fsMocks.message);

    const warnings = describeSessionScanFailures(result.scanFailures);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(`.peaks/_runtime/${sessionId}/txt/bad.md`);
    expect(warnings[0]).toContain(__fsMocks.message);
  });

  it('behaviour is otherwise unchanged: the unreadable file still contributes nothing', () => {
    // PRE-CHANGE literals for this fixture: one readable block, one unreadable.
    // The swallow was fail-open by design; it still is.
    __fsMocks.throwFor = /bad\.md$/;
    const withFailure = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(withFailure.scannedFiles, 'both files are still LISTED').toBe(2);
    expect(withFailure.extractedCount, 'only the readable one is extracted').toBe(1);
    expect(withFailure.writtenFiles).toEqual([]);
    expect(withFailure.updatedIndex).toBe(false);
    expect(withFailure.droppedBlocks, 'an unread file is not a dropped block').toEqual([]);

    // Readable control: both artifacts now yield a memory. The delta between
    // these two runs is exactly the point of the fix — the swallow is fail-open
    // and still lossy, so the WARNING is the only thing that tells the caller a
    // readable memory was never seen. Before this change the two runs were
    // indistinguishable from the envelope.
    __fsMocks.throwFor = null;
    const withoutFailure = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(withoutFailure.scannedFiles).toBe(2);
    expect(withoutFailure.extractedCount).toBe(2);
    expect(withoutFailure.scanFailures).toEqual([]);
    expect(describeSessionScanFailures(withoutFailure.scanFailures)).toEqual([]);
  });

  it('ANTI-NOISE: a fully readable session reports no scan failure', () => {
    __fsMocks.throwFor = null;
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(result.scanFailures).toEqual([]);
    expect(result.droppedBlocks).toEqual([]);
  });

  it('does not abort the scan when one artifact is unreadable (control flow kept)', () => {
    // Order matters: `bad.md` sorts before `good.md`, so a rethrow would lose
    // the good memory entirely.
    __fsMocks.throwFor = /bad\.md$/;
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: true });
    expect(result.extractedCount).toBe(1);
    expect(result.writtenFiles).toHaveLength(1);
    expect(result.writtenFiles[0]!.replaceAll('\\', '/').endsWith('/good.md')).toBe(true);
    expect(result.scanFailures).toHaveLength(1);
  });

  it('names every unreadable artifact, not just the first', () => {
    writeFileSync(
      join(handoff(), 'worse.md'),
      block('title: Worse\nkind: rule\n---\nNever read.'),
      'utf8'
    );
    __fsMocks.throwFor = /(bad|worse)\.md$/;
    const result = extractSessionMemories({ projectRoot: root, sessionId, apply: false });
    expect(result.scanFailures.map((failure) => failure.file)).toEqual([
      `.peaks/_runtime/${sessionId}/txt/bad.md`,
      `.peaks/_runtime/${sessionId}/txt/worse.md`
    ]);
    expect(describeSessionScanFailures(result.scanFailures)).toHaveLength(2);
  });

  it('the G2 marker is resolved on this site, not carried forward', () => {
    // The marker suppresses `scripts/lint/silent-warning-detector.mjs`. With the
    // catch now pushing to a channel, the suppression is obsolete; leaving it
    // would hide a future regression. Static read through the same mocked
    // module (pass-through at this point), plus a positive anchor so a rename
    // cannot make the negative assertion pass vacuously.
    __fsMocks.throwFor = null;
    const source = readFileSync(
      join(
        process.cwd(),
        'src',
        'services',
        'memory',
        'project-memory-service',
        'index',
        'kind-dispatch.ts'
      ),
      'utf8'
    );
    expect(source, 'anti-vacuity: the file must actually have been read').toContain(
      'export function extractSessionMemories'
    );
    expect(source, 'the catch must report rather than swallow').toContain('scanFailures.push(');
    expect(source, 'the resolved TODO(g2) marker must be gone from this file').not.toContain(
      'TODO(g2)'
    );
  });
});
