/**
 * ⚠ DEAD CODE — not the live `CodexAdapter`. See the block comment on
 * `src/services/adapter/adapter.ts` for the three same-named layers, and
 * `tests/unit/runtime/vendor-adapter-layer.test.ts` for the guard.
 *
 * The class below has zero importers anywhere in this repo. The live codex
 * adapter is `src/services/runtime/vendors/codex.ts` (runtime detect +
 * compact, wired into `RuntimeService`) and
 * `packages/peaks-loop-internal-runtime/src/vendor/codex-adapter.ts` (the
 * dispatched-sub-agent runtime). `detect()` here returns a hardcoded
 * `false`; every other method throws `ADAPTER_NOT_IMPLEMENTED`.
 */
import { Adapter, ADAPTER_NOT_IMPLEMENTED } from './adapter.js';
export class CodexAdapter implements Pick<Adapter, 'name'> {
  readonly name = 'codex' as const;
  constructor(private readonly _o: { home: string }) {}
  async detect() {
    return false;
  }
  async resolveScratchDir() {
    throw new ADAPTER_NOT_IMPLEMENTED('codex', 'resolveScratchDir');
  }
  async materialize() {
    throw new ADAPTER_NOT_IMPLEMENTED('codex', 'materialize');
  }
  async publish() {
    throw new ADAPTER_NOT_IMPLEMENTED('codex', 'publish');
  }
  async activate() {
    throw new ADAPTER_NOT_IMPLEMENTED('codex', 'activate');
  }
  async cleanup() {
    throw new ADAPTER_NOT_IMPLEMENTED('codex', 'cleanup');
  }
}
