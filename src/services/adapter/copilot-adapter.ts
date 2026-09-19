/**
 * ⚠ DEAD CODE — not the live `CopilotAdapter`. See the block comment on
 * `src/services/adapter/adapter.ts` for the three same-named layers, and
 * `tests/unit/runtime/vendor-adapter-layer.test.ts` for the guard.
 *
 * The class below has zero importers anywhere in this repo. The live copilot
 * adapter is `src/services/runtime/vendors/copilot.ts` (runtime detect +
 * compact, wired into `RuntimeService`) and
 * `packages/peaks-loop-internal-runtime/src/vendor/copilot-adapter.ts` (the
 * dispatched-sub-agent runtime). `detect()` here returns a hardcoded
 * `false`; every other method throws `ADAPTER_NOT_IMPLEMENTED`.
 */
import { Adapter, ADAPTER_NOT_IMPLEMENTED } from './adapter.js';
export class CopilotAdapter implements Pick<Adapter, 'name'> {
  readonly name = 'copilot' as const;
  constructor(private readonly _o: { home: string }) {}
  async detect() {
    return false;
  }
  async resolveScratchDir() {
    throw new ADAPTER_NOT_IMPLEMENTED('copilot', 'resolveScratchDir');
  }
  async materialize() {
    throw new ADAPTER_NOT_IMPLEMENTED('copilot', 'materialize');
  }
  async publish() {
    throw new ADAPTER_NOT_IMPLEMENTED('copilot', 'publish');
  }
  async activate() {
    throw new ADAPTER_NOT_IMPLEMENTED('copilot', 'activate');
  }
  async cleanup() {
    throw new ADAPTER_NOT_IMPLEMENTED('copilot', 'cleanup');
  }
}
