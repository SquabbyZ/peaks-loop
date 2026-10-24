// tests/unit/standards/bdd-test-style-contract-self-consistency.test.ts
//
// A guard on the SELF-CONSISTENCY of the BDD test-style contract's §1.1.
//
// THE DEFECT THIS LOCKS. §1.1 used to carry two claims at once:
//
//   - **Form**: `when X, should Y` — state the precondition …
//   - **Required word**: must include at least one of `when` or `should`.
//
// The first bullet reads as a HARD requirement (BOTH words), the second as the
// weak rule the verifier actually enforces (AT LEAST ONE). A reader cannot
// satisfy both readings at once, and the contract is a PUBLISHED artifact —
// `package.json#files` ships it and downstream projects read it with
// `import contract from 'peaks-loop/test-style'` — so the contradiction
// reached the LLM agents that write the tests.
//
// THE VERIFIER DECIDES THE WEAK ONE. `hasWhenOrShould`
// (`src/services/qa/bdd-test-style-contract.ts`) is `/(\bwhen\b|\bshould\b)/i`
// — at least one — and the failure reason code is `description-no-should-when`.
// §1.1 now says exactly that, and it names the checker, so the two cannot
// drift apart silently.
//
// WHY A GUARD, NOT A COMMENT. The contract is markdown: nothing compiles it,
// so a later edit could put the contradiction back and no test would notice.
// This file reads the REAL contract from disk — the text is never copied into
// the test, because a copy would guard the copy instead of the published file.
//
// Omitting the `a11y` dimension: this guard has no human-visible surface of its
// own — it emits no stdout, no exit code and no message outside a vitest
// assertion.

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const CONTRACT_REL = 'contracts/test-style-contract.md';

declareDimensions(
  'tests/unit/standards/bdd-test-style-contract-self-consistency.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'no user-facing surface: emits no stdout, exit code or message of its own'
    }
  ]
);

/** The combined form, as the contract writes it. */
const COMBINED_FORM = 'when X, should Y';

/** One statement that binds a REQUIREMENT to the combined form. */
interface HardRequirementRule {
  /** The shape of the statement. */
  readonly pattern: RegExp;
  /** Why the statement contradicts the rule the verifier enforces. */
  readonly why: string;
}

/**
 * The statements that make the combined form a hard requirement. Each one is
 * the wording the contract used to carry, or a near neighbour of it.
 */
const HARD_REQUIREMENT_RULES: readonly HardRequirementRule[] = [
  {
    pattern: /\*\*Form\*\*\s*:\s*`when X,\s*should Y`/i,
    why: 'the "**Form**: `when X, should Y`" bullet states the combined form as the rule'
  },
  {
    pattern: /\bmust\b[^.]{0,80}?`when X,\s*should Y`/i,
    why: 'a "must" binds to the combined `when X, should Y` form'
  },
  {
    pattern: /\bmust\b[^.]{0,80}?\bboth\b[^.]{0,80}?\b(?:when|should)\b/i,
    why: 'a "must" binds to BOTH `when` and `should`'
  },
  {
    pattern: /\brequired\b\s*:\s*`when X,\s*should Y`/i,
    why: 'the combined form is introduced as "Required:"'
  }
];

/** Wording that marks a statement as a preference rather than a requirement. */
const PREFERENCE_MARKERS =
  /\bpreferred\b|\bpreference\b|\bidiomatic\b|\bconventional\b|\bcustomary\b|\brecommend(?:ed)?\b|\bnot a requirement\b|\bnot enforced\b|\badvisory\b|\boptional\b/i;

/** The enforced rule: at least one of `when` or `should`. */
const STATES_THE_ENFORCED_RULE =
  /\b(?:must|required|shall)\b[^.]{0,80}?\bat least one\b[^.]{0,80}?\bwhen\b[^.]{0,80}?\bshould\b/i;

/** The checker's own names — §1.1 must point at one of them. */
const NAMES_THE_VERIFIER = /hasWhenOrShould|description-no-should-when/;

/** One self-consistency invariant of the contract's §1.1. */
interface Invariant {
  /** Stable id, used in the rendered failure message. */
  readonly id: string;
  /** The defect the invariant keeps out. */
  readonly why: string;
  /** What the section was expected to say, quoted in the failure message. */
  readonly evidence: string;
  /** True when §1.1 satisfies the invariant. */
  readonly holds: boolean;
}

