/**
 * `peaks sub-agent dispatch --session-id` fallback chain — slice
 * 2026-06-26-unknown-sid-fallback-fix.
 *
 * Five CLI entry points (`dispatch`, `dispatch --from-dag`, `share`,
 * `shared-read`, `await`) all have a `--session-id` flag with the same
 * fallback chain:
 *
 *   1. explicit `--session-id` flag (highest priority)
 *   2. `PEAKS_SESSION_ID` env var
 *   3. `.peaks/_runtime/session.json` (legacy: `.peaks/.session.json`)
 *   4. literal `'unknown-sid'` (last resort)
 *
 * Before this slice the chain collapsed to (1) and (4) only — the
 * `.peaks/_runtime/session.json` resolve was advertised in `--help`
 * text but never actually wired up. The result: LLM drivers that
 * trusted the help text and omitted `--session-id` always landed
 * their dispatch records under `.peaks/_sub_agents/unknown-sid/`,
 * leaving 3287+ orphan files (slice 2026-06-26 investigation).
 *
 * Tests pin the new chain via the warm-path `dispatch` command. The
 * verification surface is the dispatch record's path: it must land
 * under `.peaks/_sub_agents/<resolved-sid>/`, not under
 * `.peaks/_sub_agents/unknown-sid/`. The other four entry points
 * share the same inline `options.sessionId ??
 * process.env.PEAKS_SESSION_ID ?? getCurrentSessionId(projectRoot) ??
 * 'unknown-sid'` pattern, so a single happy-path + a single
 * fallback-path test on the most heavily-used entry point proves
 * the wiring. The other four are already covered for the rest of
 * their CLI plumbing by `share-commands.test.ts` /
 * `contract-commands.test.ts`.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCommand, parseJsonOutput } from '../../cli-program-test-utils.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-sid-fallback-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

/**
 * Write `.peaks/_runtime/session.json` with the given sessionId so
 * the auto-resolve branch can find it. Always recreates the parent
 * dirs so the file is visible at the time the CLI action handler
 * resolves the binding.
 */
function writeSessionBinding(sid: string, projectRoot: string): void {
  const peaksDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, 'session.json'),
    JSON.stringify({ sessionId: sid, setAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

/**
 * Write the legacy `.peaks/.session.json` path. Used to verify the
 * one-minor-release read-side back-compat.
 */
function writeLegacySessionBinding(sid: string, projectRoot: string): void {
  const peaksDir = join(projectRoot, '.peaks');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, '.session.json'),
    JSON.stringify({ sessionId: sid }, null, 2),
    'utf8'
  );
}

/**
 * The dispatch envelope exposes the resolved sid only via the
 * `dispatchRecordPath` (path shape: `.peaks/_sub_agents/<sid>/...`).
 * Extract the resolved sid from that path so the test asserts on
 * the right side of the chain.
 */
function sidFromDispatchPath(dispatchPath: string | undefined): string {
  if (typeof dispatchPath !== 'string') {
    throw new Error(`dispatchRecordPath missing from envelope; got ${typeof dispatchPath}`);
  }
  const match = dispatchPath.match(/\.peaks[\\/](?:_)?sub_agents[\\/]([^\\/]+)[\\/]/);
  if (match === null || typeof match[1] !== 'string') {
    throw new Error(`Cannot extract sid from path: ${dispatchPath}`);
  }
  return match[1];
}

/** Typed shape of the dispatch envelope's data sub-object. */
type DispatchEnvelopeData = {
  dispatchRecordPath: string;
  role: string;
  batchId: string;
};

describe('dispatch --session-id fallback chain', () => {
  it('honors explicit --session-id over all fallbacks', async () => {
    writeSessionBinding('2026-06-26-session-fallback-test', root);
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--session-id', 'explicit-sid',
        '--request-id', 'rid-x',
        '--batch-id', 'batch-x',
        '--prompt', 'p',
        '--json'
      ],
      { PEAKS_SESSION_ID: 'env-sid-should-not-win' }
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe('explicit-sid');
  });

  it('falls back to PEAKS_SESSION_ID env var when --session-id absent', async () => {
    writeSessionBinding('2026-06-26-session-fallback-test', root);
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--request-id', 'rid-y',
        '--batch-id', 'batch-y',
        '--prompt', 'p',
        '--json'
      ],
      { PEAKS_SESSION_ID: 'env-sid-wins' }
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe('env-sid-wins');
  });

  it('resolves sid from .peaks/_runtime/session.json when neither flag nor env is set', async () => {
    const boundSid = '2026-06-26-session-frombinding';
    writeSessionBinding(boundSid, root);
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--request-id', 'rid-z',
        '--batch-id', 'batch-z',
        '--prompt', 'p',
        '--json'
      ]
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe(boundSid);
    // The dispatch record must live under the resolved sid, NOT
    // under .peaks/_sub_agents/unknown-sid/.
    const expectedDir = join(root, '.peaks', '_sub_agents', boundSid);
    expect(existsSync(expectedDir)).toBe(true);
    const unknownDir = join(root, '.peaks', '_sub_agents', 'unknown-sid');
    expect(existsSync(unknownDir)).toBe(false);
  });

  it('falls back to literal "unknown-sid" only when nothing else resolves', async () => {
    // No session.json written, no env var, no flag → literal fallback.
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--request-id', 'rid-w',
        '--batch-id', 'batch-w',
        '--prompt', 'p',
        '--json'
      ]
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe('unknown-sid');
  });

  it('reads the legacy .peaks/.session.json path when canonical is absent', async () => {
    const boundSid = '2026-06-26-session-legacybinding';
    writeLegacySessionBinding(boundSid, root);
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--request-id', 'rid-legacy',
        '--batch-id', 'batch-legacy',
        '--prompt', 'p',
        '--json'
      ]
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe(boundSid);
  });
});

describe('dispatch record contents match the resolved sid', () => {
  it('writes sessionId/rid into the on-disk record under the resolved sid dir', async () => {
    const boundSid = '2026-06-26-session-pathtest';
    writeSessionBinding(boundSid, root);
    const { stdout } = await runCommand(
      [
        'sub-agent', 'dispatch', 'rd',
        '--project', root,
        '--request-id', 'rid-path',
        '--batch-id', 'batch-path',
        '--prompt', 'p',
        '--json'
      ]
    );
    const parsed = parseJsonOutput<DispatchEnvelopeData>(stdout);
    expect(parsed.ok).toBe(true);
    expect(sidFromDispatchPath(parsed.data.dispatchRecordPath)).toBe(boundSid);
    // Confirm the on-disk record carries the same sessionId.
    const onDisk = readFileSync(parsed.data.dispatchRecordPath, 'utf8');
    const record = JSON.parse(onDisk) as { sessionId: string; requestId: string };
    expect(record.sessionId).toBe(boundSid);
    expect(record.requestId).toBe('rid-path');
  });
});
