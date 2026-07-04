import { Adapter, ADAPTER_NOT_IMPLEMENTED } from "./adapter.js";
export class CodexAdapter implements Pick<Adapter, "name"> {
  readonly name = "codex" as const;
  constructor(private readonly _o: { home: string }) {}
  async detect() { return false; }
  async resolveScratchDir() { throw new ADAPTER_NOT_IMPLEMENTED("codex", "resolveScratchDir"); }
  async materialize() { throw new ADAPTER_NOT_IMPLEMENTED("codex", "materialize"); }
  async publish() { throw new ADAPTER_NOT_IMPLEMENTED("codex", "publish"); }
  async activate() { throw new ADAPTER_NOT_IMPLEMENTED("codex", "activate"); }
  async cleanup() { throw new ADAPTER_NOT_IMPLEMENTED("codex", "cleanup"); }
}
