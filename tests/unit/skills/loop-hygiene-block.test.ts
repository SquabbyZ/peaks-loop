import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
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
function skillFiles(): string[] {
  return execSync('find skills -name SKILL.md', { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((l) => l.length > 0);
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

  it('tells the MAIN session that a gate denial is not a broken tool', () => {
    // Fact-Forcing-Gate guidance previously reached only sub-agents, via
    // `buildDispatchSystemPrompt`. The interactive main session — where the
    // user actually hits the denial — never received it, and read the denial
    // as "the edit tool is broken" rather than "read the file first".
    const block = extractBlock(readFileSync(files[0]!, 'utf8')) ?? '';
    expect(block).toContain('Read before you edit');
    expect(block).toContain('.peaks/**');
    // The three claims that stop the misread.
    expect(block).toMatch(/denial is not a failure/i);
    expect(block).toMatch(/was not applied/i);
    expect(block).toMatch(/retry the same operation/i);
  });
});
