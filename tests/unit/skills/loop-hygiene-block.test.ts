import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';

const MARKER = '<!-- peaks:loop-hygiene';
const END_MARKER = '<!-- /peaks:loop-hygiene -->';

/**
 * Every skill must carry the loop-hygiene block, and every copy must be
 * byte-identical.
 *
 * The obligation it encodes ("auto-compact is the skill's own action; the
 * skill header is shown every turn") was previously written into exactly
 * ONE of 22 skills — `peaks-code` — and the other 21 never received it.
 * A rule that only reaches one skill is not a rule.
 *
 * Byte-identity is the point: 22 hand-maintained copies drift, and a
 * drifted copy is how the contract quietly stops applying to whichever
 * skill fell behind. Edit one, edit all 22; this test is what makes that
 * non-optional.
 */
/**
 * Walk with `fs`, never `execSync('find …')`.
 *
 * `execSync` runs through the platform shell: on Windows that is `cmd.exe`,
 * where `find` resolves to `System32\find.exe` — a completely different
 * program, which rejects `-name` outright (`FIND: Parameter format not
 * correct`). It passed on the developer's machine only because Git Bash's
 * `find` happened to win on PATH there. CI caught it on the first push.
 */
function skillFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'SKILL.md') found.push(full);
    }
  };
  walk('skills');
  return found.sort();
}

/**
 * Extract the block by its explicit delimiters.
 *
 * Delimiters, not "up to the next `## ` heading": what follows the block
 * differs per skill (a blockquote, an h1, prose), so a heading-based
 * boundary reports drift that is not drift — it failed on the first run
 * for exactly that reason.
 */
function extractBlock(src: string): string | null {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => l.startsWith(MARKER));
  if (start === -1) return null;
  const end = lines.indexOf(END_MARKER, start);
  if (end === -1) return null;
  return lines.slice(start, end + 1).join('\n');
}

describe('loop-hygiene block in every SKILL.md', () => {
  const files = skillFiles();

  it('finds the whole skill set', () => {
    expect(files.length).toBeGreaterThanOrEqual(22);
  });

  it('every skill carries the block', () => {
    const missing = files.filter((f) => !readFileSync(f, 'utf8').includes(MARKER));
    expect(missing).toEqual([]);
  });

  it('every copy is byte-identical (no drift)', () => {
    const blocks = files.map((f) => ({ f, block: extractBlock(readFileSync(f, 'utf8')) }));
    const reference = blocks[0]?.block ?? '';
    expect(reference.length).toBeGreaterThan(0);
    const drifted = blocks.filter((b) => b.block !== reference).map((b) => b.f);
    expect(drifted).toEqual([]);
  });

  it('names the runtime carrier and the self-invoke command', () => {
    const block = extractBlock(readFileSync(files[0]!, 'utf8')) ?? '';
    // The carrier: the per-turn call whose envelope holds the verdict.
    expect(block).toContain('peaks skill presence --json');
    // The action: the SKILL runs it itself.
    expect(block).toContain('peaks code auto-compact');
    // The scope: all modes, not 24h-only.
    expect(block).toContain('every');
    // The header must be every-turn, not first-turn-only.
    expect(block).toContain('Peaks-Loop Skill');
  });

  it('every SKILL.md has frontmatter that parses as YAML', () => {
    // Two skills shipped invalid frontmatter for several releases: an
    // unquoted `schemaVersion: 2` inside a value made the document fail with
    // "Nested mappings are not allowed in compact mappings". Claude Code
    // falls back to the first line after the closing `---` when frontmatter
    // will not parse, so their `description` was NEVER loaded and neither
    // skill was discoverable by it. The fallback is what hid the defect: it
    // rendered the next heading, which read as a title rather than as damage.
    const broken: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(src);
      if (m === null) {
        broken.push(`${f} (no frontmatter)`);
        continue;
      }
      try {
        const parsed = parseYaml(m[1]) as { name?: unknown; description?: unknown } | null;
        if (typeof parsed?.description !== 'string' || parsed.description.length === 0) {
          broken.push(`${f} (no usable description)`);
        }
      } catch (err) {
        broken.push(`${f} (${(err as Error).message.split('\n')[0]})`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('tells the MAIN session that a gate denial is not a broken tool', () => {
    // Fact-Forcing-Gate guidance previously reached only sub-agents, via
    // `buildDispatchSystemPrompt`. The interactive main session — where the
    // user actually hits the denial — never received it, and read the denial
    // as "the edit tool is broken" rather than as a routine speed bump.
    const block = extractBlock(readFileSync(files[0]!, 'utf8')) ?? '';
    // Line wrapping is a formatting detail; assert across it.
    const flat = block.replace(/\s+/g, ' ');

    expect(flat).toContain('Read before you edit');
    expect(flat).toContain('.peaks/**');

    // The mechanism, stated correctly. The gate denies the FIRST touch of a
    // path and marks it; reading does NOT prevent the denial. An earlier
    // revision of this block claimed "skipping that read trips the gate",
    // which is false — the gate never looks at whether anything was read.
    expect(flat).toMatch(/denies the FIRST edit/i);
    expect(flat).toMatch(/reading does NOT prevent it/i);

    // The three claims that stop the misread.
    expect(flat).toMatch(/denial is not a failure/i);
    expect(flat).toMatch(/was NOT applied/i);
    expect(flat).toMatch(/retry the SAME operation/i);
    expect(flat).toMatch(/the retry is allowed/i);
  });
});
