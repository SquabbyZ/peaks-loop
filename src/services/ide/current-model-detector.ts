/**
 * Runtime current-model detector (Slice 2026-07-09 add-zcode-adapter, Slice C).
 *
 * Walks the registered IDE adapter chain and asks the IDE adapter
 * (when it opts in via `IdeAdapter.detectCurrentModel?`) to report the
 * currently-active model id. This is the runtime sibling of
 * `getStrongestModelId(config)` in `src/services/config/model-routing.ts`:
 *
 *   - `getStrongestModelId(config)` reads `config.model` (user-set) and
 *     falls back to the env-var / `'claude-opus-4-7'` constant. Sync.
 *   - `detectCurrentIdeModel()` reads the IDE's runtime state (which
 *     provider UI is active, which model the picker shows). Async.
 *
 * The CLI surface `peaks ide model --current` (added in this slice)
 * delegates here. The future async resolver at
 * `getStrongestModelIdAsync` (Slice C §C.4) calls this so config-less
 * runs (e.g. an LLM inside z-code) can derive the strongest model from
 * its actual environment.
 *
 * Vendor-neutrality notes (SC-3 §5 + RD-3 §2.4):
 *   - This file never names a vendor (no "claude", "zcode", etc.).
 *   - It only walks `IdeAdapter.detectCurrentModel?` — any adapter
 *     can opt in.
 *   - It returns `undefined` when detection is unavailable; callers
 *     must fall back to the configured / hardcoded model.
 */
import { getAdapter } from './ide-registry.js';
import { listAdapterIds } from './ide-registry.js';

/**
 * Probe every registered IDE adapter for its currently-active model
 * id. Returns the first non-empty value found in registration order,
 * or `undefined` when no adapter opts in / all opted-in adapters
 * return undefined.
 *
 * Registration order: see `ide-registry.ts` ADAPTERS Map. The IDE
 * adapter for `claude-code` is consulted first; only `zcode` opts in
 * to this slice's detection (other adapters will return undefined).
 *
 * Async because each IDE adapter's detectCurrentModel may read local
 * disk or env on a slow filesystem.
 */
export async function detectCurrentIdeModel(): Promise<string | undefined> {
  for (const id of listAdapterIds()) {
    const adapter = getAdapter(id);
    if (typeof adapter.detectCurrentModel !== 'function') continue;
    try {
      const modelId = await adapter.detectCurrentModel();
      if (typeof modelId === 'string' && modelId.trim().length > 0) {
        return modelId.trim();
      }
    } catch {
      // Per-SC §3.4: detection is best-effort. Swallow errors so a
      // misconfigured adapter cannot poison the chain; the next
      // adapter still gets a chance.
    }
  }
  return undefined;
}
