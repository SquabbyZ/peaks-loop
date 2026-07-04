import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { resolvePoolRoot, resolveSystemDir, resolveUserBeeDir, resolveSegmentDir, resolveStateDbPath, resolveBlobsDir, SYSTEM_PATH_FORBIDDEN, assertNotSystemPath } from "../../../src/services/sediment/pool-paths.js";

describe("pool-paths", () => {
  it("resolves pool root to ~/.peaks/skills", () => {
    const r = resolvePoolRoot({ home: "/h" });
    expect(r).toBe(join("/h", ".peaks", "skills"));
  });
  it("resolves system dir to pool/.system", () => {
    expect(resolveSystemDir({ home: "/h" })).toBe(join("/h", ".peaks", "skills", ".system"));
  });
  it("resolves user bee dir under pool/bees", () => {
    expect(resolveUserBeeDir({ home: "/h" }, "bee-x")).toBe(join("/h", ".peaks", "skills", "bees", "bee-x"));
  });
  it("resolves segment dir under pool/segments", () => {
    expect(resolveSegmentDir({ home: "/h" }, "seg-y")).toBe(join("/h", ".peaks", "skills", "segments", "seg-y"));
  });
  it("resolves state.db under pool root", () => {
    expect(resolveStateDbPath({ home: "/h" })).toBe(join("/h", ".peaks", "skills", "state.db"));
  });
  it("resolves blobs dir under pool root", () => {
    expect(resolveBlobsDir({ home: "/h" })).toBe(join("/h", ".peaks", "skills", "blobs"));
  });
  it("assertNotSystemPath refuses .system paths", () => {
    expect(() => assertNotSystemPath("/h/.peaks/skills/.system/bees/x")).toThrow(SYSTEM_PATH_FORBIDDEN);
  });
  it("assertNotSystemPath allows user paths", () => {
    expect(() => assertNotSystemPath("/h/.peaks/skills/bees/bee-x")).not.toThrow();
  });
});
