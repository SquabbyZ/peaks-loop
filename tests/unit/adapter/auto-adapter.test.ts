import { describe, expect, it } from "vitest";
import { AutoAdapter } from "../../../src/services/adapter/auto-adapter.js";
import { ClaudeAdapter } from "../../../src/services/adapter/claude-adapter.js";
import { CodexAdapter } from "../../../src/services/adapter/codex-adapter.js";
import { CopilotAdapter } from "../../../src/services/adapter/copilot-adapter.js";

describe("AutoAdapter", () => {
  it("picks claude first when only claude.detect is true", async () => {
    const a = new AutoAdapter(
      { home: "/h" },
      [
        new ClaudeAdapter({ home: "/h" }),
        new CodexAdapter({ home: "/h" }),
        new CopilotAdapter({ home: "/h" }),
      ],
    );
    const picked = await a.detectAndPick();
    expect(picked.name).toBe("claude");
  });

  it("throws when all adapters return detect() === false", async () => {
    // Stub adapters whose detect() always returns false.
    // Cast to Detectable: the AutoAdapter only ever reads .detect() and .name;
    // the name literal type is enforced for production adapters only.
    const stub = {
      name: "stub-a" as const,
      detect: async () => false,
      resolveScratchDir: async () => "",
      materialize: async () => "",
      publish: async () => "",
      activate: async () => undefined,
      cleanup: async () => undefined,
    };
    const stub2 = { ...stub, name: "stub-b" as const };
    const a = new AutoAdapter(
      { home: "/h" },
      [stub, stub2] as unknown as ConstructorParameters<typeof AutoAdapter>[1]
    );
    await expect(a.detectAndPick()).rejects.toThrow(/No adapter detected/);
  });
});
