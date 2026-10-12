/**
 * Gate 2 for the `peaks-race-code` fast lane: the SKILL.md phase marker and the tracked
 * evidence must agree.
 *
 * WHAT THIS GUARD PROVES. That `skills/peaks-audit/SKILL.md` carries EXACTLY ONE
 * `<!-- peaks:race-lane-phase … -->` marker line matching the anchored pattern IN FULL, that
 * its token is one of the two legal phases, and that `offered-by-default` stands on a verdict
 * of `pass` recomputed from the tracked evidence rows in `.peaks/race/pilot-gate.json`. A
 * second marker line, an illegal token, any other way of malforming the line, or
 * `offered-by-default` over failing evidence, and this file goes red.
 *
 * "EXACTLY ONE MARKER" HAS TWO HALVES, AND BOTH ARE NOW TOTAL. WHICH lines are candidates is
 * the COUNTER's half; WHAT SHAPE a candidate has is the anchored pattern's half. Round 4
 * totalized only the shape, and the counter keyed on the exact opener — so a decoy written
 * `<!--  peaks:…`, with a tab or NBSP gap, or in another letter-case was invisible to BOTH the
 * count and the `find()`, while the first exact match, the legal line, was the one validated.
 * Measured 2026-10-12: one such decoy under the legal marker, carrying `offered-by-default`,
 * left `tests/unit/skills/` at 119 passed, exit 0. `MARKER_CANDIDATE` now counts tolerantly,
 * so such a decoy is COUNTED and refused as a duplicate, while `MARKER_LINE` still refuses a
 * near-miss that is the sole candidate.
 *
 * THREE THINGS THIS GUARD DOES NOT PROVE, stated because a guard whose limits are unstated
 * reads as an end-to-end gate. (1) THAT THE SHIPPED PROSE ASSERTS NO PHASE: the lane section
 * keys the rule on the marker, so no sentence in it can be flipped while the marker stays
 * untouched — a DESIGN property of the shipped text, held by review, since "the file must
 * contain X" is satisfied by planting X anywhere and nothing mechanical reads whether a new
 * sentence asserts a phase. (2) THAT THE EVIDENCE ROWS CAME FROM TASKS THAT WERE REALLY RUN:
 * their traces are gitignored, so the tracked rows were extracted and committed, and no test
 * here tells a faithful extraction from an invented one. (3) THAT EVERY LAST SPELLING IS
 * COUNTED: the key stays the LABELLED token, not the bare `race-lane-phase`, which occurs twice
 * in the shipped SKILL.md (line 69 names this guard's own path) and would make a bare-token
 * count refuse the very file it protects.
 *
 * WHY THE CONTROLS ARE NOT OPTIONAL. An always-green guard and a working one are
 * indistinguishable from a green run, and so are a parser hard-wired to `name-only` and one
 * that really reads the file — so each leg drives the SAME function its live leg calls, on
 * fabricated markdown, and every control was measured red by putting back the read it replaces.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  evaluatePilotGate,
  type PilotGateReason
} from '../../../src/services/race/gate2-evaluator.js';
import { RACE_GATE2_POLICY_V1 } from '../../../src/services/race/gate2-policy.js';
import { readPilotGate } from '../../../src/services/race/pilot-gate-store.js';

export type RaceLanePhase = 'name-only' | 'offered-by-default';

/** `pass` / `fail` / `insufficient-evidence` are verdicts; `no-evidence` is the absence of one. */
export type PhaseVerdict = 'pass' | 'fail' | 'insufficient-evidence' | 'no-evidence';

const MARKER = '<!-- peaks:race-lane-phase';

/**
 * The TOLERANT candidate counter — the half that was still narrow. `MARKER` keys on the exact
 * opener, so a decoy written with different opener whitespace or letter-case was invisible to
 * the count AND to the `find()`, while the first exact match — the legal line — was validated.
 * Opener whitespace and letter-case are the spellings a reader would still call the marker, so
 * both count; the token stays the LABELLED `peaks:race-lane-phase` (header, limit 3). A
 * near-miss is therefore COUNTED, and refused as a duplicate, rather than falling outside both
 * halves of the rule; `MARKER_LINE` still refuses it as the sole candidate. `[^\S\n]*` cannot
 * cross a newline, so the line the count located is always the line the pattern judges.
 */
