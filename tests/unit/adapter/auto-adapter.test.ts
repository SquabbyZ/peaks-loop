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
});