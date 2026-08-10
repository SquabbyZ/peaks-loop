import type { AutoCompactEvent } from './status-protocol.js';

export interface MarkerOpts { rid: string; sid: string; vendorWindow: number; }
export interface ScratchPayload {
  seq: number; at: number; summary: string;
  decisionsKept?: string[]; discardedOptions?: string[];
}

export class AutoCompactAdapter {
  marker(opts: MarkerOpts): string {
    return [
      `<peaks-auto-compact threshold="0.85|0.95" vendor-window="${opts.vendorWindow}">`,
      `协议：`,
      `- 你（子进程 LLM）估算自己已用上下文 ≥ 85% vendor window`,
      `  → 主动 compact 自己的会话：把对话历史摘要写到`,
      `    .peaks/_runtime/${opts.sid}/detached/${opts.rid}/compact/<n>.json`,
      `  → 把摘要 + 当前任务状态拼回 prompt 头部`,
      `  → 调用 peaks runtime write-compact-event CLI 记录事件`,
      `- 当 ≥ 95% → 同步 compact + 立刻通知 peaks 主进程`,
      `  （写 status.json note: 'compact-emergency'）`,
      `- 不要等 peaks 主进程来催；子进程 LLM 自己监控自己的 context`,
      `- 不限费用（用户授权）—— compact 本身消耗的 token 随它去`,
      `</peaks-auto-compact>`,
    ].join('\n');
  }

  parseScratchFile(p: ScratchPayload): Partial<AutoCompactEvent> {
    return { at: p.at, threshold: '0.85', tokensBefore: 0, tokensAfter: 0 };
  }
}