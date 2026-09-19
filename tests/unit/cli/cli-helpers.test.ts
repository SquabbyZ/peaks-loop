// tests/unit/cli/cli-helpers.test.ts
//
// 4-dimension unit test for the public CLI helpers in
// `src/cli/cli-helpers.ts`. These helpers are pure, so the test
// budget is <50ms total.
//
// Public surface under test (per `src/cli/cli-helpers.ts`):
//   - ProgramIO (type)
//   - printResult(io, result, asJson?)
//   - printSuperCommandCatalog(io)
//   - addJsonOption(command)
//   - printErrorEnvelope(io, command, code, message, data, nextActions)
//   - printCliEnvelope(io, r)
//   - printInvalidConfigLayer(io, command, asJson?)
//   - isRecommendationWorkflow(value)
//   - isArtifactProvider(value)
//   - isArtifactSetupStep(value)
//   - isArtifactRepoSegment(value)
//   - parseConfigLayer(value)
//   - multipleOption(value, previous)
//   - re-exports: getErrorMessage, ok, redactSensitiveErrorMessage
//
// Dimensions covered:
//   - render:    every public printer produces the documented shape
//   - behavior:  every predicate/parser accepts and rejects per spec
//   - a11y:      error envelopes redact secrets and never instruct
//                the user to type a CLI verb
//   - integration: OMITTED — cli-helpers.ts is a pure module; no
//                fs/clock/env boundary to test.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/cli-helpers.test.ts',
  ['render', 'behavior', 'a11y'],
  [{ dim: 'integration', reason: 'cli-helpers.ts is a pure module.' }]
);

import { Command } from 'commander';
import {
  addJsonOption,
  isArtifactProvider,
  isArtifactRepoSegment,
  isArtifactSetupStep,
  isRecommendationWorkflow,
  multipleOption,
  parseConfigLayer,
  printCliEnvelope,
  printErrorEnvelope,
  printInvalidConfigLayer,
  printResult,
  printSuperCommandCatalog,
  type ProgramIO
} from '~/src/cli/cli-helpers';
import { fail, ok } from 'peaks-loop-shared/result';

describe('Scenario: render — printResult shape', () => {
  withTmpWorkspacePerTest();

  it('when invoked, should ok result with asJson=true prints the full envelope as pretty JSON', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const { io, captured } = makeCapturedIo();
    printResult(io, ok('demo', { count: 3 }, ['w1'], ['retry']), true);
    const text = captured.text();
    // asJson=true prints the whole envelope once (no separate stderr
    // warnings / nextActions). Human-facing warnings/nextActions are
    // only emitted in the asJson=false path.
    expect(text).toContain('"ok": true');
    expect(text).toContain('"count": 3');
    expect(text).toContain('"w1"');
    expect(text).toContain('"retry"');
    expect(captured.stderrText()).toBe('');
  });

  it('when invoked, should err result with asJson=true prints the full envelope verbatim', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const { io, captured } = makeCapturedIo();
    printResult(io, fail('demo', 'CODE', 'msg', null), true);
    const text = captured.text();
    expect(text).toContain('"ok": false');
    expect(text).toContain('"code": "CODE"');
    expect(text).toContain('"message": "msg"');
  });

  it('when invoked, should ok result with asJson=false prints data + warnings + next actions', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const { io, captured } = makeCapturedIo();
    printResult(io, ok('demo', { x: 1 }, ['w1'], ['retry']), false);
    const text = captured.text();
    expect(text).toContain('"x": 1');
    expect(captured.stderrText()).toMatch(/warning: w1/);
    expect(text).toMatch(/next: retry/);
  });

  it('when invoked, should err result with asJson=false writes code + message + each nextAction to stderr', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const { io, captured } = makeCapturedIo();
    printResult(io, fail('demo', 'CODE', 'msg', null, ['restart', 'escalate']), false);
    expect(captured.text()).toBe('');
    const err = captured.stderrText();
    expect(err).toMatch(/^CODE: msg/);
    expect(err).toMatch(/- restart/);
    expect(err).toMatch(/- escalate/);
  });

  it('when invoked, should err result with asJson=false prints the warnings spread over it', () => {
    // given: the shape `degradedEnvelope` (web-fallback.ts) and `peaks web
    //        login` build — `fail()` hard-codes `warnings: []`, so a failed
    //        envelope only ever carries one by spreading (S4 repair, F6)
    const { io, captured } = makeCapturedIo();
    // when:  the failed envelope is printed for a human
    printResult(
      io,
      {
        ...fail('peaks.web.login', 'WEB_LOGIN_FAILED', 'msg', {}, ['retry']),
        warnings: ['local browser skipped (PEAKS_WEB_DISABLED=1)', 'MCP fallback warning']
      },
      false
    );
    // then:  the failure branch does not DROP them: they are the only news some
    //        failures have, and the JSON branch is untouched by this loop
    const err = captured.stderrText();
    expect(err).toMatch(/^WEB_LOGIN_FAILED: msg/);
    expect(err).toContain('warning: local browser skipped (PEAKS_WEB_DISABLED=1)');
    expect(err).toContain('warning: MCP fallback warning');
    expect(captured.text()).toBe('');
  });

  it('when invoked, should err result with asJson=true keeps warnings in the envelope only', () => {
    // given: the same failed envelope read by a machine
    const { io, captured } = makeCapturedIo();
    // when:  it is printed as JSON
    printResult(io, { ...fail('demo', 'CODE', 'msg', {}, []), warnings: ['w1'] }, true);
    // then:  nothing goes to stderr and the shape is unchanged
    expect(captured.stderrText()).toBe('');
    expect((JSON.parse(captured.text()) as { warnings: string[] }).warnings).toEqual(['w1']);
  });
});

