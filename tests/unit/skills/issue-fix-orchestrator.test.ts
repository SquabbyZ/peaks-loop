// tests/unit/skills/issue-fix-orchestrator.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(
  __dirname,
  "..",
  "..",
  "..",
  "skills",
  "peaks-issue-fix-orchestrator",
  "SKILL.md",
);

describe("peaks-issue-fix-orchestrator SKILL.md", () => {
  it("exists", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md.length).toBeGreaterThan(0);
  });

  it("has frontmatter with name + description", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md).toMatch(/^---\nname: peaks-issue-fix-orchestrator\n/m);
    expect(md).toMatch(/^description: /m);
    // Description must be non-empty (greppable from any line of the frontmatter).
    const fmMatch = md.match(/^description:\s*(.+)$/m);
    expect(fmMatch).not.toBeNull();
    if (fmMatch) {
      expect(fmMatch[1]!.trim().length).toBeGreaterThan(20);
    }
  });

  it("has a non-empty Loop Engineering role section", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    const roleMatch = md.match(/^##\s+Loop Engineering role\s*\n([\s\S]*?)(?=^##\s+)/m);
    expect(roleMatch).not.toBeNull();
    if (roleMatch) {
      // Must be more than a one-liner — assert at least 200 chars of body.
      expect(roleMatch[1]!.trim().length).toBeGreaterThan(200);
      // And it must explicitly say this is a non-crystallizing orchestrator.
      expect(roleMatch[1]).toMatch(/non-crystallizing/i);
    }
  });

  it("contains the 5-line audit block verbatim", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    const expectedLines = [
      "git -C <repo> log --oneline -1 main                                  # must be upstream HEAD",
      "git -C <repo> log --oneline <upstream-HEAD>..main                    # must be empty",
      "git -C <repo> branch --list | grep -c '^  fix/'                      # must equal N",
      "ls <repo>/.peaks/_runtime/<sessionId>/peaks-issue-fix-orchestrator/prs | wc -l   # must equal N",
      "git -C <repo> show -s fix/<branch> | grep -E 'Repository:|AI-modified:'   # every commit must have both",
    ];
    for (const line of expectedLines) {
      expect(md, `missing audit line: ${line}`).toContain(line);
    }
  });

  it("references .peaks/standards/loop-engineering-guidelines.md", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md).toContain(".peaks/standards/loop-engineering-guidelines.md");
  });
});