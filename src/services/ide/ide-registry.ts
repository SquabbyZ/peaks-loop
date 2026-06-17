import type { IdeAdapter, IdeId } from './ide-types.js';
import { CLAUDE_CODE_ADAPTER } from './adapters/claude-code-adapter.js';
import { TRAE_ADAPTER } from './adapters/trae-adapter.js';
import { CURSOR_ADAPTER } from './adapters/cursor-adapter.js';
import { CODEX_ADAPTER } from './adapters/codex-adapter.js';
import { HERMES_ADAPTER } from './adapters/hermes-adapter.js';
import { OPENCLAW_ADAPTER } from './adapters/openclaw-adapter.js';

/**
 * Built-in IDE adapter registry。Map<IdeId, IdeAdapter> 是单一来源。
 *
 * Slice #1 注册 claude-code。
 * Slice #2 注册 trae —— 这是 slice #1 抽出的 IdeAdapter 形状的
 * 第一个真实客户,验证"填表"承诺。
 * 后续 slice 注入 codex / cursor / qoder / tongyi-lingma 时,只需在此
 * Map 加条目 —— 所有 adapter 使用方(hook-translator、hooks install、statusline
 * install、mcp apply)通过 `getAdapter(ide)` 拿取,无需修改。
 * Slice #0.7 注入 hermes + openclaw。
 * Slice #12 (2.4.0) 注册 cursor。
 * Slice #13 (2.4.0) 注册 codex。
 */
const ADAPTERS: ReadonlyMap<IdeId, IdeAdapter> = new Map<IdeId, IdeAdapter>([
  ['claude-code', CLAUDE_CODE_ADAPTER],
  ['trae', TRAE_ADAPTER],
  ['cursor', CURSOR_ADAPTER],
  ['codex', CODEX_ADAPTER],
  ['hermes', HERMES_ADAPTER],
  ['openclaw', OPENCLAW_ADAPTER],
]);

/** Get the adapter for a given IDE id. Throws on unsupported IDE. */
export function getAdapter(ide: IdeId): IdeAdapter {
  const adapter = ADAPTERS.get(ide);
  if (!adapter) {
    throw new Error(`Unsupported IDE: ${ide}. Registered: ${listAdapterIds().join(', ') || '(none)'}`);
  }
  return adapter;
}

/** All registered adapter ids (insertion order). */
export function listAdapterIds(): readonly IdeId[] {
  return Array.from(ADAPTERS.keys());
}

/** All registered adapters (insertion order). */
export function listAdapters(): readonly IdeAdapter[] {
  return Array.from(ADAPTERS.values());
}

/**
 * Test seam: register or replace an adapter. Used by future slices when adding
 * a new IDE. Caller is responsible for ensuring the adapter is well-formed.
 */
export function _setAdapterForTesting(ide: IdeId, adapter: IdeAdapter): void {
  (ADAPTERS as Map<IdeId, IdeAdapter>).set(ide, adapter);
}

/** Test seam: reset to built-in defaults. */
export function _resetAdaptersForTesting(): void {
  (ADAPTERS as Map<IdeId, IdeAdapter>).clear();
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('claude-code', CLAUDE_CODE_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('trae', TRAE_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('cursor', CURSOR_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('codex', CODEX_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('hermes', HERMES_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('openclaw', OPENCLAW_ADAPTER);
}
