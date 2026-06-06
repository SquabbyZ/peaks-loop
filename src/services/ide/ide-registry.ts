import type { IdeAdapter, IdeId } from './ide-types.js';
import { CLAUDE_CODE_ADAPTER } from './adapters/claude-code-adapter.js';

/**
 * Built-in IDE adapter registry。Map<IdeId, IdeAdapter> 是单一来源。
 *
 * Slice #1 仅注册 claude-code(per PRD Non-goals 与 preserved behavior)。
 * 后续 slice 注入 trae / codex / cursor / qoder / tongyi-lingma 时,只需在此
 * Map 加条目 —— 所有 adapter 使用方(hook-translator、hooks install、statusline
 * install、mcp apply)通过 `getAdapter(ide)` 拿取,无需修改。
 */
const ADAPTERS: ReadonlyMap<IdeId, IdeAdapter> = new Map<IdeId, IdeAdapter>([
  ['claude-code', CLAUDE_CODE_ADAPTER],
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
}
