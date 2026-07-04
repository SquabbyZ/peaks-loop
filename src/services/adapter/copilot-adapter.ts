import { Adapter, ADAPTER_NOT_IMPLEMENTED } from "./adapter.js";
export class CopilotAdapter implements Pick<Adapter, "name"> {
  readonly name = "copilot" as const;
  constructor(private readonly _o: { home: string }) {}
  async detect() { return false; }
  async resolveScratchDir() { throw new ADAPTER_NOT_IMPLEMENTED("copilot", "resolveScratchDir"); }
  async materialize() { throw new ADAPTER_NOT_IMPLEMENTED("copilot", "materialize"); }
  async publish() { throw new ADAPTER_NOT_IMPLEMENTED("copilot", "publish"); }
  async activate() { throw new ADAPTER_NOT_IMPLEMENTED("copilot", "activate"); }
  async cleanup() { throw new ADAPTER_NOT_IMPLEMENTED("copilot", "cleanup"); }
}