import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openStateDb } from "../../../src/services/skillhub/sqlite-store.js";
import { retainRelease } from "../../../src/services/skillhub/release-retain.js";
import type { BeeManifest } from "../../../src/services/sediment/types.js";

let dir = "";
let db: ReturnType<typeof openStateDb>;
let blobsDir: string;
let scratchDir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "peaks-retain-"));
  db = openStateDb(join(dir, "state.db"));
  blobsDir = join(dir, "blobs");
  scratchDir = join(dir, "scratch");
  mkdirSync(scratchDir, { recursive: true });
  mkdirSync(blobsDir, { recursive: true });
  writeFileSync(join(scratchDir, "SKILL.md"), "## bee-x\n");
  mkdirSync(join(scratchDir, "scripts"), { recursive: true });
  writeFileSync(join(scratchDir, "scripts", "fetch.sh"), "#!/bin/sh\necho hi\n", { mode: 0o755 });
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const manifest: BeeManifest = {
  schemaVersion: "peaks.bee/1",
  name: "bee-x",
  source: "user",
  promotion_status: "candidate",
  description: "d",
  segments: [{ name: "seg-a", inputs: [], outputs: [], sideEffects: ["net:fetch"] }],
  entrypoint: { preamble: "## bee-x", refs: [{ path: "scripts/fetch.sh", kind: "script" }] },
  promotion: { minCycles: 1, requiresHumanApproval: true, requiresSmokeTest: true },
  createdBy: "llm",
  lastTouchedAt: "2026-07-04T12:00:00Z",
};

describe("retainRelease", () => {
  it("writes 6-table rows and content-addressed blobs", () => {
    const id = retainRelease({ db, blobsDir, scratchDir, manifest });
    expect(id).toBeGreaterThan(0);
    const r = db
      .prepare("SELECT bee_name, version, source FROM bee_release WHERE id = ?")
      .get(id) as { bee_name: string; version: string; source: string };
    expect(r).toEqual({ bee_name: "bee-x", version: "0.1.0", source: "user" });
    const files = db
      .prepare("SELECT owner_kind, owner_name, path, sha256 FROM bee_file WHERE release_id = ?")
      .all(id) as Array<{ owner_kind: string; owner_name: string; path: string; sha256: string }>;
    expect(files.length).toBeGreaterThanOrEqual(2);
    // No single TEXT column over 16KB. Coverage extends across ALL
    // TEXT columns that store user-controlled bodies: bee_release
    // (description / changelog / user_intent_raw), bee_manifest
    // (entrypoint_preamble / segments_json), and bee_segment_ref
    // (inputs_json / outputs_json / side_effects).
    const colChecks: Array<{ table: string; col: string }> = [
      { table: "bee_release", col: "description" },
      { table: "bee_release", col: "changelog" },
      { table: "bee_release", col: "user_intent_raw" },
      { table: "bee_manifest", col: "entrypoint_preamble" },
      { table: "bee_manifest", col: "segments_json" },
      { table: "bee_segment_ref", col: "inputs_json" },
      { table: "bee_segment_ref", col: "outputs_json" },
      { table: "bee_segment_ref", col: "side_effects" },
    ];
    for (const { table, col } of colChecks) {
      const max = (
        db.prepare(`SELECT MAX(LENGTH(${col})) AS m FROM ${table}`).get() as {
          m: number | null;
        }
      ).m ?? 0;
      expect(max).toBeLessThan(16 * 1024);
    }
    // Verify blobs sidecar files were written
    const shaValues = files.map((f) => f.sha256);
    expect(shaValues.length).toBeGreaterThanOrEqual(2);
    for (const sha of shaValues) {
      expect(existsSync(join(blobsDir, sha.slice(0, 2), sha))).toBe(true);
    }
  });

  it("accepts an explicit version and persists it to bee_release + bee_release_pointer", () => {
    const id = retainRelease({ db, blobsDir, scratchDir, manifest, version: "0.3.7" });
    expect(id).toBeGreaterThan(0);
    const r = db
      .prepare("SELECT bee_name, version FROM bee_release WHERE id = ?")
      .get(id) as { bee_name: string; version: string };
    expect(r).toEqual({ bee_name: "bee-x", version: "0.3.7" });
    const ptr = db
      .prepare("SELECT bee_name, latest_version FROM bee_release_pointer WHERE bee_name = ?")
      .get("bee-x") as { bee_name: string; latest_version: string };
    expect(ptr).toEqual({ bee_name: "bee-x", latest_version: "0.3.7" });
  });

  // Regression: Important #5 — when a TEXT column overflows the 16KB
  // soft-limit, retainRelease must surface a warning so ops can review.
  it("logs a 16KB overflow warning when bee_segment_ref.inputs_json exceeds the soft-limit (regression: Important #5)", () => {
    const oversized: BeeManifest = {
      ...manifest,
      name: "bee-overflow",
      segments: [
        {
          name: "seg-fat",
          // ~20 KB worth of inputs — well above 16KB
          inputs: Array.from({ length: 100 }, (_, i) => ({
            type: "scalar",
            value: `field-${i}-${"x".repeat(180)}`,
          })),
          outputs: [],
          sideEffects: [],
        },
      ],
    };
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      retainRelease({ db, blobsDir, scratchDir, manifest: oversized });
      const calls = warnSpy.mock.calls.flat().map((c) => String(c));
      const matched = calls.some((c) =>
        /bee_segment_ref\.inputs_json/.test(c) && /overflowed 16KB guard/.test(c)
      );
      expect(matched).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
