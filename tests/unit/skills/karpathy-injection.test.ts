// tests/unit/skills/karpathy-injection.test.ts
//
// AC-6 of slice 2026-09-17-4-0-51-cleanup: peaks-code SKILL.md commits
// "Every sub-agent dispatch (peaks-prd, peaks-rd, peaks-qa, peaks-ui,
// peaks-sc, peaks-txt) MUST receive the 4 Karpathy guidelines" —
// verbatim, per `andrej-karpathy-skills:karpathy-guidelines`.
//
// ---------------------------------------------------------------------------
// 2026-09-18 (slice D2) — this file used to be a FALSE PIN and was rewritten.
//
// What it asserted: `REQUIRED_BEES = [peaks-prd, peaks-rd, peaks-qa]`, and
// for each, "at least one .md under that bee's dir contains the substring
// 'Karpathy'" (case-insensitive).
//
// Why that proved nothing: two of the three passed purely because a ROLE
// NAME contains the substring —
//   peaks-prd: `karpathy-reviewer` (SKILL.md:125) + `karpathySelfCheck` (:165)
//   peaks-qa : `karpathy-review`   (SKILL.md:107)
// Neither is the 4-guideline injection the rule is about. Deleting the
// injection block entirely would have left all 4 cases green.
//
// Second defect: the 3-bee list was reverse-engineered from a grep of the bee
// directories, while the rule it claims to guard names SIX bees. Narrowing
// the assertion to match the tree froze the rule and its guard in permanent
// disagreement — the guard could no longer detect the rule being weakened.
//
// The real contract (and how it is pinned now): the injection has ONE
// canonical payload — the verbatim block in
// `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md`
// §"Karpathy-guidelines context" — which `skills/peaks-code/SKILL.md`
// §"Karpathy guidance" tells the orchestrator to append to every dispatch
// prompt. The bees receive it AT DISPATCH TIME from that block; no bee's own
// SKILL.md is a carrier, so asserting per-bee bodies was always the wrong
// object. The original (deleted) guard
// `tests/unit/skills/karpathy-prompt-injection.test.ts` pinned exactly these
// layers as A/B/C/D; this file re-pins the same four layers against today's
// tree, plus the 6-bee scope of the rule itself.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..');

/** The four guideline titles. A layer that claims to carry the injection
 *  must carry all four — one title is enough to be a false positive, the
 *  set of four is the payload. */
const FOUR_TITLES = [
  'Think Before Coding',
  'Simplicity First',
  'Surgical Changes',
  'Goal-Driven Execution'
] as const;

/** Layer A — the RD bee's own enforcement section. */
const LAYER_A = join(repoRoot, 'skills', 'bee', 'peaks-rd', 'SKILL.md');
/** Layer B — the canonical verbatim block, injected into every dispatch. */
const LAYER_B = join(
  repoRoot,
  'skills',
  'bee',
  'peaks-rd',
  'references',
  'rd-sub-agent-dispatch.md'
);
/** Layer C — the pointer callout on the RD fan-out contract. */
const LAYER_C = join(repoRoot, 'skills', 'bee', 'peaks-rd', 'references', 'rd-fanout-contracts.md');
/** Layer D — the orchestrator-side rule + canonical skill id. */
const LAYER_D = join(repoRoot, 'skills', 'peaks-code', 'SKILL.md');

/** Canonical skill id: where the full 4-item text lives. */
const CANONICAL_ID = 'andrej-karpathy-skills:karpathy-guidelines';

/** The six bees `skills/peaks-code/SKILL.md` §"Karpathy guidance" commits to
 *  giving the 4 guidelines. HARDCODED on purpose: deriving it from SKILL.md
 *  would make the assertion tautological, so narrowing the rule to three bees
 *  (the frozen state this rewrite removes) would silently pass. */
const RULE_BEES = [
  'peaks-prd',
  'peaks-rd',
  'peaks-qa',
  'peaks-ui',
  'peaks-sc',
  'peaks-txt'
] as const;

const read = (path: string): string => readFileSync(path, 'utf8');

/** Extract the body of a `## <heading...>` section, up to the next `## `. */
function section(body: string, heading: string): string {
  const start = body.indexOf(heading);
  expect(start, `section '${heading}' must exist`).toBeGreaterThanOrEqual(0);
  const rest = body.slice(start + heading.length);
  const end = rest.indexOf('\n## ');
  return end === -1 ? rest : rest.slice(0, end);
}

