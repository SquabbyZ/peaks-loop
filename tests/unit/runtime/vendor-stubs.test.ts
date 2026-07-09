import { describe, expect, it } from "vitest";
import { ClaudeCodeAdapter } from "../../../src/services/runtime/vendors/claude-code.js";
import { CodexAdapter } from "../../../src/services/runtime/vendors/codex.js";
import { CopilotAdapter } from "../../../src/services/runtime/vendors/copilot.js";

describe("vendor adapter stubs", () => {
  it("claude-code adapter exposes the right id + display name", () => {
    const a = new ClaudeCodeAdapter();
    expect(a.id).toBe("claude-code");
    expect(a.displayName).toBe("Claude Code");
  });

  it("codex adapter exposes the right id + display name", () => {
    const a = new CodexAdapter();
    expect(a.id).toBe("codex");
    expect(a.displayName).toBe("Codex");
  });

  it("copilot adapter exposes the right id + display name", () => {
    const a = new CopilotAdapter();
    expect(a.id).toBe("copilot");
    expect(a.displayName).toBe("GitHub Copilot");
  });

  it("claude-code adapter.compact returns exitCode=127 when the binary is missing", async () => {
    const a = new ClaudeCodeAdapter();
    // We do NOT mock the binary — just verify the no-throw contract.
    const r = await a.compact({ force: true });
    expect(typeof r.exitCode).toBe("number");
    // Acceptable outcomes: 0 (binary present) or 127 (binary missing).
    expect([0, 127]).toContain(r.exitCode);
    expect(typeof r.stdout).toBe("string");
    expect(typeof r.stderr).toBe("string");
  });

  it("codex adapter.compact never throws even when the binary is missing", async () => {
    const a = new CodexAdapter();
    const r = await a.compact();
    expect(typeof r.exitCode).toBe("number");
    expect([0, 127]).toContain(r.exitCode);
  });

  it("copilot adapter.compact never throws even when the binary is missing", async () => {
    const a = new CopilotAdapter();
    const r = await a.compact();
    expect(typeof r.exitCode).toBe("number");
    expect([0, 127]).toContain(r.exitCode);
  });
});