/** The section with every run of whitespace collapsed to one space. */
function flatten(section: string): string {
  return section.replace(/\s+/g, ' ').trim();
}

/** Each `- ` bullet of a section, with its continuation lines joined. */
function bulletsOf(section: string): string[] {
  const bullets: string[] = [];
  let current: string[] = [];
  for (const line of section.split(/\r?\n/)) {
    if (/^-\s+/.test(line)) {
      if (current.length > 0) bullets.push(current.join(' '));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) bullets.push(current.join(' '));
  return bullets.map((bullet) => bullet.replace(/\s+/g, ' ').trim());
}

/**
 * The body of the section a heading opens — from just after the heading to the
 * next heading of the same or a higher level.
 */
function sectionOf(body: string, heading: RegExp): string {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) throw new Error(`${CONTRACT_REL} has no section matching ${heading.source}`);
  const level = /^#+/.exec(lines[start] ?? '')?.[0].length ?? 1;
  const end = lines.findIndex((line, index) => {
    if (index <= start) return false;
    const match = /^#+/.exec(line);
    return match !== null && match[0].length <= level;
  });
  return lines.slice(start + 1, end === -1 ? lines.length : end).join('\n');
}

/** The published contract, read from the real file. */
function contract(): { readonly body: string; readonly section: string } {
  const body = readFileSync(join(REPO_ROOT, CONTRACT_REL), 'utf8');
  return { body, section: sectionOf(body, /^###\s+1\.1\b/) };
}

/**
 * True when the section says that writing only one of the two words is
 * allowed. A negated allowance ("only `when` is NOT allowed") is not an
 * allowance, so the gap between the two is checked for a negation.
 */
function allowsOnlyOne(text: string): boolean {
  const pattern =
    /\b(?:only|alone)\b([^.]{0,120}?)\b(?:allowed|passes|compliant|permitted|acceptable|accepted)\b/gi;
  for (const match of text.matchAll(pattern)) {
    if (!/\b(?:not|never|cannot|can't)\b/i.test(match[1] ?? '')) return true;
  }
  return false;
}

/** Every invariant of §1.1, each with the evidence that decided it. */
function evaluateSection(section: string): readonly Invariant[] {
  const text = flatten(section);
  const formBullets = bulletsOf(section).filter((bullet) => bullet.includes(COMBINED_FORM));
  const hardRequirement = HARD_REQUIREMENT_RULES.find((rule) => rule.pattern.test(text));
  const preferred = formBullets.find((bullet) => PREFERENCE_MARKERS.test(bullet));

  return [
    {
      id: 'enforced-rule',
      why: '§1.1 must state the rule the verifier enforces: at least one of `when` or `should`',
      evidence: 'a "must … at least one of `when` or `should`" statement',
      holds: STATES_THE_ENFORCED_RULE.test(text)
    },
    {
      id: 'preferred-form',
      why: '§1.1 must present `when X, should Y` as the idiomatic form, not as a requirement',
      evidence: 'a bullet that names the form and marks it as a preference',
      holds: formBullets.length > 0 && preferred !== undefined
    },
    {
      id: 'no-hard-requirement',
      why: '§1.1 must not bind a requirement to the combined `when X, should Y` form',
      evidence: hardRequirement === undefined ? 'no must-bound statement' : hardRequirement.why,
      holds: hardRequirement === undefined
    },
    {
      id: 'one-of-allowed',
      why: '§1.1 must say that writing only `when` or only `should` is allowed',
      evidence: 'an "only … allowed" statement',
      holds: allowsOnlyOne(text)
    },
    {
      id: 'names-the-verifier',
      why: '§1.1 must name the checker behaviour it describes, so the two cannot drift apart',
      evidence: '`hasWhenOrShould` or `description-no-should-when`',
      holds: NAMES_THE_VERIFIER.test(text)
    }
  ];
}

/** The one invariant with the given id. */
function invariant(id: string): Invariant {
  const found = evaluateSection(contract().section).find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`no invariant '${id}'`);
  return found;
}

/** The failure text for the broken invariants — names the file and each defect. */
function renderBroken(broken: readonly Invariant[]): string {
  return broken
    .map((entry) => `${CONTRACT_REL} §1.1 — ${entry.id}: ${entry.why} (expected ${entry.evidence})`)
    .join('\n');
}

// ── behavior: the contract states one enforced rule and one preference ──

describe('Scenario: behavior — the contract states one enforced rule and one preference', () => {
  it('when §1.1 is evaluated, should state the enforced at-least-one rule', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: the enforced-rule invariant is evaluated
    // then: it holds, so the rule the verifier runs is stated in the contract
    const entry = invariant('enforced-rule');
    expect(entry.holds, entry.why).toBe(true);
  });

  it('when §1.1 is evaluated, should present the combined form as a preference', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: the preferred-form invariant is evaluated
    // then: it holds, so `when X, should Y` is named as a form and not as a rule
    const entry = invariant('preferred-form');
    expect(entry.holds, entry.why).toBe(true);
  });

  it('when §1.1 is evaluated, should not bind a requirement to the combined form', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: the no-hard-requirement invariant is evaluated
    // then: it holds, so no "must" binds to `when X, should Y`
    const entry = invariant('no-hard-requirement');
    expect(entry.holds, entry.why).toBe(true);
  });

  it('when §1.1 is evaluated, should say that writing only one of the words is allowed', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: the one-of-allowed invariant is evaluated
    // then: it holds, so a `when`-only or a `should`-only description is compliant
    const entry = invariant('one-of-allowed');
    expect(entry.holds, entry.why).toBe(true);
  });

  it('when §1.1 is evaluated, should name the checker behaviour it describes', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: the names-the-verifier invariant is evaluated
    // then: it holds, so the contract and `hasWhenOrShould` cannot drift apart
    const entry = invariant('names-the-verifier');
    expect(entry.holds, entry.why).toBe(true);
  });

  it('when every invariant is evaluated, should report none broken', () => {
    // given: the contract's §1.1 text, read from the published file
    // when: every invariant of the section is evaluated
    // then: none of them is broken, and the section is self-consistent
    const broken = evaluateSection(contract().section).filter((entry) => !entry.holds);
    expect(broken, renderBroken(broken)).toEqual([]);
  });
});

