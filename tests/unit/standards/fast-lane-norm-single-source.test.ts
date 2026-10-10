// tests/unit/standards/fast-lane-norm-single-source.test.ts
//
// Two fast lanes need the same two statements: what counts as "done" for a fast
// lane, and when a task is not a fast-lane task. Those statements live once, in
// fast-lane-norm.md.
//
// The guard has to be a TREE walk, not a check of the one file that used to
// carry the text. An earlier version of this test asserted only that
// fast-mode.md no longer restates the gate — while the norm's own prose claimed
// "if you find a second copy of either one, this test fails on it". It did not:
// any other file could restate either statement and the suite stayed green. A
// claim stronger than the code is the defect the norm exists to prevent, so the
// guard and the claim were brought back into line.
//
// The comparison is against the walked file list, so a new file that copies
// either statement fails here without anyone remembering to add it.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const NORM = 'skills/peaks-code/references/fast-lane-norm.md';
const GATE = 'test pass + tsc pass + lint pass';
// The norm's own heading for the second statement. A copy of the risk list that
// keeps this heading fails here; a copy that renames it is not caught, which is
// why the norm states what is actually asserted rather than claiming more.
const RISK_HEADING = 'When a task is not a fast-lane task';

/** Walk with `fs`, never `execSync('find …')` — that resolves to Windows' find.exe. */
function markdown(roots: readonly string[]): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.md')) out.push(full.replace(/\\/g, '/'));
    }
  };
  for (const root of roots) walk(root);
  return out.sort();
}

// Walks `skills/` — the shipped surface an LLM actually loads. The design
// record under `docs/` keeps its own quotes of the gate, because a design doc
// has to name what it specifies; that is a documentation-drift concern, not the
// lane-drift this guard is for.
const FILES = markdown(['skills']);
const stating = (needle: string): string[] =>
  FILES.filter((file) => readFileSync(file, 'utf8').includes(needle));

describe('the fast-lane norm is single-sourced', () => {
  it('the tree walk found files to check', () => {
    // Guards the guard: a broken walk would make every assertion below vacuous.
    expect(FILES.length).toBeGreaterThan(20);
    expect(FILES).toContain(NORM);
  });

  it('the gate sentence appears exactly once, in the norm', () => {
    expect(stating(GATE)).toEqual([NORM]);
  });

  it('no file other than the norm carries the risk-list heading', () => {
    expect(stating(RISK_HEADING)).toEqual([NORM]);
  });

  it('the norm states only what this test asserts', () => {
    // The norm may not claim a guard this file does not provide.
    const norm = readFileSync(NORM, 'utf8');
    expect(norm).toContain('every markdown file under skills/');
  });

  it('the norm says the rules are unenforced, not that the document is inert', () => {
    // The document IS pinned — by this test. Claiming otherwise would invite a
    // contributor to delete a file the suite depends on.
    const norm = readFileSync(NORM, 'utf8').toLowerCase();
    expect(norm).toContain('nothing enforces the rules stated here');
    expect(norm).toContain('the document itself is pinned by a test');
  });
});
