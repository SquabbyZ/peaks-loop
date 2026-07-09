import { describe, expect, it } from "vitest";
import { RuntimeService } from "../../../src/services/runtime/runtime-service.js";
import type { VendorAdapter } from "../../../src/services/runtime/vendor-adapter.js";

describe("runtime-service", () => {
  it("lists the three built-in adapters in canonical order", () => {
    const svc = new RuntimeService();
    const ids = svc.listBuiltInAdapters().map((a) => a.id);
    expect(ids).toEqual(["claude-code", "codex", "copilot"]);
  });

  it("resolves a built-in adapter by id", () => {
    const svc = new RuntimeService();
    expect(svc.getBuiltInAdapter("claude-code")?.id).toBe("claude-code");
    expect(svc.getBuiltInAdapter("codex")?.id).toBe("codex");
    expect(svc.getBuiltInAdapter("copilot")?.id).toBe("copilot");
    expect(svc.getBuiltInAdapter("nope")).toBeUndefined();
  });

  it("compactVia falls back to no-op warning when id is unknown (vendor neutrality)", async () => {
    const svc = new RuntimeService();
    const r = await svc.compactVia("nope", false);
    expect(r.exitCode).toBe(0);
    expect(r.warning).toMatch(/no built-in adapter registered/);
  });

  it("compactVia delegates to the adapter and respects force flag", async () => {
    const fakeAdapter: VendorAdapter = {
      id: "fake",
      displayName: "Fake",
      detect: async () => true,
      compact: async (args = {}) => {
        return {
          exitCode: 0,
          stdout: `force=${args.force === true ? "yes" : "no"}`,
          stderr: ""
        };
      }
    };
    const svc = new RuntimeService({ builtIns: [fakeAdapter] });
    const r1 = await svc.compactVia("fake", false);
    expect(r1.stdout).toBe("force=no");
    const r2 = await svc.compactVia("fake", true);
    expect(r2.stdout).toBe("force=yes");
  });

  it("does not modify the underlying built-in list when callers mutate the returned array", () => {
    const svc = new RuntimeService();
    const arr = svc.listBuiltInAdapters();
    arr.pop();
    // The internal list must still have all three adapters.
    expect(svc.listBuiltInAdapters()).toHaveLength(3);
  });
});