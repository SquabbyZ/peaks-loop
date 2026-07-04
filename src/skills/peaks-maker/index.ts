// src/skills/peaks-maker/index.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function parseFrontmatter(md: string): { name: string; description: string; body: string } {
  const m = md.match(/^---\n([\s\S]+?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("peaks-maker SKILL.md is missing YAML frontmatter");
  const fm: Record<string, string> = {};
  for (const line of m[1]!.split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: fm.name!, description: fm.description!, body: m[2]! };
}

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, "SKILL.md"), "utf-8");
export const peaksMakerManifest = parseFrontmatter(md);