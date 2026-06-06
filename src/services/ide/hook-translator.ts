import type { IdeId } from './ide-types.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAdapter } from './ide-registry.js';

/**
 * hook-translator —— peaks 自有 hook 协议的核心。
 *
 * 单一职责:把 IDE 私有 stdin 形态归一化到 peaks canonical schema;把 peaks 决策
 * 格式化回 IDE 期望的 stdout/exit-code 形态。
 *
 * auto-detection 算法(优先级从高到低):
 *   1. env 变量:CLAUDE_PROJECT_DIR / TRAE_PROJECT_DIR / CODEX_PROJECT_DIR / ...
 *   2. stdin shape:`{ tool_name, tool_input }` 是 Claude / Trae;
 *                `{ toolName, toolInput }` 是 Cursor;
 *                `{ eventName, parameters }` 是 Trae 另形态
 *   3. cwd 启发式:存在 .claude / .trae / .codex / .cursor 目录
 *   4. fallback:`claude-code`(backward compat,见 PRD preserved behavior #10)
 */

export interface DetectFromStdinInput {
  readonly env: NodeJS.ProcessEnv;
  readonly cwd: string;
  /** 已解析的 stdin 形态;null = 空 stdin 或非 JSON */
  readonly parsedStdin: unknown;
}

/**
 * Detect the originating IDE from env / stdin shape / cwd heuristics.
 * Falls back to 'claude-code' (PRD preserved behavior: backward compat).
 */
export function detectIdeFromContext(input: DetectFromStdinInput): IdeId {
  // 1. env 变量优先级最高
  for (const adapter of ['claude-code', 'trae', 'codex', 'cursor', 'qoder', 'tongyi-lingma'] as const) {
    const a = getAdapter(adapter);
    if (input.env[a.envVar] !== undefined) {
      return adapter;
    }
  }
  // 2. stdin shape
  if (isObject(input.parsedStdin)) {
    if ('tool_name' in input.parsedStdin || 'tool_input' in input.parsedStdin) {
      return 'claude-code';
    }
    if ('toolName' in input.parsedStdin || 'toolInput' in input.parsedStdin) {
      return 'cursor';
    }
    if ('eventName' in input.parsedStdin || 'parameters' in input.parsedStdin) {
      return 'trae';
    }
  }
  // 3. cwd 启发式
  for (const adapter of ['claude-code', 'trae', 'codex', 'cursor', 'qoder', 'tongyi-lingma'] as const) {
    const a = getAdapter(adapter);
    if (existsSync(join(input.cwd, a.settings.dirName))) {
      return adapter;
    }
  }
  // 4. fallback
  return 'claude-code';
}

/**
 * Pluck a string value at a nested path. Returns undefined if any segment is
 * missing or non-object. Used by adapter-driven stdin parsers.
 */
export function pluckString(obj: unknown, path: readonly string[]): string | undefined {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!isObject(cur) || !(seg in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function pluckObject(obj: unknown, path: readonly string[]): Record<string, unknown> | undefined {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!isObject(cur) || !(seg in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return isObject(cur) ? cur : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Default stdin parser for adapters that follow the Claude Code shape
 * (most LLM-style IDEs do: tool_name at top, tool_input.{command} inside).
 */
export function parseClaudeShapeStdin(parsed: unknown): { toolName?: string; command?: string } {
  if (!isObject(parsed)) return {};
  const toolName = pluckString(parsed, ['tool_name']);
  const command = pluckString(parsed, ['tool_input', 'command']);
  const result: { toolName?: string; command?: string } = {};
  if (toolName !== undefined) result.toolName = toolName;
  if (command !== undefined) result.command = command;
  return result;
}
