import type { IdeAdapter, IdeId } from './ide-types.js';
import { CLAUDE_CODE_ADAPTER } from './adapters/claude-code-adapter.js';
import { TRAE_ADAPTER } from './adapters/trae-adapter.js';
import { CURSOR_ADAPTER } from './adapters/cursor-adapter.js';
import { CODEX_ADAPTER } from './adapters/codex-adapter.js';
import { HERMES_ADAPTER } from './adapters/hermes-adapter.js';
import { OPENCLAW_ADAPTER } from './adapters/openclaw-adapter.js';
import { QODER_ADAPTER } from './adapters/qoder-adapter.js';
import { TONGYI_LINGMA_ADAPTER } from './adapters/tongyi-lingma-adapter.js';
import { ZCODE_ADAPTER } from './adapters/zcode-adapter.js';

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
  ['qoder', QODER_ADAPTER],
  ['tongyi-lingma', TONGYI_LINGMA_ADAPTER],
  ['zcode', ZCODE_ADAPTER]
]);

/** Get the adapter for a given IDE id. Throws on unsupported IDE. */
export function getAdapter(ide: IdeId): IdeAdapter {
  const adapter = ADAPTERS.get(ide);
  if (!adapter) {
    throw new Error(
      `Unsupported IDE: ${ide}. Registered: ${listAdapterIds().join(', ') || '(none)'}`
    );
  }
  return adapter;
}

/**
 * Non-throwing twin of `getAdapter`. Returns `undefined` for an id with
 * no registered adapter instead of raising.
 *
 * For callers that hold an IDE-shaped string which is NOT guaranteed to
 * be an `IdeId`: `detectIdeFromEnv` returns `IdeKind` (`'claude-code' |
 * 'trae' | 'opencode' | 'unknown'`), and `'opencode'` has no adapter
 * registered. Casting to `IdeId` and calling `getAdapter` would throw
 * inside a pure formatting/threshold path — the caller wants "no
 * adapter → fall back", not an exception.
 */
export function tryGetAdapter(ide: string): IdeAdapter | undefined {
  return ADAPTERS.get(ide as IdeId);
}

/** All registered adapter ids (insertion order). */
export function listAdapterIds(): readonly IdeId[] {
  return Array.from(ADAPTERS.keys());
}

/**
 * Help text for every `--ide <id>` option, derived from the registry.
 *
 * It used to be a hand-written literal — `"target adapter id (claude-code |
 * trae); default: auto-detect from env/cwd"` — copy-pasted into six option
 * declarations across `hooks-commands.ts` and `statusline-commands.ts`. By the
 * time anyone read it the registry had nine adapters, so the help named two of
 * the nine values the option accepts and stayed silent about the other seven.
 * A help string that enumerates a set it does not own cannot be kept true by
 * discipline; deriving it here is the only form that cannot drift.
 *
 * Note for whoever is tempted to point the help at `peaks adapter list`
 * instead: that command lists USER-REGISTERED vendor adapters from
 * `.peaks/runtime/adapters.json` (a different registry, empty on a fresh
 * project). It is not this set. The nine ids below have no CLI surface of
 * their own; `peaks ide model --current` is the closest read-only viewer and
 * it reports one adapter, not the list.
 */
export function resolveIdeOptionHelp(): string {
  return `target adapter id (${listAdapterIds().join(' | ')}); default: auto-detect from env/cwd`;
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
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('qoder', QODER_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('tongyi-lingma', TONGYI_LINGMA_ADAPTER);
  (ADAPTERS as Map<IdeId, IdeAdapter>).set('zcode', ZCODE_ADAPTER);
}
