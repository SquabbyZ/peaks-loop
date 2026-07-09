import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectRuntime } from "../../../src/services/runtime/runtime-detector.js";

describe("runtime-detector", () => {
  function freshHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "peaks-runtime-detector-"));
    return dir;
  }

  it("returns unknown when no vendor sentinel is set", () => {
    const home = freshHome();
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("unknown");
    expect(r.reason).toMatch(/no vendor sentinel/);
    rmSync(home, { recursive: true, force: true });
  });

  it("detects claude-code via CLAUDE_CODE=1", () => {
    const home = freshHome();
    const r = detectRuntime({ env: { CLAUDE_CODE: "1" }, home });
    expect(r.vendor).toBe("claude-code");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects claude-code via CLAUDE_CODE_ENTRYPOINT", () => {
    const home = freshHome();
    const r = detectRuntime({ env: { CLAUDE_CODE_ENTRYPOINT: "cli" }, home });
    expect(r.vendor).toBe("claude-code");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects claude-code via ~/.claude directory", () => {
    const home = freshHome();
    mkdirSync(join(home, ".claude"));
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("claude-code");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects codex via CODEX_HOME", () => {
    const home = freshHome();
    const r = detectRuntime({ env: { CODEX_HOME: "/x" }, home });
    expect(r.vendor).toBe("codex");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects codex via ~/.codex directory", () => {
    const home = freshHome();
    mkdirSync(join(home, ".codex"));
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("codex");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects copilot via GITHUB_COPILOT=1", () => {
    const home = freshHome();
    const r = detectRuntime({ env: { GITHUB_COPILOT: "1" }, home });
    expect(r.vendor).toBe("copilot");
    rmSync(home, { recursive: true, force: true });
  });

  it("detects copilot via ~/.copilot directory", () => {
    const home = freshHome();
    mkdirSync(join(home, ".copilot"));
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("copilot");
    rmSync(home, { recursive: true, force: true });
  });

  it("prefers claude-code over codex when both sentinels are present (default-runtime priority)", () => {
    const home = freshHome();
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, ".codex"));
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("claude-code");
    rmSync(home, { recursive: true, force: true });
  });

  it("does not crash when env var is empty string", () => {
    const home = freshHome();
    const r = detectRuntime({ env: { CLAUDE_CODE: "", CLAUDE_CODE_ENTRYPOINT: "" }, home });
    expect(r.vendor).toBe("unknown");
    rmSync(home, { recursive: true, force: true });
  });

  it("ignores stale .peaks or unrelated sentinels", () => {
    const home = freshHome();
    writeFileSync(join(home, ".peaks-marker"), "noise");
    const r = detectRuntime({ env: {}, home });
    expect(r.vendor).toBe("unknown");
    rmSync(home, { recursive: true, force: true });
  });
});