// tests/unit/runtime/vendor-neutral-identity-guard-ac1.test.ts
//
// AC-1 (vendor VERB strings) split out of `vendor-neutral-identity-guard.test.ts`
// for the C wave 7 file-size split (rid 2026-10-01-c-wave7-excess-w7-4), doc block
// and all four cases moved VERBATIM. It is a separate file because it is a
// separate SUBJECT: the identity guard asks which IDE an id LITERAL decides, AC-1
// asks which vendor's VERB string a module names. They were one file because both
// are the same property — "vendor knowledge lives in the adapter layer" — applied
// to different shapes, and they still read together: the verb check runs over the
// SAME scanned tree (`SCAN`, built once in
// `vendor-neutral-identity-guard-shapes.ts` from the walk in
// `vendor-neutral-identity-guard-reach.ts`), and its scope is narrower on purpose
// (`VERB_ALLOWED_DIRS` names the adapter IMPLEMENTATIONS, not all of
// `src/services/ide/`).
//
// What this file does NOT catch is stated in the block below, moved with it: a
// verb assembled at runtime, verbs other than the three in `VENDOR_VERBS`,
// anything outside the scanned roots, and nothing about whether an allowed
// adapter's verb is CORRECT.

//
// ---------------------------------------------------------------------------
// AC-1 (vendor VERB strings) is enforced here too, in the same file, because
// both checks are the same property ("vendor knowledge lives in the adapter
// layer") applied to different shapes and they must be read together.
//
// AC-1's own scope was widened from `src/services/code/` to all of `src/` in
// this slice, and it could not stay a text grep: over `src/` the raw grep
// returns 13, of which 12 are COMMENTS quoting the verb (including AC-1's own
// doc block) and 1 is `compactCommand: 'claude --compact'` in the adapter
// that owns it. So the verb check below is also AST-based — it looks only at
// string literals and template literals, never at comments.
//
// What the AC-1 check does NOT catch:
//   a. A verb assembled at runtime — `'claude' + ' --compact'`, a template
//      with an interpolated binary name, a value read from config. Only
//      literal text is inspected.
//   b. VERBS OTHER THAN COMPACT. The three literals below are the set AC-1
//      names; a new vendor verb (`codex exec`, ...) is invisible until it is
//      added to `VENDOR_VERBS`, which is a deliberate edit in the guard.
//   c. Anything outside `src/**/*.ts` — same limit as check 4 above.
//   d. It asserts nothing about whether an allowed adapter's verb is
//      CORRECT; that is the adapter's own concern (and its own tests).

import { describe, it, expect } from 'vitest';
import { parseSourceFile, relativeToRoot } from './vendor-neutral-identity-guard-reach.js';
import {
  findVendorVerbLiterals,
  SCAN,
  VERB_ALLOWED_DIRS
} from './vendor-neutral-identity-guard-shapes.js';

describe('AC-1 — vendor verb strings live only in adapter implementations', () => {
  it('finds no vendor verb string outside the adapter implementations', () => {
    const unexpected = SCAN.verbLiterals
      .filter((hit) => !VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir)))
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${JSON.stringify(hit.verb)}`);
    expect(unexpected).toEqual([]);
  });

  it('the adapter implementation that owns the verb still carries it (anti-silence)', () => {
    // Pins the count in the ALLOWED side too: if the verb check silently
    // stopped recognising literals, the assertion above would go vacuously
    // green.
    //
    // PINNED BY PROPERTY, NOT BY COORDINATE (B1). This assertion used to read
    // `claude-code-adapter.ts:585`, and it broke TWICE inside a single slice
    // (585 → 618) — both times fixed by mechanically editing the number. An
    // assertion repaired by editing a number stops being read: the person who
    // edits it never asks why it moved, and after a few rounds it guards
    // nothing. A line number is not a property of "the verb lives in the
    // adapter that owns it"; these two are:
    //
    //   1. exactly ONE verb literal exists anywhere in the scanned tree, and
    //   2. the file carrying it is `claude-code-adapter.ts` — an ADAPTER
    //      IMPLEMENTATION, i.e. inside one of `VERB_ALLOWED_DIRS`.
    //
    // Both halves of the old value are kept and neither is a coordinate: a
    // second occurrence in the SAME file (the defect a line pin was supposed
    // to catch) makes the array two elements long and fails, exactly as a
    // second occurrence in any other file does.
    const allowed = SCAN.verbLiterals.filter((hit) =>
      VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir))
    );
    expect(SCAN.verbLiterals, 'more than one vendor verb literal in the tree').toHaveLength(1);
    expect(allowed, 'the one verb literal is not in an adapter implementation').toHaveLength(1);
    expect(allowed.map((hit) => relativeToRoot(hit.file))).toEqual([
      'src/services/ide/adapters/claude-code-adapter.ts'
    ]);
  });

  it('negative control — a verb in a COMMENT is not a violation (this is why AC-1 is not a grep)', () => {
    // The raw grep over `src/` returns 13; 12 of those are lines exactly
    // like these. Prose is not a decision.
    const fixture = [
      '// AC-1: `rg -n "claude --compact|codex --compact|copilot compact"`',
      '/**',
      ' * heavy lifting (ratio probe + in-band `claude --compact` spawn)',
      ' */',
      'const banner = `run copilot compact to compact`;'
    ].join('\n');
    // Lines 1-4 are comments (line + block) → invisible. Line 5 is a REAL
    // template literal and IS a hit: a template can be an executed command,
    // so it is inspected like any other literal.
    expect(
      findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => h.line)
    ).toEqual([5]);
  });

  it('negative control — a verb assembled at runtime is NOT flagged (check limit a)', () => {
    // Pinned so nobody reads the check above as "verbs cannot escape".
    const fixture = ["const binary = 'claude';", 'const cmd = `${binary} --compact`;'].join('\n');
    expect(findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });
});