const MARKER_CANDIDATE = /<!--[^\S\n]*peaks:race-lane-phase/gi;

/**
 * The TOTAL specification of a candidate's SHAPE — the only line the parser accepts.
 *
 * Anchored rather than "find the line, then grep the first phase token": a prefix match judges
 * a line on the first `phase="…"` ANYWHERE in it, so a line whose text says one thing while the
 * matched token says another reads as if they agreed. Anchoring settles the whole line at once,
 * so the family — a second declaration, an extra attribute, trailing junk, leading whitespace —
 * has no member left over ONCE THE LINE IS A CANDIDATE — round 5's correction, since settling a
 * line totally is worth nothing for a line never counted. `\s*$` tolerates trailing whitespace.
 */
const MARKER_LINE = /^<!-- peaks:race-lane-phase phase="(name-only|offered-by-default)" -->\s*$/;
const SKILL_PATH = 'skills/peaks-audit/SKILL.md';
const EVIDENCE_ROOT = '.';
const LEGAL_PHASES: readonly RaceLanePhase[] = ['name-only', 'offered-by-default'];

/** The one legal marker line, spelled once, so each decoy below is a one-word edit away from it. */
const LEGAL_LINE = '<!-- peaks:race-lane-phase phase="name-only" -->';
const DECOY_EXTRA_SPACE = '<!--  peaks:race-lane-phase phase="offered-by-default" -->';

/** The decoy family, keyed by the spelling that makes each member a decoy rather than the marker. */
const DECOY_SPELLINGS: readonly (readonly [string, string])[] = [
  ['extra space after `<!--`', DECOY_EXTRA_SPACE],
  ['no space after `<!--`', '<!--peaks:race-lane-phase phase="offered-by-default" -->'],
  ['tab after `<!--`', '<!--\tpeaks:race-lane-phase phase="offered-by-default" -->'],
  ['NBSP after `<!--`', '<!-- peaks:race-lane-phase phase="offered-by-default" -->'],
  ['upper-cased token', '<!-- PEAKS:RACE-LANE-PHASE phase="offered-by-default" -->']
];

/**
 * The parser's refusal text for a document. When nothing was refused it returns a diagnostic
 * containing no refusal phrase, so a control that stopped discriminating reddens rather than
 * passing vacuously.
 */
function errorOf(markdown: string): string {
  const parsed = parseRaceLanePhase(markdown);
  return 'error' in parsed ? parsed.error : `no refusal: the parser named phase=${parsed.phase}`;
}

/**
 * A fragment of the phase-NEUTRAL rule sentence in `SKILL.md`, quoted verbatim. PRESENCE, NOT
 * SEMANTICS: this literal reddens when the rule sentence is deleted or rewritten out of the
 * file, and cannot tell a rule governing both marker values from one asserting a value (see
 * header limit 1). Rewording the rule must update this literal in the same commit.
 */
const PHASE_NEUTRAL_RULE =
  'is read from the marker line below and stated nowhere else in this file';

/**
 * Exactly one marker declares the phase. The COUNT is taken with the tolerant pattern — as
 * OCCURRENCES, so a second token sharing the first one's line is refused too, and a near-miss
 * spelling is counted rather than overlooked — and the single candidate's line must then match
 * `MARKER_LINE` IN FULL. Count and match are the two halves of one rule: the count rules out a
 * second marker line or a second token, and the full match rules out every remaining way one
 * occurrence can carry something the pattern does not name. A duplicate is refused rather than
 * ignored: `find()` would silently take the first, so a smuggled duplicate could carry a phase
 * the evidence never earned while the guard stayed green.
 */
