/**
 * The pruner's proof is the thing under test, not a side effect of it.
 *
 * A classifier that is 86% precise misinforms; a pruner that is 86% precise deletes
 * the wrong line. So every case here asks either "did it remove exactly what the
 * scan named" or "did it REFUSE where refusing is the correct answer" — and the
 * refusal cases are the point: an actuator with no brake prints a green result while
 * it corrupts a file.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { auditComments } from '~/src/services/comments/comment-audit';
import { planPrune, pruneComments, type PruneAction } from '~/src/services/comments/comment-prune';
import { proofViolations, pruneFileLines } from '~/src/services/comments/prune-apply';

let root = '';

function writeFixture(rel: string, text: string): void {
  const abs = join(root, rel);
  mkdirSync(abs.slice(0, abs.lastIndexOf('/')), { recursive: true });
  writeFileSync(abs, text);
}

const NARRATIVE = '// Slice 2026-10-04-comment-hygiene kept this on purpose.\n';
const DEAD = '// See `src/services/gone/referent.ts` for the shape.\n';

/** The ledger, as the assertions read it. `JSON.parse` alone is `any`. */
type Ledger = {
  applied: boolean;
  removed: { line: number; matched: string; mode: string }[];
  touchedFiles: string[];
};

function readLedger(path: string): Ledger {
  return JSON.parse(readFileSync(path, 'utf8')) as Ledger;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-prune-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('proofViolations: the check that gates every write', () => {
  const before = ['// a', 'const b = 1; // Slice 1 kept it', '// c'];
  const act = (
    line: number,
    mode: PruneAction['mode'],
    lineText: string,
    comment: string
  ): PruneAction => ({
    file: 'f.ts',
    line,
    kind: 'narrative',
    matched: 'm',
    mode,
    lineText,
    comment
  });

  it('passes on a plan it can account for, line for line', () => {
    const actions = [
      act(1, 'drop-line', '// a', '// a'),
      act(2, 'strip-trailing', 'const b = 1; // Slice 1 kept it', '// Slice 1 kept it')
    ];
    expect(proofViolations(before, ['const b = 1;', '// c'], actions)).toEqual([]);
  });

  it('names a line the plan never mentioned that came out different', () => {
    const actions = [act(1, 'drop-line', '// a', '// a')];
    expect(proofViolations(before, ['const b = 2; // Slice 1 kept it', '// c'], actions)).toEqual([
      'line 2: untouched line differs'
    ]);
  });

  it('names output that does not line up with the input at all', () => {
    const actions = [act(1, 'drop-line', '// a', '// a')];
    // Scrambled order AND a surplus line. Both are reported: a pruner that compared
    // only lengths would let a rewrite through as "same size".
    expect(
      proofViolations(before, ['// c', 'const b = 1; // Slice 1 kept it', 'surplus'], actions)
    ).toEqual([
      'line 2: untouched line differs',
      'line 3: untouched line differs',
      'produced 1 extra line(s)'
    ]);
  });

  it('refuses a strip whose kept text is not the code that was already there', () => {
    const actions = [act(2, 'strip-trailing', 'const b = 1; // x', '// x')];
    expect(proofViolations(before, ['// a', 'const b = 2;', '// c'], actions)).toEqual([
      'line 2: code text changed'
    ]);
  });

  it('refuses a strip that leaves a half-open literal, even though the prefix test passes', () => {
    // THE PROOF'S OWN BLIND SPOT, found by running the prune against the real tree.
    // Cutting `snippet: \`// a.ts\`` down to `snippet: \`` satisfies
    // `original.startsWith(kept)` — every truncation is a prefix — so the prefix test
    // alone cannot tell a revealed comment from a string cut in half, and it certified
    // a write that left an unterminated template literal in `src/`. What survives must
    // still be COMPLETE code, which is a different question from what it starts with.
    const openBefore = ['snippet: `// a.ts\\n// b.ts`,'];
    const actions = [act(1, 'strip-trailing', 'snippet: `// a.ts\\n// b.ts`,', '// a.ts\\n// b.ts`,')];
    const out = proofViolations(openBefore, ['snippet: `'], actions);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('line 1');
    expect(out[0]).toContain('unterminated');
  });
});

describe('planPrune: what it will and will not touch', () => {
  it('drops a whole comment line and strips only the comment of a code line', () => {
    writeFixture('src/a.ts', `${DEAD}export const a = 1; // Slice 2026-10-04-x names it\n`);
    const findings = auditComments({ projectRoot: root }).findings.filter(
      (f) => f.file === 'src/a.ts'
    );
    const { actions, skips } = planPrune({ projectRoot: root }, findings);
    expect(skips).toEqual([]);
    expect(actions.map((a) => a.mode)).toEqual(['drop-line', 'strip-trailing']);
    // The recorded comment is the comment, not the code in front of it — this is
    // what the first version compared against the whole line and got wrong.
    expect(actions[1]?.comment).toBe('// Slice 2026-10-04-x names it');
  });

  it('refuses a line that carries a block delimiter opening elsewhere', () => {
    // Deleting this line would leave ` * still inside */` as CODE — the one failure
    // that turns a comment prune into a compile error.
    writeFixture('src/b.ts', '/** Slice 2026-10-04-x opened here\n * still inside */\n');
    const findings = auditComments({ projectRoot: root }).findings.filter(
      (f) => f.file === 'src/b.ts'
    );
    expect(findings.length).toBeGreaterThan(0);
    const { actions, skips } = planPrune({ projectRoot: root }, findings);
    expect(actions).toEqual([]);
    expect(skips[0]?.reason).toBe('carries-a-block-delimiter');
  });

  it('refuses to act on a line that moved between the scan and the plan', () => {
    writeFixture('src/c.ts', DEAD);
    const stale = {
      file: 'src/c.ts',
      line: 1,
      kind: 'narrative',
      matched: 'slice-id',
      text: '// a different line entirely'
    } as const;
    const { actions, skips } = planPrune({ projectRoot: root }, [stale]);
    expect(actions).toEqual([]);
    expect(skips[0]?.reason).toBe('line-moved-since-scan');
  });
});

describe('pruneComments: dry-run by default, ledger on apply', () => {
  beforeAll(() => {
    writeFixture('src/d.ts', `const d = 1;\n${NARRATIVE}${DEAD}`);
  });

  it('writes nothing when apply is not set, and says what it would have done', () => {
    const result = pruneComments({ projectRoot: root, onlyFile: 'src/d.ts' });
    expect(result.applied).toBe(false);
    expect(result.planned).toBe(2);
    expect(readFileSync(join(root, 'src/d.ts'), 'utf8')).toBe(`const d = 1;\n${NARRATIVE}${DEAD}`);
    // The plan is still an artifact: a dry run a reviewer cannot re-read is a claim.
    expect(readLedger(result.ledgerPath)).toMatchObject({ applied: false });
    expect(readLedger(result.ledgerPath).removed).toHaveLength(2);
  });

  it('applies, leaves the code line standing, and records every removal', () => {
    const result = pruneComments({ projectRoot: root, onlyFile: 'src/d.ts', apply: true });
    expect(result.applied).toBe(true);
    expect(result.dropped).toBe(2);
    expect(result.touchedFiles).toEqual(['src/d.ts']);
    expect(readFileSync(join(root, 'src/d.ts'), 'utf8')).toBe('const d = 1;\n');
    const ledger = readLedger(result.ledgerPath);
    expect(ledger.removed.map((record) => record.line)).toEqual([2, 3]);
    expect(ledger.removed[0]?.matched).toContain('slice-id');
    expect(ledger.touchedFiles).toEqual(['src/d.ts']);
  });

  it('is idempotent: a second pass finds nothing left to remove', () => {
    const again = pruneComments({ projectRoot: root, onlyFile: 'src/d.ts', apply: true });
    expect(again.planned).toBe(0);
    expect(again.touchedFiles).toEqual([]);
  });

  it('takes one kind alone, which is how a narrow first run is made', () => {
    writeFixture('src/e.ts', `${NARRATIVE}${DEAD}`);
    const onlyDead = pruneComments({
      projectRoot: root,
      onlyFile: 'src/e.ts',
      kinds: ['dead-reference'],
      apply: true
    });
    expect(onlyDead.dropped).toBe(1);
    expect(readFileSync(join(root, 'src/e.ts'), 'utf8')).toBe(NARRATIVE);
  });

  it('keeps a code line whose trailing comment was the only finding', () => {
    const code = "export const url = 'https://example.com';\n";
    writeFixture('src/f.ts', `${code}export const n = 1; // Slice 2026-10-04-x trailing\n`);
    const result = pruneComments({ projectRoot: root, onlyFile: 'src/f.ts', apply: true });
    expect(result.stripped).toBe(1);
    expect(result.dropped).toBe(0);
    expect(readFileSync(join(root, 'src/f.ts'), 'utf8')).toBe(`${code}export const n = 1;\n`);
  });
});

describe('pruneFileLines: the blank a dropped comment orphans', () => {
  const drop = (line: number): PruneAction => ({
    file: 'f.ts',
    line,
    kind: 'narrative',
    matched: 'm',
    mode: 'drop-line',
    lineText: '',
    comment: '// alone'
  });

  it('takes the second blank with a comment that was the only thing separating two blanks', () => {
    // Found by applying the prune for real. `src/services/verdict/envelopes.ts` held
    //   };  /  blank  /  // … internal: AC-1 markdown parse  /  blank  /  type …
    // and dropping the comment joined the two blanks into a double blank, which raised
    // `prettierUnformatted` off its ceiling of 0 — and the generator refused to write the
    // baseline. The blank is the drop's residue, so the drop owns it; leaving it behind
    // would make a comment prune also a whitespace reformatter of code nobody asked about.
    const lines = ['};', '', '// alone', '', 'type X = 1;'];
    expect(pruneFileLines(lines, [drop(3)])).toEqual(['};', '', 'type X = 1;']);
  });

  it('leaves a double blank the run did not create exactly where it is', () => {
    // `[].every(…)` is true, so a rule written as "everything between was dropped" eats
    // pre-existing double blanks too. This arm is what caught that in the first version.
    const lines = ['};', '', '', 'const a = 1;', '// alone'];
    expect(pruneFileLines(lines, [drop(5)])).toEqual(['};', '', '', 'const a = 1;']);
  });

  it('leaves a lone blank beside the dropped comment alone', () => {
    // Still separating code from what follows — it is not residue.
    expect(pruneFileLines(['const a = 1;', '// alone', '', 'const b = 2;'], [drop(2)])).toEqual([
      'const a = 1;',
      '',
      'const b = 2;'
    ]);
  });

  it('the proof allows the collapse the writer performed, and refuses one it did not earn', () => {
    const lines = ['};', '', '// alone', '', 'type X = 1;'];
    const actions = [drop(3)];
    expect(proofViolations(lines, pruneFileLines(lines, actions), actions)).toEqual([]);
    // A blank removed WITHOUT being orphaned is still an edit the proof must refuse, and
    // it names every claim that stopped matching rather than only the first.
    const unearned = proofViolations(
      ['};', '', '// alone', 'type X = 1;'],
      ['};', 'type X = 1;'],
      actions
    );
    expect(unearned).toContain('line 2: untouched line differs');
    expect(unearned.length).toBeGreaterThan(0);
  });
});
