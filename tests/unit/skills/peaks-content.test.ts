// tests/unit/skills/peaks-content.test.ts
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
  "peaks-content",
  "SKILL.md",
);

describe("peaks-content SKILL.md", () => {
  it("(a) file exists and is non-empty", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md.length).toBeGreaterThan(0);
  });

  it("(b) frontmatter has name: peaks-content and a non-empty description", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md).toMatch(/^---\nname: peaks-content\n/m);
    expect(md).toMatch(/^description: /m);
    const fmMatch = md.match(/^description:\s*(.+)$/m);
    expect(fmMatch).not.toBeNull();
    if (fmMatch) {
      expect(fmMatch[1]!.trim().length).toBeGreaterThan(20);
    }
  });

  it('(c) "Domain boundary" / RL-8 section explicitly says it is NOT for code / research / medical / legal', () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    // Domain boundary section heading
    const boundaryMatch = md.match(
      /^##\s+Domain boundary[^\n]*\n([\s\S]*?)(?=^##\s+)/m,
    );
    expect(boundaryMatch).not.toBeNull();
    if (boundaryMatch) {
      const body = boundaryMatch[1]!.toLowerCase();
      expect(body).toMatch(/code/);
      expect(body).toMatch(/research/);
      expect(body).toMatch(/medical/);
      expect(body).toMatch(/legal/);
      // The wording "not" (case-insensitive) must appear in the section body
      expect(body).toMatch(/\bnot\b/);
    }
    // Also assert the RL-8 heading is present (it is the echo)
    expect(md).toMatch(/^##\s+RL-8\s+—\s+Cross-domain work is a different skill/m);
  });

  it("(d) red lines RL-1, RL-2, RL-5, RL-7 appear as ## RL-N headings in karpathy 4-section form", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    const requiredRedLines = [
      "## RL-1",
      "## RL-2",
      "## RL-5",
      "## RL-7",
    ];
    for (const heading of requiredRedLines) {
      expect(md, `missing red line heading: ${heading}`).toMatch(
        new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+—`, "m"),
      );
    }
  });

  it("(e) audit block mentions 5 specific verification commands", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    // Pull out the Audit section body
    const auditMatch = md.match(
      /^##\s+Audit[^\n]*\n([\s\S]*?)(?=^##\s+)/m,
    );
    expect(auditMatch).not.toBeNull();
    if (auditMatch) {
      const body = auditMatch[1]!;
      // The 5 verification lines (the spec's verbatim audit block)
      const expectedLines = [
        "cat .peaks/content/drafts/<slug>.md",
        "git status .peaks/content/",
        "cat .peaks/content/archive/<channel>/<slug>-<version>.md",
        "loop-engineering-guidelines.md -c \"RL-1|RL-5|RL-7\"",
        "crystallization-event.json",
      ];
      for (const line of expectedLines) {
        expect(body, `missing audit verification: ${line}`).toContain(line);
      }
    }
  });

  it("references .peaks/standards/loop-engineering-guidelines.md (RL-8 contract)", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md).toContain(".peaks/standards/loop-engineering-guidelines.md");
  });

  it("declares itself a non-code / content-domain orchestrator (does NOT import peaks-code)", () => {
    const md = readFileSync(SKILL_PATH, "utf-8");
    expect(md).toMatch(/content-domain/i);
    expect(md).toMatch(/does NOT import peaks-code/i);
  });
});