// ── integration: the published contract file on disk ───────────────────

describe('Scenario: integration — the published contract file on disk', () => {
  it('when the contract is read from disk, should find the §1.1 section', () => {
    // given: the published contract file in the repository
    // when: the file is read and §1.1 is extracted from it
    // then: the section is not empty, so the invariants are judged on real text
    const { body, section } = contract();
    expect(body).toContain('### 1.1');
    expect(section.length).toBeGreaterThan(0);
  });

  it('when §2 is read from disk, should still ask for one of the two words only', () => {
    // given: the contract's §2 pre-write checklist
    // when: the checklist is extracted and checked against the hard-requirement rules
    // then: it still asks for `when` or `should`, and never binds a "must" to the combined form
    const checklist = flatten(sectionOf(contract().body, /^##\s+2\b/));
    expect(checklist).toContain('`when` or `should`');
    const offender = HARD_REQUIREMENT_RULES.find((rule) => rule.pattern.test(checklist));
    expect(offender?.why ?? 'no hard requirement in §2').toBe('no hard requirement in §2');
  });
});

// ── render: the failure message names the file and the defect ──────────

describe('Scenario: render — the failure message names the file and the defect', () => {
  it('when a broken invariant is rendered, should name the file, the section and the defect', () => {
    // given: an invariant that does not hold
    // when: the failure is rendered
    // then: the message names the file, the section and the invariant
    const message = renderBroken([
      {
        id: 'one-of-allowed',
        why: '§1.1 must say that writing only `when` or only `should` is allowed',
        evidence: 'an "only … allowed" statement',
        holds: false
      }
    ]);
    expect(message).toContain(CONTRACT_REL);
    expect(message).toContain('§1.1');
    expect(message).toContain('one-of-allowed');
  });

  it('when several invariants are broken, should render one line per defect', () => {
    // given: two invariants that do not hold
    // when: the failure is rendered
    // then: the message carries one line per defect
    const message = renderBroken([
      {
        id: 'preferred-form',
        why: 'first defect',
        evidence: 'evidence one',
        holds: false
      },
      {
        id: 'no-hard-requirement',
        why: 'second defect',
        evidence: 'evidence two',
        holds: false
      }
    ]);
    expect(message.split('\n')).toHaveLength(2);
    expect(message).toContain('first defect');
    expect(message).toContain('second defect');
  });
});
