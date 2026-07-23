/**
 * Task 1.7 — rewritten to pin the post-1.7 honest-blocked contract.
 *
 * Pre-Task-1.7 this suite asserted the legacy `dispatchIdeCompact`
 * pathways: `ide-native` for main, `shell-exec` for sub-agent, and a
 * `auto-compact-pending.json` intent record under
 * `.peaks/_runtime/<sessionId>/txt/`. Design §13.1 / §13.2 retired
 * every shape that claimed a host-CLI spawn or hook-install was
 * compact completion. The dispatcher is now a thin forwarder that
 * always returns `ok: false, pathway: 'noop'`, and the orchestrator
 * no longer writes the intent record. The next step in every
 * envelope is the capability-first control plane.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchIdeCompact } from '../../../src/services/context/auto-compact-dispatcher.js';
import { runAutoCompact } from '../../../src/services/code/auto-compact-orchestrator.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-auto-compact-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const CLAUDE_CODE_ENV = { CLAUDE_CODE_ENTRYPOINT: 'cli' } as NodeJS.ProcessEnv;

describe('Task 1.7 — dispatchIdeCompact honest-blocked stub', () => {
  it('main + claude-code returns ok=false pathway=noop (legacy ide-native retired)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(result.ok).toBe(false);
    expect(result.pathway).toBe('noop');
    expect(result.ide).toBe('claude-code');
    expect(result.message).toContain('Task 1.7');
  });

  it('sub-agent + claude-code returns ok=false pathway=noop (legacy shell-exec retired)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'sub-agent'
    });
    expect(result.ok).toBe(false);
    expect(result.pathway).toBe('noop');
  });

  it('main + trae returns ok=false pathway=noop (non-claude code never had a path)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: { TRAE_CLI: '1' } as NodeJS.ProcessEnv,
      target: 'main'
    });
    expect(result.ok).toBe(false);
    expect(result.pathway).toBe('noop');
  });

  it('defaults to main when target is omitted', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV
    });
    expect(result.pathway).toBe('noop');
    expect(result.ok).toBe(false);
  });

  it('unknown env never feeds an executable path (id=unknown, ok=false)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: {} as NodeJS.ProcessEnv,
      target: 'main'
    });
    expect(result.ok).toBe(false);
    expect(result.ide).toBe('unknown');
    expect(result.pathway).toBe('noop');
  });
});

describe('Task 1.7 — runAutoCompact no longer writes a legacy intent record', () => {
  it('does NOT write auto-compact-pending.json when ratio triggers pre-compact', async () => {
    const sid = 'main-session-test';
    await runAutoCompact({
      projectRoot,
      sessionId: sid,
      env: { ...CLAUDE_CODE_ENV, CLAUDE_CONTEXT_USAGE_PERCENT: '0.90' },
      target: 'main',
      now: new Date('2026-06-28T00:00:00Z')
    });
    const pendingPath = join(projectRoot, '.peaks', '_runtime', sid, 'txt', 'auto-compact-pending.json');
    // The intent record pointed the next LLM turn at a never-existing
    // command (forbidden by Task 1.7, design §13.2).
    expect(rmSyncIfExists(pendingPath)).toBe(false);
  });

  it('returns ok=false with the control-plane next-action when ratio triggers', async () => {
    const sid = 'main-session-next-action';
    const result = await runAutoCompact({
      projectRoot,
      sessionId: sid,
      env: { ...CLAUDE_CODE_ENV, CLAUDE_CONTEXT_USAGE_PERCENT: '0.90' },
      target: 'main',
      now: new Date('2026-06-28T00:00:00Z')
    });
    expect(result.ok).toBe(false);
    const envelope = result as { code?: string; data?: { dispatch?: { pathway: string } } };
    expect(envelope.code).toBe('AUTO_COMPACT_DISPATCH_FAILED');
    expect(envelope.data?.dispatch?.pathway).toBe('noop');
  });
});

function rmSyncIfExists(path: string): boolean {
  try {
    rmSync(path);
    return true;
  } catch {
    return false;
  }
}
