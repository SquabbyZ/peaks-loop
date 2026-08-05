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
  [{ dim: 'integration', reason: 'cli-helpers.ts is a pure module.' }],
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
  type ProgramIO,
} from '~/src/cli/cli-helpers';
import { fail, ok } from 'peaks-loop-shared/result';

describe("Scenario: render — printResult shape", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should ok result with asJson=true prints the full envelope as pretty JSON", () => {
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

  it("when invoked, should err result with asJson=true prints the full envelope verbatim", () => {
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

  it("when invoked, should ok result with asJson=false prints data + warnings + next actions", () => {
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

  it("when invoked, should err result with asJson=false writes code + message + each nextAction to stderr", () => {
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
});

describe("Scenario: render — printSuperCommandCatalog", () => {
  it("when invoked, should emits the documented 8 super-commands + footer", () => {
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

describe("Scenario: render — printErrorEnvelope", () => {
  it("when invoked, should writes a pretty fail() envelope to stderr and sets process.exitCode = 1", () => {
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

  it("when invoked, should redacts Bearer / API-key strings inside the message BEFORE printing", () => {
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

describe("Scenario: render — printCliEnvelope", () => {
  it("when invoked, should ok: writes { ok: true, data } to stdout and does not change exitCode", () => {
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

  it("when invoked, should err: writes { ok: false, error } to stdout and sets exitCode = 1", () => {
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

describe("Scenario: render — printInvalidConfigLayer", () => {
  it("when invoked, should writes the INVALID_CONFIG_LAYER envelope and sets exitCode = 1", () => {
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

describe("Scenario: render — addJsonOption", () => {
  it("when invoked, should attaches a --json boolean option to a Commander command", () => {
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

describe("Scenario: behavior — predicates + parsers", () => {
  it("when invoked, should isRecommendationWorkflow accepts the 3 documented values", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isRecommendationWorkflow('code-refactor')).toBe(true);
    expect(isRecommendationWorkflow('product-refactor')).toBe(true);
    expect(isRecommendationWorkflow('frontend-design')).toBe(true);
    expect(isRecommendationWorkflow('nope')).toBe(false);
    expect(isRecommendationWorkflow('')).toBe(false);
  });

  it("when invoked, should isArtifactProvider accepts the 2 documented providers", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isArtifactProvider('github')).toBe(true);
    expect(isArtifactProvider('gitlab')).toBe(true);
    expect(isArtifactProvider('bitbucket')).toBe(false);
  });

  it("when invoked, should isArtifactSetupStep accepts detect/configure/validate/complete", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(isArtifactSetupStep('detect')).toBe(true);
    expect(isArtifactSetupStep('configure')).toBe(true);
    expect(isArtifactSetupStep('validate')).toBe(true);
    expect(isArtifactSetupStep('complete')).toBe(true);
    expect(isArtifactSetupStep('nope')).toBe(false);
  });

  it("when invoked, should isArtifactRepoSegment accepts well-formed names and rejects path-traversal / empty", () => {
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

  it("when invoked, should parseConfigLayer returns undefined for missing, the layer for user/project, null for anything else", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(parseConfigLayer(undefined)).toBe(undefined);
    expect(parseConfigLayer('user')).toBe('user');
    expect(parseConfigLayer('project')).toBe('project');
    expect(parseConfigLayer('global')).toBe(null);
  });

  it("when invoked, should multipleOption appends to the accumulated list and tolerates a missing previous", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(multipleOption('a', undefined as unknown as string[])).toEqual(['a']);
    expect(multipleOption('b', ['a'])).toEqual(['a', 'b']);
    expect(multipleOption('c', ['a', 'b'])).toEqual(['a', 'b', 'c']);
  });
});

describe("Scenario: a11y — error envelope hygiene", () => {
  it("when invoked, should printErrorEnvelope never tells the user to type a CLI verb in nextActions", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printErrorEnvelope(io, 'demo', 'CODE', 'msg', {}, ['Rerun via the LLM coordinator', 'Escalate to the orchestrator']);
    const text = captured.stderrText();
    // nextActions appear inside the JSON envelope (Human-NL-Choice-Only).
    // Verify the production envelope has the documented shape, not the
    // forbidden `peaks <verb>` form.
    expect(text).toMatch(/"nextActions":\s*\[[^\]]*\]/);
    expect(text).not.toMatch(/peaks\s+[a-z][a-z-]+/);
    process.exitCode = exitBefore;
  });

  it("when invoked, should printErrorEnvelope preserves the original errorId across multi-line messages", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const exitBefore = process.exitCode;
    process.exitCode = 0;
    const { io, captured } = makeCapturedIo();
    printErrorEnvelope(io, 'demo', 'CODE', 'line1\nline2', {}, []);
    const text = captured.stderrText();
    const id = text.match(/"errorId":\s*"([0-9a-f-]{36})"/)?.[1];
    expect(id).toBeDefined();
    process.exitCode = exitBefore;
  });
});
