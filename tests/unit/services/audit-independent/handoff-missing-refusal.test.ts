// tests/unit/services/audit-independent/handoff-missing-refusal.test.ts
//
// Guards `rid-audit-refusal-names-blocker` (backlog 9.22).
//
// The defect: both audit detectors refuse with state `handoff-missing` when
// `prd/handoff-<rid>.md` is absent, and the refusal named only the DIRECTORY
// while never saying the audit itself had SUCCEEDED. Measured twice on
// 2026-10-13, once per slice, by four independent reviewers: each produced an
// envelope that passed `is{Security,Perf}AuditEnvelope` — so the run got past
// validation to this gate — and then wrote nothing, having been told only about
// a file it had never been told it would need.
//
// The assertions are therefore about the REFUSAL TEXT, not "the gate fires":
//   - the run arm names all three facts (envelope valid / missing path / command)
//   - RED DIRECTION: the same predicate is absent on the input it must reject —
//     the read-only `detect` surface carries no envelope, so claiming there that
//     the envelope passed would be a claim stronger than the code
//   - BRANCH CONTROL: with no `--rid` the refusal may name ONLY the bare path it
//     actually probed, and must say the creating command needs an rid
//   - control: a present handoff produces none of this new text, and the
//     long-standing trailing sentence is unchanged

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { initHandoff, writeHandoff } from '../../../../src/services/prd/handoff-service.js';
import { detectPerfAudit } from '../../../../src/services/audit-independent/perf-audit-service.js';
import { detectSecurityAudit } from '../../../../src/services/audit-independent/security-audit-service.js';

declareDimensions('tests/unit/services/audit-independent/handoff-missing-refusal.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SID = '2026-10-12-session-probe';
const RID = 'rid-probe-alpha';
const OTHER_RID = 'rid-probe-beta';

/** An envelope both strict-shape predicates accept — the input the four
 *  reviewers actually produced. */
const VALID_ENVELOPE = { verdict: 'pass', violations: [], summary: 'clean' } as const;

/** The rid-scoped capsule path, built the same way the resolver builds it. */
const capsulePath = (root: string, rid: string): string =>
  join(root, '.peaks', '_runtime', SID, 'prd', `handoff-${rid}.md`);

/** The bare, pre-rid-scoping path — the only one a rid-less probe can try. */
const barePath = (root: string): string =>
  join(root, '.peaks', '_runtime', SID, 'prd', 'handoff.md');

const tempRoots: string[] = [];

afterEach(() => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/** A real temp project tree with the `prd/` directory present and EMPTY — the
 *  missing-handoff condition, not a missing tree. */
function emptyTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-refusal-'));
  tempRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SID, 'prd'), { recursive: true });
  return root;
}

/** The same tree with this slice's capsule written through the real writer. */
async function treeWithCapsule(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'peaks-audit-refusal-'));
  tempRoots.push(root);
  const handoff = initHandoff({
    requestId: RID,
    sessionId: SID,
    body: `# PRD handoff — ${RID}\n\n## Goal\nprobe\n`,
    writtenAt: '2026-10-12T00:00:00.000Z',
    goals: [],
    acceptanceCriteria: [],
    preservedBehavior: []
  });
  await writeHandoff(handoff, root);
  return root;
}

