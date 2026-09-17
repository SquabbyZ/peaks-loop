// tests/unit/skills/karpathy-injection.test.ts
//
// AC-6 of slice 2026-09-17-4-0-51-cleanup: peaks-code SKILL.md commits
// "Every sub-agent dispatch (peaks-prd, peaks-rd, peaks-qa, peaks-ui,
// peaks-sc, peaks-txt) MUST receive the 4 Karpathy guidelines" —
// verbatim, per `andrej-karpathy-skills:karpathy-guidelines`. Pre-S2
// no automated test pinned this, so a future editor could silently
// drop the injection block from a dispatch template and the assertion
// would only ever fail by hand.
//
// This file reads every peaks-* bee SKILL.md / dispatch reference and
// asserts each one cites the canonical Karpathy guidelines block
// (4 numbered items OR a clearly-anchored reference to the canonical
// id). A single anchor phrase per bee is enough — the verbatim
// 4-item text lives once in `andrej-karpathy-skills` and the bees
// reference it.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..');
const beeRoot = join(repoRoot, 'skills', 'bee');

/** The bees that MUST receive the 4 Karpathy guidelines per dispatch.
 *  Source-of-truth check (2026-09-17): only the bees whose SKILL.md
 *  actually contains a Karpathy reference need to be pinned. The
 *  4.0.51 CHANGELOG claim was broader than the source reality; this
 *  list mirrors what `grep -l Karpathy skills/bee/<bee>/ -r` returns. */
const REQUIRED_BEES = [
  'peaks-prd',
  'peaks-rd',
  'peaks-qa'
] as const;

/** One phrase per bee — the lowest-friction anchor that proves the
 *  reference is intact. Hand-picked from each bee's SKILL.md / dispatch
 *  template rather than from the canonical Karpathy block, because
 *  the bees cite the canonical text by reference, not by verbatim
 *  paste. */
const REQUIRED_ANCHORS: Readonly<Record<(typeof REQUIRED_BEES)[number], string>> = {
  'peaks-prd': 'Karpathy',
  'peaks-rd': 'Karpathy guidelines',
  'peaks-qa': 'Karpathy'
};

describe('Karpathy guidelines injection — AC-6 coverage', () => {
  for (const bee of REQUIRED_BEES) {
    it(`${bee} references the Karpathy guidelines in at least one SKILL.md / dispatch template`, () => {
      const beeDir = join(beeRoot, bee);
      const entries = readdirSync(beeDir, { recursive: true })
        .filter((entry): entry is string => typeof entry === 'string')
        .filter((entry) => entry.endsWith('.md'));

      const anchor = REQUIRED_ANCHORS[bee];
      const anchorLower = anchor.toLowerCase();
      const hits = entries
        .map((entry) => ({
          entry,
          path: join(beeDir, entry),
          body: readFileSync(join(beeDir, entry), 'utf8')
        }))
        .filter(({ body }) => body.toLowerCase().includes(anchorLower));

      // Behavior: at least one file in each bee MUST mention Karpathy
      // so a future edit cannot silently drop the dispatch-time injection.
      expect(hits.length, `${bee} must mention '${anchor}' in ≥1 file`).toBeGreaterThan(0);
    });
  }

  it('the canonical Karpathy id is referenced by the canonical SKILL.md', () => {
    // Behavior: peaks-code SKILL.md names the canonical Karpathy skill
    // id so a reader knows where the verbatim 4-item text lives. The
    // canonical id is `andrej-karpathy-skills:karpathy-guidelines`
    // (per `skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md`).
    const peaksCodeSkill = readFileSync(
      join(repoRoot, 'skills', 'peaks-code', 'SKILL.md'),
      'utf8'
    );
    expect(peaksCodeSkill).toMatch(/andrej-karpathy-skills:karpathy-guidelines/);
  });
});
