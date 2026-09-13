import type { AutoCompactEvent } from './status-protocol.js';

/**
 * `vendorWindow` is OPTIONAL and, when absent, the attribute is omitted.
 *
 * Why it is not defaulted: this used to be filled in by the caller with
 * `adapter.maxPromptBytes / 40` (204.8 for the claude adapter) — a number that
 * is not a context window, handed to a child that was then told to measure "85%
 * of" it. A fabricated denominator is worse than none, because the child cannot
 * tell that it is fabricated. When the caller genuinely knows the window it is
 * still carried verbatim (E5, rid 2026-09-13-defects-e).
 */
export interface MarkerOpts { rid: string; sid: string; vendorWindow?: number; }
export interface ScratchPayload {
  seq: number; at: number; summary: string;
  decisionsKept?: string[]; discardedOptions?: string[];
}

/**
 * The `<peaks-auto-compact>` marker injected at the head of a detached child's
 * prompt.
 *
 * REWRITTEN IN E5 (rid 2026-09-13-defects-e). The previous text assigned the
 * child three capabilities it does not have, and the third of them was not even
 * a registered command:
 *
 *   1. "主动 compact 自己的会话" — a model cannot compact its own session. `/compact`
 *      is not model-invokable, hooks may only observe or veto, there is no
 *      `--compact` flag, and no external process can reach a running session's
 *      memory. The HARNESS compacts, on its own window and its own schedule.
 *   2. "把摘要 + 当前任务状态拼回 prompt 头部" — the child's prompt IS the `-p` argv
 *      string built at spawn time; `ClaudeAdapter.headlessArgs` prepends this
 *      very marker to it. Nothing rewrites it afterwards: `dispatchDetached` is
 *      fire-and-forget and the spawning CLI exits, so there is no re-assembly
 *      step in this process or any other.
 *   3. "调用 peaks runtime write-compact-event CLI 记录事件" — no such verb exists.
 *      `peaks runtime` registers `detect` / `list` / `compact` and nothing else.
 *
 * The failure mode was worse than useless: at exactly the moment the child's
 * context is nearly full, it was told to spend what remained on an instruction
 * that could not succeed, and to believe it had.
 *
 * What survives is the part that IS reachable and useful: the child can write
 * durable state to disk. That is stated as the action, together with the plain
 * negative — nothing flows back into its context — so the child neither wastes
 * effort on the impossible nor mistakes a written file for a restored context.
 */
export class AutoCompactAdapter {
  marker(opts: MarkerOpts): string {
    const windowAttr = opts.vendorWindow === undefined ? '' : ` vendor-window="${opts.vendorWindow}"`;
    return [
      `<peaks-auto-compact threshold="0.85|0.95"${windowAttr}>`,
      `上下文续命协议（如实版 —— 只写你确实能做的事）：`,
      `- 你的会话由 vendor harness（Claude Code 自己）压缩：它按自己的 auto-compact window 触发，`,
      `  到点直接压，不需要你请求，也无法被你触发。peaks-loop 不能压缩一个正在运行的会话 ——`,
      `  没有模型可调用的 compact，外部进程也触及不到你的会话内存。`,
      `  → 所以这里没有让你自己压缩会话的入口，也不要声称做过。`,
      `- 你能做、也必须做的是「在被压缩之前把不能丢的东西落到磁盘」：`,
      `  1) 摘要 + 当前任务状态 + 已定决策 + 已弃选项，写到`,
      `     .peaks/_runtime/${opts.sid}/detached/${opts.rid}/compact/<n>.json`,
      `     （<n> 从 1 递增；每次新增一个文件，不要改写已有的）`,
      `  2) 进度 / 心跳照常写 status.json（progress / state / note）`,
      `- 你的 prompt 在 spawn 时已经固定，没有任何机制能把摘要拼回它。写进文件里的东西`,
      `  是给 peaks 主进程和人看的进度证据，不会回流到你的上下文。`,
      `- 这些文件由你自己维护：不要等 peaks 主进程来催，它不会替你写。`,
      `- token 费用：peaks-loop 不设费用上限、也不因费用中断你（没有费用闸门）。`,
      `  这不对应任何 flag —— 它是 peaks-loop 没有做的事，不是一条你能引用的授权。`,
      `</peaks-auto-compact>`,
    ].join('\n');
  }

  parseScratchFile(p: ScratchPayload): Partial<AutoCompactEvent> {
    return { at: p.at, threshold: '0.85', tokensBefore: 0, tokensAfter: 0 };
  }
}