describe('(a11y) the refusal a reader sees names all three facts', () => {
  for (const [name, detect] of [
    ['security', detectSecurityAudit],
    ['perf', detectPerfAudit]
  ] as const) {
    it(`should state it in the ${name} arm, with the path and the command`, () => {
      const root = emptyTree();
      const result = detect({
        projectRoot: root,
        sessionId: SID,
        requestId: RID,
        envelope: VALID_ENVELOPE
      });

      // The refusal still refuses.
      expect(result.state).toBe('handoff-missing');
      expect(result.handoffPresent).toBe(false);

      // These `nextActions` are what `printResult` writes to stderr as `- …`.
      // `result.warnings` is a SECOND reader-visible surface: the audit CLI
      // commands spread the detector's warnings over `fail()`, so the same run
      // also prints `warning: …`. That surface is asserted in
      // `tests/unit/cli/commands/audit-failure-carries-warnings.test.ts`; this
      // file keeps measuring the service's own arrays.
      const text = result.nextActions.join('\n');

      // (a) the load-bearing sentence the refusal was missing.
      expect(text).toContain('passed validation');
      expect(text).toContain('only the artifact write is blocked');
      // (b) the missing capsule, by its resolved path.
      expect(text).toContain(capsulePath(root, RID));
      // (c) the one command that creates it, with both ids already filled in.
      expect(text).toContain(`peaks prd handoff init --rid ${RID} --sid ${SID}`);
      expect(text).toContain('--apply');

      // The long-standing trailing sentence survives, per role.
      expect(result.nextActions.at(-1)).toBe(
        `Until the handoff exists, peaks-${name}-audit cannot start (gate fail).`
      );
    });
  }
});

describe('(behavior) RED DIRECTION — the claim is absent on the input it must reject', () => {
  it('should NOT claim the envelope was valid when no envelope was supplied', () => {
    const root = emptyTree();
    // `peaks perf-audit detect` — the read-only surface. There is no envelope
    // in this call at all, so the same predicate that must be TRUE above must
    // be FALSE here. Without this arm the sentence above could be a constant.
    const result = detectPerfAudit({ projectRoot: root, sessionId: SID, requestId: RID });

    expect(result.state).toBe('handoff-missing');
    const text = result.nextActions.join('\n');
    expect(text).not.toContain('passed validation');
    expect(text).not.toContain('only the artifact write is blocked');

    // ...while the two facts that ARE knowable here are still present, so this
    // arm is not passing by emitting nothing.
    expect(text).toContain(capsulePath(root, RID));
    expect(text).toContain(`peaks prd handoff init --rid ${RID}`);
  });

  it('should NOT claim the envelope was valid for a malformed one either', () => {
    const root = emptyTree();
    const result = detectSecurityAudit({
      projectRoot: root,
      sessionId: SID,
      requestId: RID,
      envelope: { verdict: 'nope' }
    });
    // The handoff gate precedes the envelope gate, so an invalid envelope still
    // reaches this state — and must not be described as validated.
    expect(result.state).toBe('handoff-missing');
    expect(result.nextActions.join('\n')).not.toContain('passed validation');
  });
});

describe('(behavior) BRANCH CONTROL — a rid-less probe may name only what it probed', () => {
  it('should name the bare path and say the command needs an rid', () => {
    const root = emptyTree();
    const result = detectPerfAudit({ projectRoot: root, sessionId: SID });

    expect(result.state).toBe('handoff-missing');
    const text = result.nextActions.join('\n');

    // The only path `resolveHandoffPath` could have tried without an rid.
    expect(text).toContain(barePath(root));
    // It must NOT name a slice-scoped capsule it never looked for...
    expect(text).not.toContain(`handoff-${RID}.md`);
    expect(text).not.toContain(`handoff-${OTHER_RID}.md`);
    // ...and the creating command needs an rid this run does not have.
    expect(text).toContain('--rid <request-id>');

    // The new sentence is true here too: nothing was validated.
    expect(text).not.toContain('passed validation');
  });

  it('should keep the un-scoped-probe warning accurate (AC-2)', () => {
    const root = emptyTree();
    const warnings = detectSecurityAudit({ projectRoot: root, sessionId: SID }).warnings.join('\n');

    expect(warnings).toContain('No --rid was supplied');
    expect(warnings).toContain('`prd/handoff.md`');
    // The warning describes the rid-scoped name as what `--rid` WOULD resolve —
    // it is not a claim that the file is what was probed.
    expect(warnings).toContain('`prd/handoff-<rid>.md`');
  });
});

