import { describe, it, expect } from 'vitest';
import { AutoCompactAdapter } from '../../../packages/peaks-loop-internal-runtime/src/auto-compact-adapter.js';

describe('AutoCompactAdapter (G8)', () => {
  it('emits peaks-auto-compact marker with thresholds 0.85 and 0.95', () => {
    const a = new AutoCompactAdapter();
    const m = a.marker({ rid: 'r1', sid: 's1', vendorWindow: 200000 });
    expect(m).toContain('<peaks-auto-compact');
    expect(m).toContain('threshold="0.85|0.95"');
    expect(m).toContain('vendor-window="200000"');
    expect(m).toContain('不要等 peaks 主进程来催');
  });

  it('parses scratch file payload', () => {
    const a = new AutoCompactAdapter();
    const ev = a.parseScratchFile({
      seq: 1,
      at: 100,
      summary: 'done X',
      decisionsKept: ['UUID v7'],
      discardedOptions: ['JWT']
    });
    expect(ev).toMatchObject({ at: 100, tokensBefore: 0 });
  });
});

// E5 (rid 2026-09-13-defects-e). The marker used to assign the child LLM three
// things it cannot do:
//
//   1. "主动 compact 自己的会话" — no model can compact its own session. `/compact`
//      is not model-invokable, hooks can only observe or veto, there is no
//      `--compact` flag, and no external process can reach a running session's
//      memory. The harness compacts, on its own trigger.
//   2. "把摘要 + 当前任务状态拼回 prompt 头部" — the child's prompt is the `-p` argv
//      string built at spawn (`ClaudeAdapter.headlessArgs` prepends this very
//      marker to it). Nothing re-writes it: `dispatchDetached` is fire-and-forget
//      and the spawning CLI exits. There is no re-assembly step to return a
//      summary to, in this process or any other.
//   3. "调用 peaks runtime write-compact-event CLI 记录事件" — that verb does not
//      exist. `peaks runtime` registers `detect` / `list` / `compact` only.
//
// So the child was told to burn its remaining context on an instruction that
// could not succeed, at exactly the moment the instruction claims to matter.
// The marker now states what the child CAN do (persist durable state to disk)
// and says plainly that nothing flows back into its context.
describe('AutoCompactAdapter — E5: the marker promises only what is reachable', () => {
  const a = new AutoCompactAdapter();

  it('states that the harness compacts the session, and that the child cannot', () => {
    const m = a.marker({ rid: 'r1', sid: 's1' });
    // the truthful mechanism, named
    expect(m).toContain('harness');
    // and the honest negative — without it the child is left guessing
    expect(m).toContain('无法被你触发');
    expect(m).toContain('peaks-loop 不能压缩一个正在运行的会话');
  });

  it('keeps the instructions that ARE reachable (durable state on disk)', () => {
    const m = a.marker({ rid: 'r1', sid: 's1' });
    // the scratch path and the status file are both real, both written by the
    // child, and both readable afterwards — that is the part worth keeping
    expect(m).toContain('.peaks/_runtime/s1/detached/r1/compact/<n>.json');
    expect(m).toContain('status.json');
    expect(m).toContain('不要等 peaks 主进程来催');
  });

  it('promises NOTHING that cannot happen', () => {
    const m = a.marker({ rid: 'r1', sid: 's1' });
    // (1) no self-compaction — the instruction is gone, and what replaced it is
    //     an explicit "there is no entry point for this"
    expect(m).not.toContain('主动 compact 自己的会话');
    expect(m).toContain('没有让你自己压缩会话的入口');
    // (2) no splicing back into the prompt
    expect(m).not.toContain('拼回 prompt 头部');
    // (3) no write-compact-event verb — it is not a registered command
    expect(m).not.toContain('write-compact-event');
    // and no claim that the files flow back into the child's context
    expect(m).toContain('不会回流到你的上下文');
  });

  it('when no vendor window is known, omits the attribute instead of inventing one', () => {
    // `dispatchDetached` used to pass `adapter.maxPromptBytes / 40` — 204.8 for
    // the claude adapter, a number that is not a context window and that the
    // child was then asked to measure "85% of". A fabricated denominator is
    // worse than none: the child cannot tell it is fabricated.
    const noWindow = a.marker({ rid: 'r1', sid: 's1' });
    expect(noWindow).not.toContain('vendor-window=');
    // and: when the caller DOES know the window, it is still carried
    expect(a.marker({ rid: 'r1', sid: 's1', vendorWindow: 200000 })).toContain(
      'vendor-window="200000"'
    );
  });

  it('says the cost claim as what it is — an absence of throttling, not a grant', () => {
    // "不限费用（用户授权）" reads as a permission the child may invoke. There is
    // no such artifact: no flag, no config key, no gate. What IS true is that
    // peaks-loop has no token-cost throttle to relax (the only guard,
    // ResourceBudgetGuard, throttles RSS/CPU/fan-out and never cost). The text
    // now says that instead, and says it does not correspond to a flag.
    const m = a.marker({ rid: 'r1', sid: 's1' });
    expect(m).toContain('不设费用上限');
    expect(m).toContain('不对应任何 flag');
  });
});
