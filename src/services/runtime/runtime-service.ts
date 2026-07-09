/**
 * Runtime service — slice S2-a of RD-2.
 *
 * Orchestrator that wires the runtime detector + vendor adapter
 * registry into a small surface that the CLI commands call. The
 * service owns the canonical list of built-in adapters (claude-code /
 * codex / copilot) and decides which adapter handles a given
 * `--via <id>` request.
 *
 * Design notes (Karpathy #2 Simplicity First):
 *
 *  - The service is a thin orchestrator — it does NOT contain any
 *    vendor verb strings (claude / codex / copilot). All vendor verbs
 *    live in `src/services/runtime/vendors/<vendor>.ts`. Verified by
 *    AC-1.
 *  - When `compactVia(id)` is called with an unknown id, the service
 *    returns a "no-op" result with exitCode=0 and a warning instead of
 *    throwing — vendor-neutrality means peaks-loop MUST keep working
 *    even when the requested vendor adapter isn't registered.
 *  - The service is the SOLE owner of the built-in adapter list. Tests
 *    and CLI commands should never instantiate adapters directly;
 *    they should call `listBuiltInAdapters()` or `getAdapter(id)`.
 */
import type { VendorAdapter, VendorCompactResult } from './vendor-adapter.js';
import { ClaudeCodeAdapter } from './vendors/claude-code.js';
import { CodexAdapter } from './vendors/codex.js';
import { CopilotAdapter } from './vendors/copilot.js';

export interface RuntimeServiceOptions {
  /** Override the built-in adapter list (used by tests + the
   *  adapter-registry's `register()` flow). */
  readonly builtIns?: VendorAdapter[];
  /** Override the home dir used by adapter detect() helpers. */
  readonly home?: string;
}

const DEFAULT_BUILT_INS: VendorAdapter[] = [
  new ClaudeCodeAdapter(),
  new CodexAdapter(),
  new CopilotAdapter()
];

/** Pure orchestrator. The runtime service holds built-in adapters as
 *  the baseline registry; the AdapterRegistry layer (`src/services/
 *  adapter/adapter-registry.ts`) extends this baseline at runtime via
 *  user-registered adapters persisted to `.peaks/runtime/adapters.json`.
 *  The two layers are intentionally separate:
 *    - runtime-service: built-in vendor adapters for the runtime-detect
 *      compact flow (S2-a).
 *    - adapter-registry: persisted user-registered adapters (S2-a).
 *  runtime-service itself does NOT consult the adapter registry —
 *  callers (`peaks runtime compact --via <id>`) layer them: first look
 *  up the id in the persisted registry, fall back to the built-in list.
 */
export class RuntimeService {
  private readonly builtIns: VendorAdapter[];

  constructor(opts: RuntimeServiceOptions = {}) {
    this.builtIns = opts.builtIns ?? [...DEFAULT_BUILT_INS];
  }

  /** Return all built-in adapters. Order: claude-code, codex, copilot. */
  listBuiltInAdapters(): VendorAdapter[] {
    return [...this.builtIns];
  }

  /** Resolve a built-in adapter by id. Returns undefined when not
   *  found — caller should fall back to adapter registry or unknown. */
  getBuiltInAdapter(id: string): VendorAdapter | undefined {
    return this.builtIns.find((a) => a.id === id);
  }

  /** Compact via a built-in adapter. When the id is unknown, returns
   *  a no-op result with a warning rather than throwing — vendor
   *  neutrality demands peaks-loop stay alive even when a vendor is
   *  not wired up. */
  async compactVia(id: string, force: boolean | undefined): Promise<VendorCompactResult & { warning?: string }> {
    const adapter = this.getBuiltInAdapter(id);
    if (adapter === undefined) {
      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        warning: `no built-in adapter registered for id="${id}" — falling back to no-op; use \`peaks adapter register --id ${id} --binary <cmd>\` to wire one`
      };
    }
    return adapter.compact({ force: force === true });
  }
}