import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeAdapter } from "../../../src/services/adapter/claude-adapter.js";

let home = "";
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "peaks-claude-"));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("ClaudeAdapter", () => {
  const make = () => new ClaudeAdapter({ home });

  it("resolveScratchDir returns ~/.claude/skills/peaks-bee-<name>.peaks-generated", async () => {
    expect(await make().resolveScratchDir("bee-x")).toBe(
      join(home, ".claude/skills/peaks-bee-bee-x.peaks-generated"),
    );
  });

  it("materialize writes SKILL.md with name+description frontmatter and references/", async () => {
    const scratch = await make().materialize(
      "bee-x",
      {
        preamble: "## bee-x preamble",
        refs: [{ path: "references/spec.md", kind: "file" }],
      },
      [{ name: "seg-a", skillMd: "## seg-a\n", scripts: [] }],
    );
    expect(existsSync(join(scratch, "SKILL.md"))).toBe(true);
    const md = readFileSync(join(scratch, "SKILL.md"), "utf-8");
    expect(md).toMatch(/^---\nname: peaks-bee-bee-x\ndescription: /);
    expect(md).toContain("## bee-x preamble");
  });

  it("publish is a no-op for claude (it is the runtime)", async () => {
    const scratch = await make().materialize("bee-x", { preamble: "x", refs: [] }, []);
    expect(await make().publish(scratch)).toBe(scratch);
  });

  it("cleanup removes the scratch dir", async () => {
    const scratch = await make().materialize("bee-x", { preamble: "x", refs: [] }, []);
    expect(existsSync(scratch)).toBe(true);
    await make().cleanup(scratch);
    expect(existsSync(scratch)).toBe(false);
  });
});
