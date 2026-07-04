// tests/unit/skills/peaks-maker.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { peaksMakerManifest } from "../../../src/skills/peaks-maker/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("peaks-maker manifest", () => {
  it("exports a manifest with name and description", () => {
    expect(peaksMakerManifest.name).toBe("peaks-maker");
    expect(peaksMakerManifest.description.length).toBeGreaterThan(20);
  });
  it("SKILL.md exists and has frontmatter", () => {
    const md = readFileSync(resolve(__dirname, "../../../src/skills/peaks-maker/SKILL.md"), "utf-8");
    expect(md).toMatch(/^---\nname: peaks-maker\ndescription: /);
  });
});