export function parseRaceLanePhase(markdown: string): { phase: RaceLanePhase } | { error: string } {
  const occurrences = (markdown.match(MARKER_CANDIDATE) ?? []).length;
  if (occurrences === 0) {
    return { error: `${SKILL_PATH} carries no \`${MARKER}\` marker` };
  }
  if (occurrences > 1) {
    return {
      error: `${SKILL_PATH} carries ${occurrences} \`${MARKER}\` markers counted tolerantly over opener whitespace and letter-case; exactly one declares the phase`
    };
  }
  const line =
    markdown.split('\n').find((candidate) => candidate.match(MARKER_CANDIDATE) !== null) ?? '';
  const match = MARKER_LINE.exec(line);
  if (match === null) {
    return {
      error: `${SKILL_PATH} marker line is not exactly ${MARKER_LINE.source}: ${JSON.stringify(line)}`
    };
  }
  return { phase: match[1] as RaceLanePhase };
}

/**
 * Checks that the phase-neutral rule sentence is still in the file. PRESENCE ONLY: this reads
 * no meaning, so it cannot tell a rule governing both marker values from one asserting a value,
 * nor whether a declarative claim was added beside it. Its one job is to redden when the rule
 * sentence is deleted.
 */
export function checkPhaseRulePresent(input: {
  readonly markdown: string;
}):
  { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly reason: string } {
  return input.markdown.includes(PHASE_NEUTRAL_RULE)
    ? {
        ok: true,
        reason: `the phase-neutral rule sentence is present: ${JSON.stringify(PHASE_NEUTRAL_RULE)}`
      }
    : {
        ok: false,
        reason: `the phase-neutral rule sentence is missing from ${SKILL_PATH}: ${JSON.stringify(PHASE_NEUTRAL_RULE)} — presence is all this check reads`
      };
}

/**
 * The check, with `phase` INJECTED rather than read here. The injection is what lets the
 * controls drive the same function on an alternate phase; a checker that read the file itself
 * could not be controlled at all. `name-only` requires nothing — a cleared gate with no switch
 * is a legal state; `offered-by-default` requires a passing verdict, and the refusal names the
 * unmet quantities with their `observed`/`threshold`, never "gate failed".
 */
export function checkRaceLanePhase(input: {
  readonly phase: RaceLanePhase;
  readonly verdict: PhaseVerdict;
  readonly reasons?: readonly { code: string; observed: number; threshold: number }[];
}):
  { readonly ok: true; readonly reason: string } | { readonly ok: false; readonly reason: string } {
  if (input.phase === 'name-only') {
    return { ok: true, reason: 'phase name-only requires nothing of the evidence' };
  }
  if (input.verdict === 'pass') {
    return {
      ok: true,
      reason: 'phase offered-by-default requires a passing verdict, and the verdict is pass'
    };
  }
  const named = (input.reasons ?? []).map(
    (reason) => `${reason.code} observed ${reason.observed} against threshold ${reason.threshold}`
  );
  const detail =
    named.length > 0
      ? named.join('; ')
      : `the ${input.verdict} verdict carried no reason with an observed/threshold pair`;
  return {
    ok: false,
    reason: `phase offered-by-default requires a passing verdict, got ${input.verdict}: ${detail}`
  };
}

/**
 * The evidence leg, recomputed through the `src/` reader and evaluator — never a second parser,
 * and never the file's own recorded verdict: a stale or edited `lastEvaluation` must not answer
 * for the rows.
 */
export function evaluateEvidenceAt(projectRoot: string): {
  readonly verdict: PhaseVerdict;
  readonly reasons: readonly PilotGateReason[];
} {
  const read = readPilotGate(projectRoot);
  if (read.kind !== 'ok') {
    return { verdict: 'no-evidence', reasons: [] };
  }
  const evaluation = evaluatePilotGate(read.gate.tasks, RACE_GATE2_POLICY_V1);
  return { verdict: evaluation.verdict, reasons: evaluation.reasons };
}