describe('Scenario: render — printSuperCommandCatalog', () => {
  it('when invoked, should emits the documented 8 super-commands + footer', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const { io, captured } = makeCapturedIo();
    printSuperCommandCatalog(io);
    const text = captured.text();
    expect(text).toMatch(/Peaks super-command catalog/);
    for (const cmd of ['make', 'learn', 'check', 'run', 'share', 'version', 'ask', 'status']) {
      expect(text).toMatch(new RegExp(`^${cmd} `, 'm'));
    }
    expect(text).toMatch(/Choose a surface or describe your goal/);
  });
});

describe('Scenario: render — printErrorEnvelope', () => {
  it('when invoked, should writes a pretty fail() envelope to stderr and sets process.exitCode = 1', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printErrorEnvelope(io, 'demo', 'CODE', 'msg', { foo: 1 }, ['retry']);
    const text = captured.stderrText();
    expect(text).toContain('"ok": false');
    expect(text).toContain('"code": "CODE"');
    expect(text).toContain('"message": "msg"');
    expect(text).toContain('"foo": 1');
    expect(text).toContain('"errorId"');
    expect(process.exitCode).toBe(1);
    process.exitCode = exitBefore;
  });

  it('when invoked, should redacts Bearer / API-key strings inside the message BEFORE printing', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printErrorEnvelope(io, 'demo', 'CODE', 'token: sk-abcdefghijklmnop', {}, []);
    const text = captured.stderrText();
    expect(text).not.toContain('sk-abcdefghijklmnop');
    expect(text).toMatch(/\[redacted\]/);
    process.exitCode = exitBefore;
  });
});

describe('Scenario: render — printCliEnvelope', () => {
  it('when invoked, should ok: writes { ok: true, data } to stdout and does not change exitCode', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printCliEnvelope(io, { ok: true, data: 42 });
    const text = captured.text();
    // printCliEnvelope uses single-line JSON.stringify (no indent).
    expect(text).toMatch(/^\{"ok":true,"data":42\}/);
    expect(process.exitCode).toBe(0);
    process.exitCode = exitBefore;
  });

  it('when invoked, should err: writes { ok: false, error } to stdout and sets exitCode = 1', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printCliEnvelope(io, { ok: false, error: 'bad' });
    const text = captured.text();
    expect(text).toMatch(/^\{"ok":false,"error":"bad"\}/);
    expect(process.exitCode).toBe(1);
    process.exitCode = exitBefore;
  });
});

