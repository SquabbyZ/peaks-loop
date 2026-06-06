/**
 * peaks 自有 hook 协议 + slim IDE adapter 接口。
 *
 * peaks-cli 不再适配 IDE 私有的 hook 协议;反之 peaks 定义自己的 canonical
 * schema,每个 IDE 只需要填 4 字符串 + 1 settings 函数,新 IDE 适配变成"填表"。
 *
 * 不可消除的 per-IDE 字段(诚实交代,见 PRD R-1..R-4):
 *   - settings.json 物理位置
 *   - 项目根 env 变量名
 *   - hook 事件名 + matcher 名
 *
 * 其他全部归一化到 peaks 内部模型(见 hook-protocol.ts)。
 */
import type { SubAgentDispatcher } from '../dispatch/sub-agent-dispatcher.js';

export type IdeId =
  | 'claude-code'
  | 'trae'
  | 'codex'
  | 'cursor'
  | 'qoder'
  | 'tongyi-lingma';

export interface IdeCapabilities {
  /** peaks gate enforce 是否适用该 IDE(必备) */
  readonly gateEnforce: true;
  /** peaks progress start(sub-agent 派发)是否适用 */
  readonly progressStart: boolean;
  /** peaks statusline 状态栏是否适用 */
  readonly statusline: boolean;
  /** peaks mcp install 是否适用 */
  readonly mcpInstall: boolean;
}

export interface IdeSettingsLocation {
  /** 项目根下的 settings 目录名,例如 '.claude' / '.trae' / '.cursor' */
  readonly dirName: string;
  /** settings 文件名(部分 IDE 叫 settings.json / mcp.json) */
  readonly settingsFileName: string;
  /** 解析出 settings.json 绝对路径 */
  resolveSettingsFile(scope: 'project' | 'global', projectRoot: string | undefined): string;
  /** 该 IDE 是否支持此 scope(用于清晰报错) */
  supportsScope(scope: 'project' | 'global'): boolean;
}

/**
 * Slim IDE adapter 描述。每 IDE 一个静态常量(无需 DI)。
 * 字段故意保持少:让 adapter 的添加是"填表"而非"重写"。
 */
export interface IdeAdapter {
  readonly id: IdeId;
  /** 人类可读名,出现在 CLI help / 命令输出 */
  readonly displayName: string;
  readonly settings: IdeSettingsLocation;
  /** IDE 注入的项目根 env 变量名;`peaks gate enforce` 等命令模板会引用此 env */
  readonly envVar: string;
  /** settings.json 里 hook 数组的 key,例如 'PreToolUse' / 'beforeToolCall' */
  readonly hookEvent: string;
  /** hook 数组元素的 matcher 字段(工具名匹配),例如 'Bash' / 'Task' / 'terminal' */
  readonly toolMatcher: string;
  /**
   * The tool name used by this IDE to invoke a sub-agent (e.g. Claude Code
   * uses 'Task' to dispatch a sub-agent, Trae may use a different name).
   * Consumed by the `peaks progress start` hook entry so each IDE self-
   * reports its sub-agent tool name. Additive on `toolMatcher`: the
   * `toolMatcher` field still drives the gate-enforce hook entry, this
   * one drives the sub-agent-progress hook entry.
   *
   * Added in slice 2026-06-06-sub-agent-spawn-bug-and-decouple.
   */
  readonly subAgentToolMatcher: string;
  /**
   * Per-IDE sub-agent dispatcher. The `peaks sub-agent dispatch` CLI reads
   * this field, calls `supportsRole` + `buildToolCall`, and returns the
   * resulting tool-call descriptor in the JSON envelope. Additive on
   * `subAgentToolMatcher`: the matcher still drives the gate-enforce hook
   * entry; this field drives the runtime sub-agent dispatch surface.
   *
   * Added in slice 2026-06-07-sub-agent-dispatch-decouple. See PRD #002
   * G1 (AC-1, AC-2) + [[slim-ideadapter-shape-is-the-contract]].
   */
  readonly subAgentDispatcher: SubAgentDispatcher;
  /** install / uninstall 后展示给用户的提示文本(各 IDE 不同,例如 Claude 提示重启窗口) */
  readonly installHints: readonly string[];
  /** 该 IDE 在 peaks 上可启用的能力(用于在不支持的 IDE 上软警告) */
  readonly capabilities: IdeCapabilities;
}

/** peaks canonical hook schema 版本标识 */
export const PEAKS_HOOK_SCHEMA = 'peaks-hook/v1' as const;

/** peaks canonical hook 形态 —— 单一协议,所有 IDE 经 hook-translator 归一化到此 */
export interface PeaksCanonicalHook {
  readonly schema: typeof PEAKS_HOOK_SCHEMA;
  readonly event: 'pre-tool-use' | 'post-tool-use' | 'sub-agent-start';
  readonly toolName: string;
  readonly toolInput: Record<string, unknown>;
  /** 解析自 env 变量或 --project 的项目根 */
  readonly projectRoot: string;
  /** 选输出格式 */
  readonly rawIdeFormat: IdeId;
  /** 原始 stdin,留作回退 */
  readonly rawPayload: unknown;
}

/** peaks 决策发回形态枚举(按 IDE 期望的"发回"形式) */
export type PeaksDecisionTransport =
  | { kind: 'stdout-json'; denyShape: Record<string, unknown> }
  | { kind: 'exit-code'; denyCode: number }
  | { kind: 'both'; denyShape: Record<string, unknown>; denyCode: number };
