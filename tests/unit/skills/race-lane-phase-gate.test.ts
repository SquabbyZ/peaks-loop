/**
 * Gate 2 for the `peaks-race-code` fast lane: the tracked lane phase and the tracked
 * evidence must agree.
 *
 * THE CARRIER HAS A GRAMMAR NOW. The phase is `.peaks/race/lane-phase.json`, read by
 * `src/services/race/lane-phase.ts`. The text it was written in had no grammar, so a
 * guard over it could only recognise a declaration by a spelling pattern, and every
 * spelling a reader would accept while the pattern missed it was invisible. Here a
 * spelling the parser does not name is a rejection, so this file tests the reader's
 * contract instead of a list of tolerated spellings.
 *
 * WHAT THIS FILE PROVES. That the reader refuses a missing file, a value outside the
 * enum, an object outside the strict schema, an unknown key (including `__proto__`), a
 * repeated `phase` key and a repeated key spelled with a JSON escape, naming the file in
 * each; that the tracked file's value is one of the two legal tokens; that the shipped
 * skill file names the carrier as the authority and states both branches while carrying no
 * marker a reader could take as a second authority; and that `offered-by-default` stands on
 * a verdict of `pass` recomputed from the tracked evidence in `.peaks/race/pilot-gate.json`.
 *
 * THE STATED LIMIT. The `SKILL.md` leg is a **presence** check on four literals: it can read
 * that the carrier is named and both branches stated, not that the prose means what it says —
 * a sentence reworded around the same four literals still passes. That limit is by design, and
 * is stated here because an unstated limit reads as a guarantee the guard does not make.
 *
 * THE CONTROLS. Every leg that refuses is paired with a leg that accepts the same
 * shape, so a reader wired to refuse everything cannot pass, and every fixture is fed
 * through the real `readLanePhase` rather than a copy of it.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  evaluatePilotGate,
  type PilotGateReason
} from '../../../src/services/race/gate2-evaluator.js';
import { RACE_GATE2_POLICY_V1 } from '../../../src/services/race/gate2-policy.js';
import { readLanePhase, type LanePhase } from '../../../src/services/race/lane-phase.js';
import { readPilotGate } from '../../../src/services/race/pilot-gate-store.js';

/** The tracked carrier, the repo root the shipped legs read from, and the lane section. */
const CARRIER = '.peaks/race/lane-phase.json';
const EVIDENCE_ROOT = '.';
const SKILL_PATH = 'skills/peaks-audit/SKILL.md';

/** `pass` / `fail` / `insufficient-evidence` are verdicts; `no-evidence` is the absence of one. */
type PhaseVerdict = 'pass' | 'fail' | 'insufficient-evidence' | 'no-evidence';

/**
 * The two tokens the design names, written out here rather than read from `LANE_PHASE_VALUES`:
 * the reader is built from that constant, so asserting membership in it would be a tautology.
 */
const LEGAL_TOKENS: readonly LanePhase[] = ['name-only', 'offered-by-default'];

/**
 * The lane section's substance: the carrier named as the authority and both branches stated.
 * Each literal occurs only inside that section, so deleting the section reddens the leg below.
 */
const LANE_SECTION_REQUIRED: readonly string[] = [
  '.peaks/race/lane-phase.json',
  '**authoritative**',
  '`name-only`',
  '`offered-by-default`'
];

const FIXTURES = mkdtempSync(join(tmpdir(), 'lane-phase-'));
afterAll(() => rmSync(FIXTURES, { recursive: true, force: true }));

/**
 * A fixture project root holding `content` at the carrier path; `null` writes nothing,
 * which is how the absent-file case is built.
 */