describe('Scenario: render — printInvalidConfigLayer', () => {
  it('when invoked, should writes the INVALID_CONFIG_LAYER envelope and sets exitCode = 1', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printInvalidConfigLayer(io, 'config', true);
    const text = captured.text();
    expect(text).toContain('"code": "INVALID_CONFIG_LAYER"');
    expect(text).toContain('"message": "Config layer must be user or project"');
    expect(process.exitCode).toBe(1);
    process.exitCode = exitBefore;
  });
});

describe('Scenario: render — addJsonOption', () => {
  it('when invoked, should attaches a --json boolean option to a Commander command', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const cmd = new Command('demo');
    addJsonOption(cmd);
    cmd.option('--foo <foo>');
    expect(cmd.options.length).toBe(2);
    const jsonOpt = cmd.options.find((o) => o.long === '--json');
    expect(jsonOpt).toBeDefined();
  });
});

describe('Scenario: behavior — predicates + parsers', () => {
  it('when invoked, should isRecommendationWorkflow accepts the 3 documented values', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isRecommendationWorkflow('code-refactor')).toBe(true);
    expect(isRecommendationWorkflow('product-refactor')).toBe(true);
    expect(isRecommendationWorkflow('frontend-design')).toBe(true);
    expect(isRecommendationWorkflow('nope')).toBe(false);
    expect(isRecommendationWorkflow('')).toBe(false);
  });

  it('when invoked, should isArtifactProvider accepts the 2 documented providers', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isArtifactProvider('github')).toBe(true);
    expect(isArtifactProvider('gitlab')).toBe(true);
    expect(isArtifactProvider('bitbucket')).toBe(false);
  });

  it('when invoked, should isArtifactSetupStep accepts detect/configure/validate/complete', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isArtifactSetupStep('detect')).toBe(true);
    expect(isArtifactSetupStep('configure')).toBe(true);
    expect(isArtifactSetupStep('validate')).toBe(true);
    expect(isArtifactSetupStep('complete')).toBe(true);
    expect(isArtifactSetupStep('nope')).toBe(false);
  });

  it('when invoked, should isArtifactRepoSegment accepts well-formed names and rejects path-traversal / empty', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isArtifactRepoSegment('repo')).toBe(true);
    expect(isArtifactRepoSegment('a.b-c_d')).toBe(true);
    expect(isArtifactRepoSegment('a..b')).toBe(false); // contains ..
    expect(isArtifactRepoSegment('a.')).toBe(false); // ends with .
    expect(isArtifactRepoSegment('.hidden')).toBe(false); // starts with .
    expect(isArtifactRepoSegment('')).toBe(false);
  });

  it('when invoked, should parseConfigLayer returns undefined for missing, the layer for user/project, null for anything else', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(parseConfigLayer(undefined)).toBe(undefined);
    expect(parseConfigLayer('user')).toBe('user');
    expect(parseConfigLayer('project')).toBe('project');
    expect(parseConfigLayer('global')).toBe(null);
  });

  it('when invoked, should multipleOption appends to the accumulated list and tolerates a missing previous', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(multipleOption('a', undefined as unknown as string[])).toEqual(['a']);
    expect(multipleOption('b', ['a'])).toEqual(['a', 'b']);
    expect(multipleOption('c', ['a', 'b'])).toEqual(['a', 'b', 'c']);
  });
});

