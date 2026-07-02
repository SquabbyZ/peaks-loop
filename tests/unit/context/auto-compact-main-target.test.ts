/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #4) +
 * slice 2026-07-02-auto-compact-zero-pause.
 *
 * Pins the contract that `dispatchIdeCompact` honours the `target`
 * parameter:
 *   - target='main' + claude-code → ide-native pathway (PreToolUse
 *     hook install at `.claude/settings.local.json`; next Bash/Task
 *     tool call from the runner fires `claude --compact` in-band).
 *   - target='main' + non-claude-code → noop + warning.
 *   - target='sub-agent' + claude-code → shell-spawn legacy.
 *
 * Also pins the orchestrator contract that when target='main', an
 * intent record is written under
 * `.peaks/_runtime/<sessionId>/txt/auto-compact-pending.json` so the
 * next main-session LLM turn reads the convergence plan.
 *
 * History: pre-2026-07-02 the main + claude-code pathway was
 * `llm-self-compress` (a soft hint to the LLM to fire `/compact`
 * on its next turn). The slice 2026-07-02 fix replaces that with
 * the `ide-native` pathway so the runner compacts ITSELF instead
 * of relying on the LLM to remember the hint.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dispatchIdeCompact } from '../../../src/services/context/auto-compact-dispatcher.js';
import { runAutoCompact } from '../../../src/services/solo/auto-compact-orchestrator.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-auto-compact-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const CLAUDE_CODE_ENV = { CLAUDE_CODE_ENTRYPOINT: 'cli' } as NodeJS.ProcessEnv;

describe('auto-compact target — slice 2026-06-28-solo-mode-bypass-fix', () => {
  describe('dispatchIdeCompact', () => {
    it('main + claude-code returns ide-native pathway', async () => {
      const result = await dispatchIdeCompact({
        projectRoot,
        sessionId: 'sess-1',
        env: CLAUDE_CODE_ENV,
        target: 'main'
      });
      expect(result.ok).toBe(true);
      expect(result.pathway).toBe('ide-native');
      expect(result.ide).toBe('claude-code');
    });

    it('sub-agent + claude-code keeps shell-exec pathway', async () => {
      const result = await dispatchIdeCompact({
        projectRoot,
        sessionId: 'sess-1',
        env: CLAUDE_CODE_ENV,
        target: 'sub-agent'
      });
      expect(result.pathway).toBe('shell-exec');
    });

    it('main + trae is noop with reason', async () => {
      const result = await dispatchIdeCompact({
        projectRoot,
        sessionId: 'sess-1',
        env: { TRAE_CLI: '1' } as NodeJS.ProcessEnv,
        target: 'main'
      });
      expect(result.ok).toBe(false);
      expect(result.pathway).toBe('noop');
      expect(result.message).toContain('main-session target unsupported');
    });

    it('defaults to main when target is omitted', async () => {
      const result = await dispatchIdeCompact({
        projectRoot,
        sessionId: 'sess-1',
        env: CLAUDE_CODE_ENV
      });
      expect(result.pathway).toBe('ide-native');
    });
  });

  describe('runAutoCompact writes intent record for main target', () => {
    it('writes .peaks/_runtime/<sid>/txt/auto-compact-pending.json when ratio triggers', async () => {
      const sid = 'main-session-test';
      const result = await runAutoCompact({
        projectRoot,
        sessionId: sid,
        env: { ...CLAUDE_CODE_ENV, CLAUDE_CONTEXT_USAGE_PERCENT: '0.90' },
        target: 'main',
        now: new Date('2026-06-28T00:00:00Z')
      });
      expect(result.ok).toBe(true);
      const pendingPath = join(projectRoot, '.peaks', '_runtime', sid, 'txt', 'auto-compact-pending.json');
      expect(existsSync(pendingPath)).toBe(true);
      const payload = JSON.parse(readFileSync(pendingPath, 'utf8'));
      expect(payload.target).toBe('main');
      expect(payload.pending).toBe(true);
      expect(payload.ratio).toBeCloseTo(0.9, 2);
    });

    it('does NOT write intent record when target=sub-agent', async () => {
      const sid = 'sub-session-test';
      await runAutoCompact({
        projectRoot,
        sessionId: sid,
        env: { ...CLAUDE_CODE_ENV, CLAUDE_CONTEXT_USAGE_PERCENT: '0.90' },
        target: 'sub-agent',
        now: new Date('2026-06-28T00:00:00Z')
      });
      const pendingPath = join(projectRoot, '.peaks', '_runtime', sid, 'txt', 'auto-compact-pending.json');
      expect(existsSync(pendingPath)).toBe(false);
    });
  });
});