function fixtureRoot(name: string, content: string | null): string {
  const root = join(FIXTURES, name);
  if (content === null) return root;
  const file = join(root, '.peaks', 'race', 'lane-phase.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
  return root;
}

/** Every value the reader must refuse BECAUSE the enum does not name it. */
const ILLEGAL_VALUES: readonly string[] = [
  'maybe-later',
  'NAME-ONLY',
  'name_only',
  'offered-by-default ',
  '',
  'name-only and offered-by-default'
];

/** Every object the reader must refuse BECAUSE it is not exactly one legal `phase` key. */
const ILLEGAL_OBJECTS: readonly (readonly [string, string])[] = [
  ['an unknown key beside the legal one', '{"phase":"name-only","note":"pilot"}'],
  ['the key in the wrong letter-case', '{"Phase":"offered-by-default"}'],
  ['the value in the wrong type', '{"phase":true}'],
  ['the phase nested one level down', '{"phase":{"value":"name-only"}}'],
  ['an array in place of the object', '[{"phase":"name-only"}]'],
  ['no `phase` key at all', '{"lane":"name-only"}'],
  [
    '`__proto__` beside the legal key, which `strict()` alone lets through',
    '{"phase":"name-only","__proto__":{"a":1}}'
  ],
  ['`constructor` beside the legal key', '{"phase":"name-only","constructor":{"a":1}}'],
  ['`toString` beside the legal key', '{"phase":"name-only","toString":"x"}']
];

/**
 * The escaped spellings of the same key. `p` is `p`, so `JSON.parse` reads each as the
 * property `phase` and keeps the LAST value — while a count of the literal text `"phase"` sees
 * only one. The reader refuses any backslash outright, so these redden against it; a reader
 * that accepted them would resolve `offered-by-default` while a human saw `name-only` first.
 */
const ESCAPED_KEYS: readonly (readonly [string, string])[] = [
  [
    'the first declaration spelled with an escape',
    '{"\\u0070hase":"name-only","phase":"offered-by-default"}'
  ],
  [
    'the second declaration spelled with an escape',
    '{"phase":"name-only","\\u0070hase":"offered-by-default"}'
  ],
  [
    'an illegal first declaration spelled with an escape',
    '{"\\u0070hase":"maybe-later","phase":"offered-by-default"}'
  ]
];

/**
 * The spellings the previous carrier's guard was written to refuse, kept as the record of why
 * the carrier moved. Each is markdown or prose, so a JSON parser refuses it on sight, where the
 * old carrier read it as prose and said nothing: this leg proves only that none is a JSON
 * object, not a property of the new grammar — the escaped-key family above is that.
 */
const HISTORICAL_SPELLINGS: readonly (readonly [string, string])[] = [
  [
    'two marker tokens on one line',
    '<!-- peaks:race-lane-phase phase="name-only" --> <!-- peaks:race-lane-phase phase="offered-by-default" -->\n'
  ],
  [
    'two phase= declarations on one line',
    '<!-- peaks:race-lane-phase phase="name-only" phase="offered-by-default" -->\n'
  ],
  [
    'one extra space after the opener',
    '<!--  peaks:race-lane-phase phase="offered-by-default" -->\n'
  ],
  ['no space after the opener', '<!--peaks:race-lane-phase phase="offered-by-default" -->\n'],
  ['a tab after the opener', '<!--\tpeaks:race-lane-phase phase="offered-by-default" -->\n'],
  [
    'a non-breaking space after the opener',
    '<!-- peaks:race-lane-phase phase="offered-by-default" -->\n'
  ],
  ['an upper-cased token', '<!-- PEAKS:RACE-LANE-PHASE phase="offered-by-default" -->\n'],
  ['an indented marker line', '  <!-- peaks:race-lane-phase phase="name-only" -->\n'],
  ['a single-quoted token', "<!-- peaks:race-lane-phase phase='offered-by-default' -->\n"],
  [
    'an extra attribute on the comment',
    '<!-- peaks:race-lane-phase phase="name-only" data-note="pilot" -->\n'
  ],
  [
    'trailing text after the close',
    '<!-- peaks:race-lane-phase phase="name-only" --> trailing junk\n'
  ]
];

/** The plain sentence the previous carrier's guard also had to refuse. */
const PROSE = 'The fast lane is offered when the marker says so\n';

/** The reader's refusal text, or a positive note when it did not refuse. */
function refusalOf(content: string, name: string): string {
  const read = readLanePhase(fixtureRoot(name, content));
  if (read.kind === 'missing') return `missing: ${read.path}`;
  return read.kind === 'invalid' ? `invalid: ${read.message}` : `NOT REFUSED: ${read.file.phase}`;
}

/**
 * The evidence leg, recomputed through the `src/` reader and evaluator — never the
 * file's own recorded verdict, so a stale `lastEvaluation` cannot answer for the rows.
 */
function evaluateEvidenceAt(projectRoot: string): {
  readonly verdict: PhaseVerdict;
  readonly reasons: readonly PilotGateReason[];
} {
  const read = readPilotGate(projectRoot);
  if (read.kind !== 'ok') return { verdict: 'no-evidence', reasons: [] };
  const evaluation = evaluatePilotGate(read.gate.tasks, RACE_GATE2_POLICY_V1);
  return { verdict: evaluation.verdict, reasons: evaluation.reasons };
}

/**
 * The cross-check that survives the migration: `name-only` requires nothing of the
 * evidence, `offered-by-default` requires a passing verdict, and the refusal names the
 * unmet quantities with their `observed` / `threshold` rather than "gate failed".
 */
function checkLanePhase(input: {
  readonly phase: LanePhase;
  readonly verdict: PhaseVerdict;
  readonly reasons?: readonly PilotGateReason[];
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

/** The fixtures that must all be refused, keyed by the shape that earns the refusal. */
function refusalsFor(cases: readonly (readonly [string, string])[], prefix: string): string[] {
  return cases
    .map(([shape, content], index) => {
      const refusal = refusalOf(content, `${prefix}-${index}`);
      return refusal.startsWith('invalid:') ? null : `${shape} -> ${refusal}`;
    })
    .filter((row): row is string => row !== null);
}

describe('Scenario: lane-phase-gate — the tracked lane phase and the tracked evidence', () => {
  it('when the tracked carrier is read, should yield one of the two legal tokens', () => {
    // given: the tracked carrier every lane question is answered from
    // when:  the reader parses it
    // then:  accepted, and the token is one the design names — checked against a literal pair,
    //        so a widened enum cannot satisfy this by construction
    const read = readLanePhase(EVIDENCE_ROOT);
    expect(read.kind, read.kind === 'invalid' ? read.message : read.kind).toBe('ok');
    if (read.kind === 'ok') expect(LEGAL_TOKENS).toContain(read.file.phase);
  });

  it('when the carrier file is absent, should refuse rather than resolve a default', () => {
    // given: a project root whose carrier file was never written
    // when:  the reader runs
    // then:  refused as `missing`, naming the path — never a silent token
    const read = readLanePhase(fixtureRoot('absent', null));
    expect(read.kind).toBe('missing');
    expect(read.path.replace(/\\/g, '/')).toContain(CARRIER);
  });

  it('when the carrier holds JSON that does not parse, should refuse it', () => {
    // given: the carrier holding a trailing comma, which no JSON parser accepts
    // when:  the reader runs
    // then:  refused as `invalid`, naming the fault without quoting the file it choked on
    expect(refusalOf('{"phase": "name-only",}', 'syntax')).toContain('invalid:');
  });

  it('when the carrier holds a value outside the enum, should refuse every one', () => {
    // given: one carrier per token the enum does not name
    // when:  the reader runs on each
    // then:  every one is refused — a reader that accepted any of these would be a
    //        spelling guess, which is the carrier this migration removed
    const accepted = refusalsFor(
      ILLEGAL_VALUES.map(
        (value) => ['a value outside the enum', `{"phase":${JSON.stringify(value)}}`] as const
      ),
      'value'
    );
    expect(accepted, accepted.join(' | ')).toEqual([]);
  });

  it('when the carrier holds a key the rule does not name, should refuse every one', () => {
    // given: one carrier per shape — an unknown key, a mis-cased key, a wrong type, a nested
    //        value, an array, an object with no `phase`, and `__proto__` / `constructor` /
    //        `toString` beside the legal key (the first, `strict()` alone lets through)
    // when:  the reader runs on each
    // then:  every one is refused, so no key is silently carried on `read.file`
    const accepted = refusalsFor(ILLEGAL_OBJECTS, 'object');
    expect(accepted, accepted.join(' | ')).toEqual([]);
  });

  it('when the carrier declares phase twice, should refuse it rather than take the last', () => {
    // given: the carrier form of a second declaration — the same key twice in one object
    // when:  the reader runs on it
    // then:  refused: `JSON.parse` keeps the last, so an unread duplicate would decide the
    //        phase while a reader of the raw text saw the first
    const read = readLanePhase(
      fixtureRoot('duplicate', '{"phase":"name-only","phase":"offered-by-default"}')
    );
    expect(read.kind).toBe('invalid');
    if (read.kind === 'invalid') expect(read.message).toContain('more than once');
  });

  it('when the carrier spells the `phase` key with a JSON escape, should refuse every one', () => {
    // given: one carrier per escaping of the key that `JSON.parse` reads as the property
    //        `phase` while a count of the literal text `"phase"` sees only one
    // when:  the reader runs on each
    // then:  every one is refused — a reader that accepted it would resolve the last
    //        declaration while a human reading the file saw the first
    const accepted = refusalsFor(ESCAPED_KEYS, 'escaped');
    expect(accepted, accepted.join(' | ')).toEqual([]);
  });

  it('when the previous carrier’s spellings are fed to the reader, should refuse every one', () => {
    // given: the markdown and prose shapes the previous carrier accepted as text
    // when:  each is fed to this reader as the file's whole text
    // then:  every one is refused — none is a JSON object, which is the migration's premise
    //        rather than a property of the new grammar
    const accepted = refusalsFor(
      [...HISTORICAL_SPELLINGS, ['plain prose', PROSE] as const],
      'escape'
    );
    expect(accepted, accepted.join(' | ')).toEqual([]);
  });

  it('when the shipped skill file is read, should name the carrier as the authority and state both branches', () => {
    // given: the shipped lane section, the rule the phase governs and must survive with it
    // when:  its text is searched for the carrier path, the authority sentence and both tokens
    // then:  present, and the retired marker absent — the marker's absence alone is satisfied
    //        by a file with no lane section at all, so this leg pins the section itself
    const text = readFileSync(SKILL_PATH, 'utf8');
    const missing = LANE_SECTION_REQUIRED.filter((literal) => !text.includes(literal));
    expect(missing, `absent from ${SKILL_PATH}: ${missing.join(' | ')}`).toEqual([]);
    expect(text).not.toContain('peaks:race-lane-phase');
  });

  it('when the shipped phase is judged against the real evidence, should ask for a passing verdict only once offered', () => {
    // given: the tracked carrier and the real evidence file
    // when:  the checker runs with the phase the carrier holds
    // then:  accepted — and the carrier itself must read, rather than a `name-only` fallback
    //        standing in for it and short-circuiting the checker to `ok`
    const read = readLanePhase(EVIDENCE_ROOT);
    expect(read.kind, read.kind === 'invalid' ? read.message : read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const { verdict, reasons } = evaluateEvidenceAt(EVIDENCE_ROOT);
    const result = checkLanePhase({ phase: read.file.phase, verdict, reasons });
    expect(result.ok, result.reason).toBe(true);
  });

  it('when the carrier is switched to offered-by-default over the tracked evidence, should refuse and name the unmet quantity', () => {
    // given: a carrier set to the switch, judged against the evidence as it stands
    // when:  the reader and the checker both run — the injection this guard exists for
    // then:  refused, naming each unmet quantity with its observed and threshold numbers
    const read = readLanePhase(fixtureRoot('switched', '{"phase":"offered-by-default"}'));
    expect(read.kind).toBe('ok');
    if (read.kind !== 'ok') return;
    const { verdict, reasons } = evaluateEvidenceAt(EVIDENCE_ROOT);
    const result = checkLanePhase({ phase: read.file.phase, verdict, reasons });
    expect(result.ok, result.reason).toBe(false);
    expect(result.reason).toContain('observed');
    expect(result.reason).toContain('threshold');
  });

  it('when the phase is offered-by-default and the verdict is not pass, should refuse and name the unmet quantity', () => {
    // given: an injected phase with a verdict that does not clear the floor
    // when:  the switch is judged
    // then:  refused, and the reason names the quantity with its numbers
    const result = checkLanePhase({
      phase: 'offered-by-default',
      verdict: 'insufficient-evidence',
      reasons: [{ code: 'task-count-below-min', message: 'x', observed: 4, threshold: 10 }]
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('task-count-below-min');
    expect(result.reason).toContain('observed 4');
    expect(result.reason).toContain('threshold 10');
  });

  it('when the phase is offered-by-default and the verdict is pass, should allow the switch', () => {
    // given: the allow-direction of the case above
    // when:  the switch is judged
    // then:  allowed — without this, an always-refusing checker would satisfy that case
    expect(checkLanePhase({ phase: 'offered-by-default', verdict: 'pass' }).ok).toBe(true);
  });

  it('when the phase is offered-by-default and there is no evidence file, should refuse', () => {
    // given: the absence of a verdict, which is not a passing one
    // when:  the switch is judged
    // then:  refused — "nothing to judge" must never clear a gate
    const result = checkLanePhase({ phase: 'offered-by-default', verdict: 'no-evidence' });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no-evidence');
  });

  it('when the phase is name-only, should require nothing of the evidence', () => {
    // given: a cleared but unswitched phase, against a missing and a non-passing verdict
    // when:  both are judged
    // then:  allowed — the gate is cleared but not switched, which is legal
    const missing = checkLanePhase({ phase: 'name-only', verdict: 'no-evidence' });
    const notPassing = checkLanePhase({ phase: 'name-only', verdict: 'insufficient-evidence' });
    expect(missing.ok && notPassing.ok).toBe(true);
  });
});