describe('Scenario: a11y — error envelope hygiene', () => {
  it('when invoked, should printErrorEnvelope never tells the user to type a CLI verb in nextActions', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printErrorEnvelope(io, 'demo', 'CODE', 'msg', {}, [
      'Rerun via the LLM coordinator',
      'Escalate to the orchestrator'
    ]);
    const text = captured.stderrText();
    // nextActions appear inside the JSON envelope (Human-NL-Choice-Only).
    // Verify the production envelope has the documented shape, not the
    // forbidden `peaks <verb>` form.
    expect(text).toMatch(/"nextActions":\s*\[[^\]]*\]/);
    expect(text).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    process.exitCode = exitBefore;
  });

  it('when invoked, should printErrorEnvelope emit exactly one fresh errorId per call and keep a multi-line message verbatim', () => {
    // Renamed by diagnosis E5 (2026-09-15). The old name — "preserves the
    // original errorId across multi-line messages" — named a behaviour
    // printErrorEnvelope does not have: its signature is
    // (io, command, code, message, data, nextActions), it takes no errorId,
    // and it delegates to `fail()`, which mints a fresh UUID per call. The
    // old body asserted only `expect(id).toBeDefined()`, so it passed for
    // any implementation that printed any UUID-shaped string anywhere.
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    try {
      // given: the test setup
      const first = makeCapturedIo();
      // when:  the function under test is invoked
      printErrorEnvelope(first.io, 'demo', 'CODE', 'line1\nline2', {}, []);
      // then:  the result matches the expectation
      const firstText = first.captured.stderrText();
      // Exactly one id: a multi-line message must not be misread as a
      // second envelope (nor may the message echo an id of its own).
      expect(firstText.match(/"errorId":/g) ?? []).toHaveLength(1);
      const id = firstText.match(/"errorId":\s*"([0-9a-f-]{36})"/)?.[1];
      expect(id).toBeDefined();
      // The message survives verbatim (JSON-escaped), which is what makes
      // "one id, not derived from the message" a checkable claim.
      expect(firstText).toContain('line1\\nline2');

      // A second call with byte-identical arguments mints a DIFFERENT id.
      // This is the assertion the old name asserted the opposite of.
      const second = makeCapturedIo();
      printErrorEnvelope(second.io, 'demo', 'CODE', 'line1\nline2', {}, []);
      const secondId = second.captured.stderrText().match(/"errorId":\s*"([0-9a-f-]{36})"/)?.[1];
      expect(secondId).toBeDefined();
      expect(secondId).not.toBe(id);
    } finally {
      process.exitCode = exitBefore;
    }
  });
});