describe('Scenario: race-lane-phase-gate — the phase marker and the tracked evidence', () => {
  it('when the SKILL.md marker is parsed, should yield one legal phase value', () => {
    // given: the tracked skill file every lane question is answered from
    // when:  the marker line is parsed for its phase token
    // then:  a missing or illegal marker is red, and a legal one is named
    const parsed = parseRaceLanePhase(readFileSync(SKILL_PATH, 'utf8'));
    const detail = 'error' in parsed ? parsed.error : `phase=${parsed.phase}`;
    expect('error' in parsed, detail).toBe(false);
    if (!('error' in parsed)) {
      expect(LEGAL_PHASES).toContain(parsed.phase);
    }
  });

  it('when the shipped phase is judged against the real evidence, should ask for a passing verdict only once offered', () => {
    // given: the real evidence file and the marker actually shipped today
    // when:  the checker runs with the shipped phase, and a missing marker is leg one's failure rather than a reason to invent a stricter one here
    // then:  offered-by-default stands on a passing verdict; name-only requires nothing
    const parsed = parseRaceLanePhase(readFileSync(SKILL_PATH, 'utf8'));
    const phase: RaceLanePhase = 'error' in parsed ? 'name-only' : parsed.phase;
    const { verdict, reasons } = evaluateEvidenceAt(EVIDENCE_ROOT);
    const result = checkRaceLanePhase({ phase, verdict, reasons });
    expect(result.ok, result.reason).toBe(true);
  });

  it('when the shipped skill file is read, should still carry the phase-neutral rule sentence', () => {
    // given: the shipped lane section, which states the rule for either marker value
    // when:  its prose is put through the rule-presence check
    // then:  present — this leg reddens if the rule sentence is deleted or rewritten away
    const result = checkPhaseRulePresent({ markdown: readFileSync(SKILL_PATH, 'utf8') });
    expect(result.ok, result.reason).toBe(true);
  });

  it('when the phase is offered-by-default and the verdict is not pass, should refuse and name the unmet quantity', () => {
    // given: an injected phase with a verdict that does not clear the floor
    // when:  the switch is judged
    // then:  refused, and the reason names the quantity with its numbers
    const result = checkRaceLanePhase({
      phase: 'offered-by-default',
      verdict: 'insufficient-evidence',
      reasons: [{ code: 'task-count-below-min', observed: 4, threshold: 10 }]
    });
    const refused = !result.ok;
    expect(refused).toBe(true);
    expect(result.reason).toContain('task-count-below-min');
    expect(result.reason).toContain('observed 4');
    expect(result.reason).toContain('threshold 10');
  });

  it('when the phase is offered-by-default and the verdict is pass, should allow the switch', () => {
    // given: the allow-direction of the control above, without which an always-refusing checker would satisfy it
    // when:  the switch is judged
    // then:  allowed
    const result = checkRaceLanePhase({ phase: 'offered-by-default', verdict: 'pass' });
    const allowed = result.ok;
    expect(allowed).toBe(true);
  });

  it('when the phase is offered-by-default and there is no evidence file, should refuse', () => {
    // given: the absence of a verdict, which is not a passing one
    // when:  the switch is judged
    // then:  refused — "nothing to judge" must never clear a gate
    const result = checkRaceLanePhase({ phase: 'offered-by-default', verdict: 'no-evidence' });
    const refused = !result.ok;
    expect(refused).toBe(true);
    expect(result.reason).toContain('no-evidence');
  });

  it('when the phase is name-only, should require nothing of the evidence', () => {
    // given: a cleared but unswitched phase, against a missing and a non-passing verdict
    // when:  both are judged
    // then:  allowed — the gate is cleared but not switched, which is legal
    const missing = checkRaceLanePhase({ phase: 'name-only', verdict: 'no-evidence' });
    const notPassing = checkRaceLanePhase({ phase: 'name-only', verdict: 'insufficient-evidence' });
    const allowed = missing.ok && notPassing.ok;
    expect(allowed).toBe(true);
  });

  it('when a document carries no marker, should report an error rather than a silent default', () => {
    // given: prose whose marker line was deleted, as a hand-edit would leave it
    // when:  the parser reads that document
    // then:  an error names the missing marker — never a silent `name-only`
    const parsed = parseRaceLanePhase('the fast lane is offered when the marker says so\n');
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('no');
      expect(parsed.error).toContain('marker');
    }
  });

  it('when a document carries an illegal phase token, should refuse it', () => {
    // given: a marker whose token is not one of the two legal phases
    // when:  the parser reads that document
    // then:  refused, and the error names both the bad token and the legal values
    const parsed = parseRaceLanePhase('<!-- peaks:race-lane-phase phase="maybe-later" -->\n');
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('maybe-later');
      expect(parsed.error).toContain('name-only');
    }
  });

  it('when a document carries two marker lines, should refuse rather than take the first', () => {
    // given: a fabricated document whose second marker claims a phase the evidence has not earned
    // when:  the parser reads that document
    // then:  refused — `find()` would have silently taken the first and stayed green
    const markdown = [
      '<!-- peaks:race-lane-phase phase="name-only" -->',
      '| Phase | Behaviour |',
      '<!-- peaks:race-lane-phase phase="offered-by-default" -->'
    ].join('\n');
    const parsed = parseRaceLanePhase(markdown);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('carries 2');
    }
  });

  it('when two marker tokens share one line, should refuse rather than judge the first', () => {
    // given: one line carrying two tokens, the second claiming a phase the evidence has not earned
    // when:  the parser reads that document
    // then:  refused — a per-line count sees a single line and would judge only the first token
    const parsed = parseRaceLanePhase(
      '<!-- peaks:race-lane-phase phase="name-only" --> <!-- peaks:race-lane-phase phase="offered-by-default" -->\n'
    );
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('carries 2');
      expect(parsed.error).toContain('exactly one declares the phase');
    }
  });

  it('when one line carries two phase declarations, should refuse rather than judge the first', () => {
    // given: the reproduced hole — ONE marker occurrence, two declarations, the first claiming name-only
    // when:  the parser reads that document
    // then:  refused, with the offending line in the message — the prefix-then-first-token read said name-only here
    const line = '<!-- peaks:race-lane-phase phase="name-only" phase="offered-by-default" -->';
    const parsed = parseRaceLanePhase(`${line}\n`);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('is not exactly');
      expect(parsed.error).toContain(JSON.stringify(line));
    }
  });

  it('when the marker line carries trailing content, should refuse it', () => {
    // given: a legal token followed by text the pattern does not name
    // when:  the parser reads that document
    // then:  refused — the anchored pattern ends the line at the comment's close
    const line = '<!-- peaks:race-lane-phase phase="name-only" --> trailing junk';
    const parsed = parseRaceLanePhase(`${line}\n`);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain(JSON.stringify(line));
    }
  });

  it('when the marker line carries an extra attribute, should refuse it', () => {
    // given: a legal token beside a second attribute on the same comment
    // when:  the parser reads that document
    // then:  refused — the token is not read out of a line the pattern does not name
    const line = '<!-- peaks:race-lane-phase phase="name-only" data-note="pilot" -->';
    const parsed = parseRaceLanePhase(`${line}\n`);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('data-note');
    }
  });

  it('when the marker line is indented, should refuse it', () => {
    // given: the legal comment pushed off column zero, as an editor's reflow would leave it
    // when:  the parser reads that document
    // then:  refused — the pattern anchors at the line's start, not in the middle of it
    const line = '  <!-- peaks:race-lane-phase phase="name-only" -->';
    const parsed = parseRaceLanePhase(`${line}\n`);
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('  <!-- peaks:race-lane-phase');
    }
  });

  it('when the marker token is single-quoted, should refuse it', () => {
    // given: the same line with the token in single quotes — a shape the pattern does not name
    // when:  the parser reads that document
    // then:  refused: a near-miss spelling is not a declaration, so it never reaches the evidence leg
    const parsed = parseRaceLanePhase(
      "<!-- peaks:race-lane-phase phase='offered-by-default' -->\n"
    );
    expect('error' in parsed).toBe(true);
    if ('error' in parsed) {
      expect(parsed.error).toContain('is not exactly');
    }
  });

  it('when a second declaration spells the marker differently, should refuse every spelling as a duplicate', () => {
    // given: the reproduced hole and its family — one decoy per opener-whitespace or letter-case spelling
    // when:  each is placed below the legal line and above it, and the parser reads each document
    // then:  every member is refused as a duplicate, so no spelling hides behind the exact opener
    const failures = DECOY_SPELLINGS.flatMap(([spelling, decoy]) =>
      (
        [
          ['below the legal line', `${LEGAL_LINE}\n${decoy}\n`],
          ['above the legal line', `${decoy}\n${LEGAL_LINE}\n`]
        ] as const
      ).map(([position, document]) => `${spelling}, ${position}: ${errorOf(document)}`)
    ).filter((row) => !row.includes('carries 2'));
    expect(failures, failures.join(' | ')).toEqual([]);
  });

  it('when a decoy widens the gap after the comment opener, should refuse it as a duplicate', () => {
    // given: THE reproduced hole, named on its own — an extra space after `<!--`, below the legal line
    // when:  the parser reads that document
    // then:  refused as a duplicate: the exact-opener count saw one and judged the legal line
    expect(errorOf(`${LEGAL_LINE}\n${DECOY_EXTRA_SPACE}\n`)).toContain('carries 2');
  });

  it('when a decoy is the sole candidate, should refuse it on its shape', () => {
    // given: a whitespace-variant decoy with no legal line beside it to fall back on
    // when:  the parser reads that document
    // then:  refused by the SHAPE check, quoting the line — a tolerated spelling is not the marker
    const refusal = errorOf(`${DECOY_EXTRA_SPACE}\n`);
    expect(refusal).toContain('is not exactly');
    expect(refusal).toContain(JSON.stringify(DECOY_EXTRA_SPACE));
  });

  it('when prose names this guard by its own path, should not count that mention as a candidate', () => {
    // given: SKILL.md line 69's mention — the reason the counter keys on the LABELLED token
    // when:  a document mirrors that mention beside the legal line
    // then:  the mention carries a bare token and no candidate, so the legal line is still the only one
    const mention = '`tests/unit/skills/race-lane-phase-gate.test.ts` judges it';
    expect((mention.match(/race-lane-phase/gi) ?? []).length).toBe(1);
    const parsed = parseRaceLanePhase(`${LEGAL_LINE}\n${mention}\n`);
    expect('error' in parsed ? parsed.error : parsed.phase).toBe('name-only');
  });

  it('when a document carries the legal marker line, should parse either legal value', () => {
    // given: the exact shape the pattern names, once per legal value — the accept-direction of the family above
    // when:  the parser reads each
    // then:  each is named, so the token comes from the line rather than from a hard-wired default
    const nameOnly = parseRaceLanePhase(LEGAL_LINE);
    const offered = parseRaceLanePhase(
      '<!-- peaks:race-lane-phase phase="offered-by-default" -->\n'
    );
    expect('error' in nameOnly ? nameOnly.error : nameOnly.phase).toBe('name-only');
    expect('error' in offered ? offered.error : offered.phase).toBe('offered-by-default');
  });

  it('when a document carries the offered-by-default token, should round-trip it', () => {
    // given: the other legal phase, which the shipped file does not carry today
    // when:  the parser reads that document
    // then:  the token survives — a parser hard-wired to `name-only` fails here
    const parsed = parseRaceLanePhase(
      '<!-- peaks:race-lane-phase phase="offered-by-default" -->\n'
    );
    const phase = 'error' in parsed ? parsed.error : parsed.phase;
    expect(phase).toBe('offered-by-default');
  });

  it('when a document carries the rule sentence, should accept it', () => {
    // given: a fabricated document that states the rule for either marker value
    // when:  the rule-presence check reads it
    // then:  accepted — without this direction, an always-refusing check would pass the case below
    const result = checkPhaseRulePresent({ markdown: `the lane rule ${PHASE_NEUTRAL_RULE}\n` });
    expect(result.ok, result.reason).toBe(true);
  });

  it('when the rule sentence has been deleted from a document, should refuse', () => {
    // given: the same document with the rule sentence stripped out of it
    // when:  the rule-presence check reads it
    // then:  refused, and the reason names the missing literal it reads for presence
    const result = checkPhaseRulePresent({
      markdown: 'the lane section states the rule for both values\n'
    });
    const refused = !result.ok;
    expect(refused).toBe(true);
    expect(result.reason).toContain(PHASE_NEUTRAL_RULE);
  });
});
