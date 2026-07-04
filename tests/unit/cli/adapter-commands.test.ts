/**
 * peaks skill adapter CLI — Task 15a scope.
 */
import { describe, expect, it } from "vitest";
import { runAdapter } from "../../../src/cli/commands/adapter-commands.js";

describe("peaks skill adapter CLI", () => {
  it("list returns claude/codex/copilot", async () => {
    const r = await runAdapter(["list"], { home: "/h" });
    expect(r.adapters?.sort()).toEqual(["claude", "codex", "copilot"]);
  });

  it("set-active records the adapter", async () => {
    const r = await runAdapter(["set-active", "claude"], { home: "/h" });
    expect(r.active).toBe("claude");
  });

  it("unknown verb returns no recognized fields", async () => {
    const r = await runAdapter(["bogus"], { home: "/h" });
    expect(r.adapters).toBeUndefined();
    expect(r.active).toBeUndefined();
  });
});