// ---------------------------------------------------------------------------
// PIN — the central exit-code root cause, under review.
//
// THIS TEST DOCUMENTS A KNOWN ROOT CAUSE. IT IS NOT AN ENDORSEMENT OF THE
// BEHAVIOUR IT ASSERTS. It exists so that the day someone makes `printResult`
// assign `process.exitCode`, the suite says so in one place, on purpose,
// instead of that change arriving as an unexplained diff — or, worse, as the
// silent disappearance of this investigation's evidence.
//
// The property, stated plainly: `printResult` renders a failed envelope to
// stderr and returns WITHOUT touching `process.exitCode`. Every caller that
// prints a `fail(...)` envelope and does not separately assign the code
// therefore exits 0 while reporting a failure. Measured on the real CLI
// (`node --import tsx src/cli/index.ts …`, temp project, 2026-09-17):
//
//   peaks complexity-estimate --files " " --project <tmp> --json
//     -> stdout `"ok": false, "code": "INVALID_INPUT"`, EXIT=0
//   peaks fork sync --sync-id no-such-id --project <tmp> --json
//     -> stdout `"ok": false, "code": "NOT_FOUND"`, EXIT=0
//   peaks session primer --project "" --json      [a GUARDED site, control]
//     -> stdout `"ok": false, "code": "PRIMER_EMPTY_PROJECT"`, EXIT=1
//
// The asymmetry above is why this is pinned at the PRINTER and not per caller:
// the guarded control and the unguarded defects are the same envelope shape,
// the same printer, and differ only in whether the enclosing function happened
// to assign the code by hand.
//
// WHY THIS TEST ASSERTS TWICE, ON PURPOSE. Asserting only `exitCode === 0`
// would also pass if `printResult` were replaced by a no-op — a green that
// says nothing. So the same test also asserts the failure IS reported. The two
// assertions together pin "reported, not exited", which is the whole finding.
//
// WHY THE CENTRAL FIX IS STILL NOT OBVIOUS. A blanket
// `if (!result.ok) process.exitCode = 1` would change all 1032 `printResult(`
// call sites in 116 files — and this repo deliberately keeps at least two
// documented exceptions that such a change would break:
//   - `peaks compact settle` (`src/cli/commands/compact-command.ts`): a
//     hook-facing command whose comment reads "the hook path returns before any
//     `process.exitCode` assignment below, so the harness never sees a non-zero
//     exit from this command."
//   - `peaks code-gate --dry-run` (`src/cli/commands/code-gate-command.ts`):
//     the flag is documented as "emit JSON verdict to stdout instead of exit
//     code; useful for tests".
// That is why the shipped remedy so far is per-site (`failResult` in
// `src/cli/commands/job-commands.ts`) rather than central.
//
// rid: 2026-09-17-exit-code-root-cause
// evidence: .peaks/_runtime/2026-09-16-session-5bcf09/rd/requests/013-2026-09-17-exit-code-root-cause.md
// ---------------------------------------------------------------------------
describe('Scenario: behavior — PINNED root cause: printResult does not exit (rid 2026-09-17-exit-code-root-cause)', () => {
  it('when invoked, should record a failed envelope on stderr and LEAVE process.exitCode at 0 — pinned, not endorsed', () => {
    // given: a clean exit-code slate and a failing envelope
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    try {
      const { io, captured } = makeCapturedIo();

      // when:  the printer renders a FAILED envelope for a human
      printResult(io, fail('demo', 'DEMO_ROOT_CAUSE', 'boom', {}), false);

      // then:  the failure is REPORTED — without this a no-op printResult would
      //        satisfy the exit-code assertion below and the pin would be green
      //        for the wrong reason
      expect(captured.stderrText()).toMatch(/^DEMO_ROOT_CAUSE: boom/);
      expect(captured.text()).toBe('');

      // then:  and the exit code is NOT touched. THIS is the pinned root cause.
      expect(
        process.exitCode,
        'PINNED ROOT CAUSE CHANGED (rid 2026-09-17-exit-code-root-cause). ' +
          'printResult() now assigns process.exitCode. That is a CLI-wide exit-code ' +
          'contract change across 1032 call sites in 116 files, not a local fix. ' +
          'Before accepting it: `peaks compact settle` and `peaks code-gate --dry-run` ' +
          'are documented to exit 0 by design, and there are at least 4 more confirmed ' +
          'unguarded sites (complexity-estimate, smoke define, fork sync, impact scan, ' +
          'lint check, ide model, release plan, code-review run-ocr-18) whose fix would ' +
          'be reverted by a central assignment. If the change is deliberate, update this ' +
          'pin and read 013-2026-09-17-exit-code-root-cause.md for the blast-radius count.'
      ).toBe(0);
    } finally {
      process.exitCode = exitBefore;
    }
  });

  it('when invoked, should leave process.exitCode at 0 on the --json path too — the flag picks the channel, not the status', () => {
    // given: the same failed envelope, read by a machine
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    try {
      const { io, captured } = makeCapturedIo();

      // when:  asJson=true routes the envelope to stdout
      printResult(io, fail('demo', 'DEMO_ROOT_CAUSE', 'boom', {}), true);

      // then:  the envelope is on stdout and the code is still untouched
      expect(captured.stderrText()).toBe('');
      expect((JSON.parse(captured.text()) as { ok: boolean; code: string }).ok).toBe(false);
      expect((JSON.parse(captured.text()) as { ok: boolean; code: string }).code).toBe(
        'DEMO_ROOT_CAUSE'
      );
      expect(
        process.exitCode,
        'PINNED ROOT CAUSE CHANGED (rid 2026-09-17-exit-code-root-cause) on the --json path.'
      ).toBe(0);
    } finally {
      process.exitCode = exitBefore;
    }
  });
});
