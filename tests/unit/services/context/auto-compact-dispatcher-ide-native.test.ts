/**
 * Task 1.7 — replaces the pre-1.7 `dispatchIdeCompact — ide-native
 * pathway` suite.
 *
 * Design §13.1 / §13.2 retired the `ide-native` pathway (which
 * wrote a hard-coded `claude --compact` hook into
 * `.claude/settings.local.json`) and every other pathway that
 * claimed a host-CLI spawn or hook-install was compact completion.
 * `dispatchIdeCompact` is now a thin forwarder that returns
 * `ok: false, pathway: 'noop'` and points the caller at the
 * capability-first control plane. The pre-1.7
 * `auto-compact-hook-install.ts` service is deleted.
 *
 * The companion static-scan in
 * `tests/unit/skills/compact-command-references.test.ts` enforces
 * "no spawn / no install" across the runtime surface.
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchIdeCompact } from '../../../../src/services/context/auto-compact-dispatcher.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-ide-native-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const CLAUDE_CODE_ENV = { CLAUDE_CODE_ENTRYPOINT: 'cli' } as NodeJS.ProcessEnv;

describe('Task 1.7 — dispatchIdeCompact ide-native pathway retired', () => {
  it('target=main + claude-code returns ok=false pathway=noop (no hook install)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(result.ok).toBe(false);
    expect(result.pathway).toBe('noop');
    expect(result.ide).toBe('claude-code');
    // The legacy path WROTE `.claude/settings.local.json` here; the
    // retired path MUST NOT.
    expect(existsSync(join(projectRoot, '.claude', 'settings.local.json'))).toBe(false);
  });

  it('target=sub-agent + claude-code returns ok=false pathway=noop (no shell spawn)', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'sub-agent'
    });
    expect(result.pathway).toBe('noop');
    expect(result.ok).toBe(false);
  });

  it('returns the capability-first next-action in the envelope message', async () => {
    const result = await dispatchIdeCompact({
      projectRoot,
      sessionId: 'sess-1',
      env: CLAUDE_CODE_ENV,
      target: 'main'
    });
    expect(result.message).toContain('peaks compact auto');
  });
});
