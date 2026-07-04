import { describe, expect, it } from "vitest";
import { CodexAdapter } from "../../../src/services/adapter/codex-adapter.js";
import { CopilotAdapter } from "../../../src/services/adapter/copilot-adapter.js";
import { ADAPTER_NOT_IMPLEMENTED } from "../../../src/services/adapter/adapter.js";

describe("stub adapters", () => {
  const codex = new CodexAdapter({ home: "/h" });
  const copilot = new CopilotAdapter({ home: "/h" });
  for (const [label, a, methods] of [
    ["codex", codex, ["resolveScratchDir", "materialize", "publish", "activate", "cleanup"]] as const,
    ["copilot", copilot, ["resolveScratchDir", "materialize", "publish", "activate", "cleanup"]] as const,
  ]) {
    for (const m of methods) {
      it(`${label}.${m} throws ADAPTER_NOT_IMPLEMENTED`, async () => {
        await expect((a as any)[m]("bee-x")).rejects.toThrow(ADAPTER_NOT_IMPLEMENTED);
      });
    }
  }
  it("codex.detect returns false", async () => { expect(await codex.detect()).toBe(false); });
  it("copilot.detect returns false", async () => { expect(await copilot.detect()).toBe(false); });
});