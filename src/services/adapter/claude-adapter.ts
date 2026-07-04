import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { Adapter, AdapterEnvelope, AdapterSegment } from "./adapter.js";

export class ClaudeAdapter implements Adapter {
  readonly name = "claude" as const;
  constructor(private readonly opts: { home: string }) {}

  async detect(): Promise<boolean> {
    return true; /* Claude is the default; ship this slice first */
  }

  async resolveScratchDir(beeName: string): Promise<string> {
    return join(this.opts.home, ".claude", "skills", `peaks-bee-${beeName}.peaks-generated`);
  }

  async materialize(
    beeName: string,
    env: AdapterEnvelope,
    segments: AdapterSegment[],
  ): Promise<string> {
    const dir = await this.resolveScratchDir(beeName);
    if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frontmatter = `---\nname: peaks-bee-${beeName}\ndescription: peaks-loop generated bee ${beeName} — see local SkillHub for source\n---\n\n`;
    const body = `${env.preamble}\n\n` + segments.map((s) => s.skillMd).join("\n\n");
    writeFileSync(join(dir, "SKILL.md"), frontmatter + body);
    mkdirSync(join(dir, "scripts"), { recursive: true });
    for (const s of segments) {
      for (const sc of s.scripts) writeFileSync(join(dir, "scripts", sc.name), sc.content);
    }
    return dir;
  }

  async publish(scratchDir: string): Promise<string> {
    return scratchDir;
  }
  async activate(_scratchDir: string): Promise<void> {
    /* no-op; runtime picks up by convention */
  }
  async cleanup(scratchDir: string): Promise<void> {
    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true });
  }
}