describe('Karpathy guidelines injection — AC-6 coverage', () => {
  it('Layer A: peaks-rd/SKILL.md has "## Karpathy enforcement" carrying all 4 titles', () => {
    const body = read(LAYER_A);
    const sectionBody = section(body, '## Karpathy enforcement');
    for (const title of FOUR_TITLES) {
      expect(sectionBody, `Layer A must carry "${title}"`).toContain(title);
    }
  });

  it('Layer B: the canonical block carries all 4 titles + the verbatim signature phrases', () => {
    const body = read(LAYER_B);
    const sectionBody = section(body, '## Karpathy-guidelines context');
    for (const title of FOUR_TITLES) {
      expect(sectionBody, `Layer B must carry "${title}"`).toContain(title);
    }
    // Verbatim phrases from the guidelines text — the payload, not a pointer.
    // Prose paraphrases would drop these; the block is injected verbatim.
    expect(sectionBody).toContain("Don't assume. Don't hide confusion. Surface tradeoffs");
    expect(sectionBody).toContain('Minimum code that solves the problem');
    expect(sectionBody).toContain('Touch only what you must. Clean up only your own mess');
    expect(sectionBody).toContain('Define success criteria. Loop until verified');
    // The block is the canonical injection SOURCE — it must say so.
    //
    // CORRECTED 2026-10-13, kept visible rather than edited away. This note
    // used to end: "Measured 2026-09-18: no `src/**` code injects this block …
    // So unlike the Test Tool Detection block ("machine-injected, not a prompt
    // ritual"), this one is a prompt-ritual obligation. Wiring it changes
    // dispatch behaviour and is recorded as a user decision, not done here."
    // Both sentences were true when written and are false now:
    // `src/services/dispatch/karpathy-block.ts` holds the machine copy of this
    // block and `composeDispatchPrompt`
    // (`src/cli/commands/dispatch-prompt-composition.ts`) runs
    // `ensureKarpathyBlock` over the assembled prompt, so the obligation has an
    // executor on the `peaks sub-agent dispatch` path.
    // `tests/unit/services/dispatch/karpathy-block.test.ts` asserts the
    // delivery behaviour AND the byte-equality of this file's fenced block with
    // that constant — the two copies cannot drift.
    //
    // What this assertion still pins is the block's own STATEMENT of the
    // obligation, which remains the contract for the paths that do NOT go
    // through the composer: `--from-dag` and `--mode detached` inject no
    // Karpathy block.
    expect(sectionBody).toContain('MUST be appended to the sub-agent prompt verbatim');
  });

  it('Layer B is the canonical home: the block carries the canonical skill id', () => {
    expect(read(LAYER_B)).toContain(CANONICAL_ID);
  });

  it('Layer C: the RD fan-out contract points at the canonical block', () => {
    const body = read(LAYER_C);
    expect(body, 'Layer C must carry the Karpathy pointer').toContain('Karpathy pointer');
    expect(body).toContain(CANONICAL_ID);
    expect(body, 'Layer C must name the block it points at').toContain(
      'Karpathy-guidelines context'
    );
    // The pointer sits on the fan-out contract, so the 3 sub-agent slots it
    // describes must still be the 3 the pointer claims to cover.
    expect(body).toContain('Sub-agent 1 — code-reviewer');
    expect(body).toContain('Sub-agent 2 — qa-test-cases-writer');
    expect(body).toContain('Sub-agent 3 — karpathy-reviewer');
  });

  it('Layer D: peaks-code/SKILL.md names the canonical block + the canonical id', () => {
    const body = read(LAYER_D);
    const sectionBody = section(body, '## Karpathy guidance');
    expect(sectionBody).toContain('Karpathy-guidelines context');
    expect(sectionBody).toContain(CANONICAL_ID);
    expect(sectionBody).toContain('MUST receive the 4 Karpathy guidelines');
  });

  it('the dispatch rule covers all six bees named by the rule (not a narrowed subset)', () => {
    const sectionBody = section(read(LAYER_D), '## Karpathy guidance');
    for (const bee of RULE_BEES) {
      expect(sectionBody, `the dispatch rule must still cover ${bee}`).toContain(`\`${bee}\``);
    }
  });
});