describe('(integration) control — a present handoff adds no text and changes no state', () => {
  it('should pass through to the detect stage with the capsule present', async () => {
    const root = await treeWithCapsule();
    const result = detectPerfAudit({ projectRoot: root, sessionId: SID, requestId: RID });

    // No template in this tree, so the FIRST reachable state past the handoff
    // is `template-missing` — the capsule was found.
    expect(result.state).toBe('template-missing');
    expect(result.handoffPresent).toBe(true);

    const text = result.nextActions.join('\n');
    expect(text).not.toContain('passed validation');
    expect(text).not.toContain('peaks prd handoff init');
    expect(text).not.toContain('Missing peaks-prd handoff');
    expect(result.warnings.join('\n')).not.toContain('No --rid was supplied');
  });
});

/** C0, DEL and C1 as code points — the set both repository precedents replace. */
const LAST_C0_CODE_POINT = 0x1f;
const DEL_CODE_POINT = 0x7f;
const FIRST_C1_CODE_POINT = 0x80;
const LAST_C1_CODE_POINT = 0x9f;

/**
 * Deliberately NOT the module's own predicate: a test that borrows the check it
 * is testing cannot catch that check being wrong. Found by code-point comparison
 * rather than a control-character regex, which `no-control-regex` refuses.
 */
const hasControlCodePoint = (line: string): boolean =>
  [...line].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return (
      code <= LAST_C0_CODE_POINT ||
      code === DEL_CODE_POINT ||
      (code >= FIRST_C1_CODE_POINT && code <= LAST_C1_CODE_POINT)
    );
  });

describe('(a11y) a hostile --sid cannot forge a line of the refusal', () => {
  // `sessionId` is guarded only by `isUnsafePathInput`, which rejects traversal
  // and drive paths but NOT control characters. Every string here is printed, so
  // a raw `\n` in one of them is not "odd text" — it is an extra line of this
  // command's own output, authored by whoever chose the sid.
  //
  // RED DIRECTION: with `printable` neutered to `return value`, every case below
  // fails — measured, `cat -A` shows the refusal splitting into `…SID001$` +
  // `FAKE: injected-line…$`. The guard is on the input it must reject.
  const HOSTILE_SIDS: ReadonlyArray<readonly [string, string]> = [
    ['a newline', 'SID001\nFAKE: injected-line'],
    ['an ESC sequence', 'SID002\u001b[2K forged'],
    ['a carriage return', 'SID003\rFAKE: injected-line'],
    ['a NUL and a C1 control', 'SID004\u0000\u0085FAKE']
  ];

  for (const [label, sid] of HOSTILE_SIDS) {
    it(`should render ${label} inert, in both arms, both services`, () => {
      const root = emptyTree();
      for (const result of [
        detectPerfAudit({ projectRoot: root, sessionId: sid, requestId: RID }),
        detectPerfAudit({ projectRoot: root, sessionId: sid }),
        detectSecurityAudit({ projectRoot: root, sessionId: sid, requestId: RID }),
        detectSecurityAudit({ projectRoot: root, sessionId: sid })
      ]) {
        expect(result.state).toBe('handoff-missing');
        const lines = [...result.warnings, ...result.nextActions];
        // Non-vacuity: the refusal still says everything it said before.
        expect(lines.length).toBeGreaterThanOrEqual(3);
        for (const line of lines) {
          // The assertion the neutered sanitiser fails: no line carries a
          // control character, so no line can become two lines when printed.
          expect(hasControlCodePoint(line)).toBe(false);
        }
      }
    });
  }

  it('should keep the sid legible rather than dropping the injected text', () => {
    const root = emptyTree();
    const text = detectPerfAudit({
      projectRoot: root,
      sessionId: 'SID001\nFAKE: injected-line'
    }).nextActions.join(' | ');

    // The character is REPLACED, not stripped: a reader can still see that
    // something was there, which is the difference between a sanitised value and
    // a silently-rewritten one.
    expect(text).toContain('SID001?FAKE: injected-line');
  });
});
