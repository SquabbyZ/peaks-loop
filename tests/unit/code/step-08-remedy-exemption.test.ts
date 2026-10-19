// tests/unit/code/step-08-remedy-exemption.test.ts
//
// Backlog §17.1 fix (1): the Step 0.8 gate must not block the remedy it prints.
// The gate runs before every Bash call, so the printed remedy —
// `peaks code detect-job --is-job false --rationale <text>` — is itself a Bash
// call that the gate would refuse. The exemption is narrow on purpose: only a
// real invocation is let through. A command that merely MENTIONS the verb —
// quoted, commented, or inside a here-document — is still a command that does
// something else, and must keep blocking.
//
// Kept in its own file because `step-08-gate.test.ts` is at the 500-line tests
// cap; the subject here is the exemption arm alone.
//
// Dimensions covered: behavior (the verdict per command shape) and integration
// (a real `.peaks/_runtime/<sid>/job/<jid>/state.json` ledger on disk).
// Omitted: render (the CLI envelope is pinned in
// tests/integration/code-gate-step-08-hook.test.ts) and a11y (the BLOCKED
// stderr line and its reason text are pinned in step-08-gate.test.ts).

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { evaluateStep08 } from '../../../src/services/code/step-08-gate.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/code/step-08-remedy-exemption.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'the CLI envelope shape is pinned in tests/integration/code-gate-step-08-hook.test.ts'
    },
    {
      dim: 'a11y',
      reason: 'the BLOCKED stderr line is pinned in tests/unit/code/step-08-gate.test.ts'
    }
  ]
);

const SESSION_ID = '2026-10-19-session-remedy-exemption';
const REMEDY = 'peaks code detect-job --is-job false --rationale "x"';

/** A session that owns a ledger and has no decision: the arm that blocks. */
function ledgerFixture(): string {
  const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-remedy-'));
  const jobDir = join(tmpDir, '.peaks', '_runtime', SESSION_ID, 'job', 'aware-job');
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({ jobId: 'aware-job', slices: [{ status: 'pending' }] }),
    'utf8'
  );
  return tmpDir;
}

describe('(behavior) the exemption recognises only a real detect-job invocation', () => {
  it('when the hook command is a real detect-job invocation, should allow with the named remedy verdict', () => {
    // given: a session with a Job ledger and no job-shape.json
    // when:  the Bash command being gated is the printed remedy
    // then:  the gate allows, under its own verdict name
    const out = evaluateStep08({
      sessionId: SESSION_ID,
      projectRoot: ledgerFixture(),
      command: REMEDY
    });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-remedy-command');
  });

  it('when a leading env assignment precedes the executable, should still recognise the invocation', () => {
    // given: the per-call env prefix a caller is allowed to write
    // when:  the executable tokens still read peaks / code / detect-job
    // then:  the prefix does not hide the invocation
    const out = evaluateStep08({
      sessionId: SESSION_ID,
      projectRoot: ledgerFixture(),
      command: 'PEAKS_CALLER_ID=abc peaks code detect-job --is-job false'
    });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-remedy-command');
  });

  it('when each executable token is individually quoted, should still recognise the invocation', () => {
    // given: shell quoting that does not change the words
    // when:  the tokens strip to peaks / code / detect-job
    // then:  the invocation is recognised
    const out = evaluateStep08({
      sessionId: SESSION_ID,
      projectRoot: ledgerFixture(),
      command: "'peaks' 'code' 'detect-job'"
    });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-remedy-command');
  });

  it.each([
    ['an unrelated command', 'ls'],
    ['a quoted mention', 'echo "peaks code detect-job --is-job false"'],
    ['a wholly quoted invocation', '"peaks code detect-job"'],
    ['a commented mention', '# peaks code detect-job --is-job false'],
    ['a here-document body', "cat <<'EOF'\npeaks code detect-job --is-job false\nEOF"],
    ['a compound line', 'peaks code detect-job --is-job false; rm -rf build'],
    ['a longer verb', 'peaks code detect-job-extra --is-job false'],
    ['a command substitution', 'peaks code detect-job --rationale "$(rm -rf build)"'],
    ['a backtick substitution', 'peaks code detect-job --rationale "`rm -rf build`"'],
    ['a quoted env value', 'A="a b" peaks code detect-job']
  ])('when the command is %s, should keep blocking on the ledger', (_label, command) => {
    // given: the same blocking fixture
    // when:  the command is not a bare remedy invocation
    // then:  the ledger arm still fires — the exemption did not widen
    const out = evaluateStep08({
      sessionId: SESSION_ID,
      projectRoot: ledgerFixture(),
      command
    });

    expect(out.allow).toBe(false);
    expect(out.verdict.kind).toBe('block-no-decision-with-ledger');
  });
});

describe('(integration) the exemption permits the retry and writes nothing', () => {
  it('when the remedy is allowed, should leave job-shape.json absent', () => {
    // given: a real ledger on disk and no decision file
    // when:  the remedy command is evaluated
    // then:  the gate permits the retry and records nothing itself
    const tmpDir = ledgerFixture();

    evaluateStep08({ sessionId: SESSION_ID, projectRoot: tmpDir, command: REMEDY });

    expect(existsSync(join(tmpDir, '.peaks', '_runtime', SESSION_ID, 'job-shape.json'))).toBe(
      false
    );
  });
});
