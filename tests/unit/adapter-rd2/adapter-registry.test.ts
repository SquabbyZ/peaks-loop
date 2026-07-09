import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AdapterRegistry } from "../../../src/services/adapter/adapter-registry.js";

describe("adapter-registry (RD-2 S2-a)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "peaks-adapter-registry-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("starts empty", () => {
    const reg = new AdapterRegistry();
    expect(reg.list()).toEqual([]);
  });

  it("register adds a record", () => {
    const reg = new AdapterRegistry();
    const result = reg.register({
      id: "my-cli",
      displayName: "My CLI",
      binary: "my-cli"
    });
    expect(result.created).toBe(true);
    expect(reg.list()).toHaveLength(1);
  });

  it("register with explicit args persists them", () => {
    const reg = new AdapterRegistry();
    reg.register({
      id: "my-cli",
      displayName: "My CLI",
      binary: "my-cli",
      args: ["--quiet", "--no-banner"]
    });
    const list = reg.list();
    expect(list[0]?.args).toEqual(["--quiet", "--no-banner"]);
  });

  it("register fails if id is malformed", () => {
    const reg = new AdapterRegistry();
    expect(() => reg.register({
      id: "Has Spaces",
      displayName: "x",
      binary: "x"
    })).toThrow(/adapter id/);
    expect(() => reg.register({
      id: "",
      displayName: "x",
      binary: "x"
    })).toThrow(/non-empty/);
  });

  it("register fails if binary contains a path separator", () => {
    const reg = new AdapterRegistry();
    expect(() => reg.register({
      id: "x",
      displayName: "x",
      binary: "/usr/bin/x"
    })).toThrow(/binary/);
    expect(() => reg.register({
      id: "y",
      displayName: "y",
      binary: "a\\b"
    })).toThrow(/binary/);
  });

  it("register is fail-if-exists by default", () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "x", displayName: "X", binary: "x" });
    const r2 = reg.register({ id: "x", displayName: "X2", binary: "x2" });
    expect(r2.created).toBe(false);
    const list = reg.list();
    expect(list[0]?.binary).toBe("x");
  });

  it("register overwrites when force=true", () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "x", displayName: "X", binary: "x" });
    const r2 = reg.register({ id: "x", displayName: "X2", binary: "x2" }, { force: true });
    // `created=false` means an existing record was overwritten; the
    // underlying list must still reflect the new payload.
    expect(r2.created).toBe(false);
    const list = reg.list();
    expect(list[0]?.binary).toBe("x2");
  });

  it("resolve returns a usable VendorAdapter for registered ids", async () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "missing-cli", displayName: "Missing", binary: "definitely-not-on-path-xyz" });
    const adapter = reg.resolve("missing-cli");
    expect(adapter).toBeDefined();
    expect(adapter?.id).toBe("missing-cli");
    expect(adapter?.displayName).toBe("Missing");
    // The compact invocation must not throw — it should report exitCode=127.
    const r = await adapter!.compact({ force: true });
    expect(r.exitCode).toBe(127);
  });

  it("resolve returns undefined for unknown ids", () => {
    const reg = new AdapterRegistry();
    expect(reg.resolve("nope")).toBeUndefined();
  });

  it("unregister removes a record and reports whether it existed", () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "x", displayName: "X", binary: "x" });
    expect(reg.unregister("x")).toBe(true);
    expect(reg.unregister("x")).toBe(false);
    expect(reg.list()).toEqual([]);
  });

  it("persist + load round-trip preserves all records", () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "a", displayName: "A", binary: "a" });
    reg.register({ id: "b", displayName: "B", binary: "b", args: ["--x"] });
    const file = join(tmp, "nested", "adapters.json");
    reg.persist(file);
    expect(existsSync(file)).toBe(true);

    const reg2 = new AdapterRegistry();
    reg2.load(file);
    expect(reg2.list()).toHaveLength(2);
    expect(reg2.list().map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(reg2.list().find((r) => r.id === "b")?.args).toEqual(["--x"]);
  });

  it("load treats missing file as empty (no throw)", () => {
    const reg = new AdapterRegistry();
    reg.load(join(tmp, "missing.json"));
    expect(reg.list()).toEqual([]);
  });

  it("load throws on malformed JSON", () => {
    const file = join(tmp, "bad.json");
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(file, "{not json", "utf8");
    const reg = new AdapterRegistry();
    expect(() => reg.load(file)).toThrow(/not valid JSON/);
  });

  it("load throws on shape mismatch", () => {
    const file = join(tmp, "wrong.json");
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(file, JSON.stringify({ version: 99, adapters: [] }), "utf8");
    const reg = new AdapterRegistry();
    expect(() => reg.load(file)).toThrow(/unexpected shape/);
  });

  it("load skips invalid records but still loads valid ones (partial recovery)", () => {
    const file = join(tmp, "mixed.json");
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(file, JSON.stringify({
      version: 1,
      adapters: [
        { id: "good", displayName: "Good", binary: "good" },
        { id: "Bad Id", displayName: "Bad", binary: "bad" } // malformed id
      ]
    }), "utf8");
    const reg = new AdapterRegistry();
    reg.load(file);
    expect(reg.list().map((r) => r.id)).toEqual(["good"]);
  });

  it("persist is atomic (no leftover .tmp file)", () => {
    const reg = new AdapterRegistry();
    reg.register({ id: "x", displayName: "X", binary: "x" });
    const file = join(tmp, "atomic.json");
    reg.persist(file);
    expect(existsSync(file)).toBe(true);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("defaultFile returns the canonical .peaks/runtime/adapters.json path", () => {
    expect(AdapterRegistry.defaultFile("/proj")).toMatch(/[/\\]\.peaks[/\\]runtime[/\\]adapters\.json$/);
  });
});