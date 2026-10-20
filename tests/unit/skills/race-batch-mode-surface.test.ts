// tests/unit/skills/race-batch-mode-surface.test.ts
//
// The batch mode's only user-visible surface.
//
// Six tasks built the mechanism; none of them touched the file the user
// actually reads when they invoke the lane. Without a section there, "what
// counts as a batch", "when the lane takes the batch path" and "what leaves
// the batch" live in a plan document only, and the lane has no entry point
// the user can see.
//
// THE LIMITS OF THIS GUARD, stated because an unstated limit reads as a
// guarantee the guard does not make:
//
//   - It is a DOCUMENT guard. It proves the shipped prose states the four
//     things; it cannot prove the prose means what it says.
//   - It pins LITERALS, so a section rewritten around the same literals
//     passes and a section reworded past them fails. That is the same deal
//     the lane's existing prose guards make (race-lane-phase-gate.test.ts).
//   - It does not read the implementation. The mechanism is the batch
//     services under `src/services/batch/`; where the code and this section
//     disagree, the code is right and the section is stale.
//
// Dimensions covered:
//   - behavior: the four statements the section has to make, and their order
//   - a11y:     the section points at the risk list instead of restating it,
//               and does not restate the acceptance gate either

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SKILL_PATH = 'skills/peaks-race-code/SKILL.md';
const HYGIENE_END = '<!-- /peaks:loop-hygiene -->';
/** The batch section's heading. The Chinese name is the one the plan names. */
const BATCH_HEADING = /^##\s+.*批量.*$/m;

function skillText(): string {
  return readFileSync(SKILL_PATH, 'utf8');
}

/**
 * The batch section, from its heading to the next `## ` heading.
 *
 * Scoped to the section on purpose: an assertion over the whole file would
 * pass on a sentence that belongs to a different section, and the point of
 * this guard is that ONE section carries the four statements.
 */
function batchSection(): string {
  const lines = skillText().split('\n');
  const start = lines.findIndex((l) => BATCH_HEADING.test(l));
  if (start === -1) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

/** Line wrapping is a formatting detail; assert across it. */
function flat(): string {
  return batchSection().replace(/\s+/g, ' ');
}

/** The bold labels of the numbered phase list, in document order. */
function phaseLabels(): string[] {
  return [...batchSection().matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1] ?? '');
}

describe('race-code SKILL.md declares the batch mode', () => {
  it('when the skill is read, should carry a batch-mode section', () => {
    expect(skillText()).toMatch(BATCH_HEADING);
    expect(batchSection().length).toBeGreaterThan(0);
  });

  it('when the batch section is added, should sit after the loop-hygiene block', () => {
    // The hygiene block is hand-maintained and byte-identical in every
    // SKILL.md; a section inserted above it would either displace it or make
    // the copies drift.
    const text = skillText();
    const hygiene = text.indexOf(HYGIENE_END);
    const heading = text.search(BATCH_HEADING);
    expect(hygiene).toBeGreaterThan(-1);
    expect(heading).toBeGreaterThan(hygiene);
  });

  it('when batch mode engages, should require two or more mutually independent items', () => {
    const f = flat();
    expect(f).toMatch(/two or more|at least two/i);
    expect(f).toMatch(/independent/i);
  });

  it('when only one item is given, should take exactly the single-task path', () => {
    // The zero-cost guarantee: N=1 must cost nothing. The three things that
    // must NOT happen on the single path are the whole mechanism, so they
    // are named one by one.
    const f = flat();
    expect(f).toMatch(/one item/i);
    expect(f).toMatch(/single-task path/i);
    expect(f).toMatch(/no diagnosis/i);
    expect(f).toMatch(/no rule pre-read/i);
    expect(f).toMatch(/no topology/i);
  });

  it('when the batch runs, should name the four phases in order', () => {
    const labels = phaseLabels();
    expect(labels).toHaveLength(4);
    expect(labels[0]).toMatch(/diagnosis/i);
    expect(labels[1]).toMatch(/topology/i);
    expect(labels[2]).toMatch(/fix/i);
    expect(labels[3]).toMatch(/verif/i);
  });

  it('when the diagnosis phase runs, should forbid Edit / Write / MultiEdit', () => {
    const f = flat();
    expect(f).toMatch(/read-only/i);
    expect(f).toContain('Edit');
    expect(f).toContain('Write');
    expect(f).toContain('MultiEdit');
    expect(f).toMatch(/forbidden|MUST NOT|may not|does not/i);
  });

  it('when an item hits a risk surface, should be pulled out of the batch onto the single-task path', () => {
    const f = flat();
    expect(f).toMatch(/fast-lane-norm\.md/);
    expect(f).toMatch(/§\s*2|section 2/i);
    expect(f).toMatch(/pulled out|comes out|takes the single-task path/i);
  });

  it('when the risk list is at stake, should point at the norm rather than restate it', () => {
    // A second copy of the risk list is the drift the norm exists to
    // prevent, so the rows are absent by the wording the norm itself uses.
    // The section has to exist first: "no rows here" is also what an absent
    // section says, and that reading is not a pass.
    expect(batchSection().length).toBeGreaterThan(0);
    const f = flat();
    expect(f).not.toMatch(/authn/i);
    expect(f).not.toMatch(/database schema/i);
    expect(f).not.toMatch(/migrations/i);
    expect(f).not.toMatch(/concurrency/i);
    expect(f).not.toMatch(/dependency upgrades/i);
    expect(f).not.toContain('When a task is not a fast-lane task');
  });

  it('when the acceptance gate is mentioned, should point at the norm rather than restate it', () => {
    expect(batchSection().length).toBeGreaterThan(0);
    expect(batchSection()).not.toContain('test pass + tsc pass + lint pass');
  });
});
