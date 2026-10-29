// tests/unit/hooks/hook-json-output-shape.test.ts
//
// The SHAPE test for every PreToolUse hook this repository installs on the
// `Bash` matcher. It exists because a unit test over the emit helpers cannot
// see a host-side parse failure: the bug this file pins produced a red
// "Hook JSON output validation failed" line on EVERY Bash call while every
// unit test stayed green.
//
// The host's validator (Claude Code 2.1.312, schema read out of the shipped
// binary) accepts a stdout document only when:
//
//   - the WHOLE of stdout parses as ONE JSON document, and
//   - the root object carries none of these keys with a value outside the
//     host's vocabulary: `decision` (host vocabulary: "approve" | "block"),
//     `hookSpecificOutput.permissionDecision` (host vocabulary: "allow" |
//     "deny" | "ask" | "defer"), and
//   - every OTHER root key is tolerated (measured: an unknown root key passes).
//
// So the invariant pinned here is SHAPE, not one literal string: this file
// asserts the shape, and the shape is what the host reads.
//
// WHICH hooks are pinned, and why the list is DERIVED rather than typed out
// here: the hook commands are read from the two writers that install them —
// `buildClaudeSettingsLocalJson()` for `gate-step-08` / `gate enforce`, and
// `AUTO_COMPACT_HOOK_COMMAND` for the compaction dispatcher. A hardcoded list
// would pass while the installed spelling drifted; a derived one cannot, and a
// plant below fails the file if a NEW hook appears that has no case.
//
// The measured failures this pins:
//   - `peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"` (no `--json`)
//     printed its payload with `decision: null` at the ROOT — the "Invalid
//     option" error — and a trailing `next: ...` prose line, so stdout was not
//     one document either.
//   - `peaks code auto-compact --project .` did the same with
//     `decision: "below-threshold"`.
//   - `peaks gate enforce --project "${CLAUDE_PROJECT_DIR}" --json` was already
//     correct (decision nested under `data`) and is pinned so it stays so. Its
//     allow path used to carry a permission GRANT on top; it grants nothing now.
//
// WHY THE FIXTURE IS A TEMP PROJECT, NOT THIS REPOSITORY. Running the hook
// commands against this repo would make the assertions depend on ambient
// session state (a bound presence makes `gate-step-08` report a job verdict
// instead of passing through) and — worse — `auto-compact` SYNCS
// `CLAUDE_CODE_AUTO_COMPACT_WINDOW` into the project's
// `.claude/settings.local.json`, so a test would edit this machine's settings.
// Every case therefore gets its own temp project, with the installed command's
// own arguments; `${CLAUDE_PROJECT_DIR}` is replaced by that root exactly as the
// host substitutes it. The one extra argument is documented where it appears.
//
// This repository's OWN two layer-B dev hooks
// (`pre-tool-peaks-current-directory-scope.sh`,
// `pre-tool-piping-a-test-run-reports-the-pipes-exit-code.sh`) are registered in
// the tracked `.claude/settings.json`, not in the template, so they are pinned
// separately at the bottom: their allow path prints NOTHING (measured
// 2026-10-29), and "empty OR one JSON document" is their share of the invariant.
//
// Dimensions covered: behavior, integration.
// Dimensions omitted: render - the deny envelope's exact byte shape is pinned by
// tests/unit/hooks/gate-enforce-five-tool-classes.test.ts, which asserts
// `"permissionDecision":"deny"` on stdout together with the block exit code.
// (This file asserts the deny DOCUMENT through the host's rule — one document,
// permissionDecision in the host's vocabulary — because that is what the host
// reads; it does not re-assert the string.)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  emitAllowSkipped,
  emitAllowWorktree,
  emitSopAllow,
  type GateEnforceCliOptions
} from '~/src/cli/commands/gate-commands-enforce';
import { AUTO_COMPACT_HOOK_COMMAND } from '~/src/services/hooks/auto-compact-hook-install';
import { buildClaudeSettingsLocalJson } from '~/src/services/workspace/claude-settings-template';
import { makeCapturedIo } from '../_setup/io.js';
import { runSourceCli, REPO_ROOT, type SourceCliRun } from '../_setup/source-cli.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/**
 * The host's vocabulary, measured from Claude Code 2.1.312's shipped binary.
 * A root key the host OWNS is only legal with one of these values.
 */
const HOST_DECISION_VOCABULARY = new Set(['approve', 'block']);
const HOST_PERMISSION_DECISION_VOCABULARY = new Set(['allow', 'deny', 'ask', 'defer']);

/** A real PreToolUse payload for a Bash tool call. */
const BASH_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });

/** A minimal `allow` SOP decision, shaped like `EnforceDecision`. */
const SOP_ALLOW = { decision: 'allow' as const, warnings: ['gate enforce: no SOP matched'] };

// ---------------------------------------------------------------------------
// Scratch projects
// ---------------------------------------------------------------------------

const scratchRoots: string[] = [];

/** A fresh project root for one case, removed after the file finishes. */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-hook-shape-'));
  scratchRoots.push(root);
  return root;
}

afterAll(() => {
  for (const root of scratchRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// The host's rule, restated
// ---------------------------------------------------------------------------

/**
 * Parse stdout the way the host does: the WHOLE of it must be ONE JSON
 * document. `JSON.parse` over the whole string is the same operation, and it
 * fails on trailing prose (which is what auto-compact used to emit).
 *
 * The `detail` rides the thrown message. Without it a failure here reads as
 * "the shape is wrong" when the truth is "the child never printed" — two
 * different defects, and only one of them is this file's subject.
 */
function parseJsonDocument(stdout: string, detail: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    throw new Error(
      `stdout is not one JSON document (${detail}): ${(error as Error).message}\n` +
        `--- stdout ---\n${stdout}`
    );
  }
  expect(typeof parsed).toBe('object');
  expect(parsed).not.toBeNull();
  expect(Array.isArray(parsed)).toBe(false);
  return parsed as Record<string, unknown>;
}

/** {@link parseJsonDocument} for a real child process, with its exit status in the message. */
function parseHostStdout(run: SourceCliRun): Record<string, unknown> {
  try {
    return parseJsonDocument(run.stdout, `status ${String(run.status)}`);
  } catch (error) {
    throw new Error(`${(error as Error).message}\n--- stderr ---\n${run.stderr}`);
  }
}

/** {@link parseJsonDocument} for an in-process `makeCapturedIo()` capture. */
function parseCaptured(text: string): Record<string, unknown> {
  return parseJsonDocument(text, 'in-process capture');
}

/**
 * The host's own validation rule: no root key the host owns may carry a value
 * outside its vocabulary. A root `decision` the host does not own (absent, or
 * one of the vocabulary's words) is fine.
 */
function assertHostAcceptable(document: Record<string, unknown>): void {
  if ('decision' in document) {
    expect(HOST_DECISION_VOCABULARY).toContain(document.decision);
  }
  const hookSpecificOutput = document.hookSpecificOutput;
  if (typeof hookSpecificOutput === 'object' && hookSpecificOutput !== null) {
    const permissionDecision = (hookSpecificOutput as Record<string, unknown>).permissionDecision;
    if (permissionDecision !== undefined) {
      expect(HOST_PERMISSION_DECISION_VOCABULARY).toContain(permissionDecision);
    }
  }
}

/**
 * Stronger than the host's rule, and the reason this file exists: the two
 * failing hooks carried their OWN notion of a decision in the host's key.
 * A root `decision` is never how these hooks should speak — a deliberate grant
 * would go in `hookSpecificOutput.permissionDecision`, which the cases below
 * assert per hook.
 */
function assertNoRootDecision(document: Record<string, unknown>): void {
  expect(document).not.toHaveProperty('decision');
}

/** The full host check, applied to one run's stdout. */
function assertHostDocument(run: SourceCliRun): Record<string, unknown> {
  const document = parseHostStdout(run);
  assertHostAcceptable(document);
  assertNoRootDecision(document);
  return document;
}

// ---------------------------------------------------------------------------
// The installed hook list, derived from its writers
// ---------------------------------------------------------------------------

/**
 * Every `Bash` PreToolUse hook command the repository installs, read from the
 * writers that install it. `Bash|Task` counts: its matcher includes `Bash`.
 */
function installedBashHookCommands(): string[] {
  const template = buildClaudeSettingsLocalJson();
  const fromTemplate = template.hooks.PreToolUse.filter((entry) =>
    entry.matcher.split('|').includes('Bash')
  ).flatMap((entry) => entry.hooks.map((hook) => hook.command));
  return [...new Set([...fromTemplate, AUTO_COMPACT_HOOK_COMMAND])];
}

/**
 * The argv to run THIS repository's SOURCE CLI with, derived from an installed
 * hook command. `peaks` becomes the source entry point (the global binary is
 * days old and answers differently), and `${CLAUDE_PROJECT_DIR}` becomes the
 * case's project root — the value the host substitutes.
 */
function toSourceArgs(command: string, projectRoot: string): string[] {
  return command
    .trim()
    .replace(/^peaks\s+/, '')
    .split(/\s+/)
    .map((token) => token.replace(/^"|"$/g, '').replace('${CLAUDE_PROJECT_DIR}', projectRoot));
}

/** Run one installed hook command against a project root, with a Bash payload. */
function runInstalledHook(
  command: string,
  projectRoot: string,
  extraArgs: readonly string[] = []
): SourceCliRun {
  return runSourceCli([...toSourceArgs(command, projectRoot), ...extraArgs], {
    input: BASH_PAYLOAD,
    cwd: projectRoot
  });
}

const GATE_STEP_08_COMMAND = 'peaks code gate-step-08 --project "${CLAUDE_PROJECT_DIR}"';
const GATE_ENFORCE_COMMAND = 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}" --json';

/** The three hooks this slice fixed, as the writers spell them. */
const FIXED_HOOKS = [GATE_STEP_08_COMMAND, GATE_ENFORCE_COMMAND, AUTO_COMPACT_HOOK_COMMAND];

describe('Scenario: the installed hook list', () => {
  it('when the hook list is derived from the writers, should cover every hook they install', () => {
    // given: the two writers that install every Bash PreToolUse hook
    // when: the installed hook list is derived from them
    // then: it is non-empty, and a NEWLY installed hook fails here instead of passing unnoticed
    const installed = installedBashHookCommands();
    expect(installed.length).toBeGreaterThanOrEqual(3);
    for (const command of installed) {
      expect(FIXED_HOOKS).toContain(command);
    }
  });
});

// ---------------------------------------------------------------------------
// peaks code gate-step-08 — the job-shape gate
// ---------------------------------------------------------------------------

describe('Scenario: peaks code gate-step-08 (the job-shape gate)', () => {
  it(
    'when the gate passes a call through, should print one host document and grant nothing',
    () => {
      // given: a fresh project with no session, and a Bash payload
      // when: the installed gate-step-08 hook command runs
      // then: stdout is one document, the payload stays under `data`, and nothing is granted
      const run = runInstalledHook(GATE_STEP_08_COMMAND, makeProject());
      const document = assertHostDocument(run);
      expect(run.status).toBe(0);
      // The gate's own decision stays business data under `data`, which is the
      // one key the host does not read as a permission decision.
      expect(document).toMatchObject({ ok: true, command: 'code.gate-step-08' });
      expect(document.data).toMatchObject({ allow: true, mode: 'no-session' });
      expect(document.nextActions).toBeInstanceOf(Array);
      // A pass-through is not a grant: `permissionDecision: "allow"` would make
      // the host skip the user's own permission prompt (see HOOK_ALLOW_DECISION).
      expect(document).not.toHaveProperty('hookSpecificOutput');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the Step 0.8 backup prompt is seen, should emit the host deny document at exit 2',
    () => {
      // given: a scratch project with no decision or ledger, and the Step 0.8 backup prompt
      // when: the installed gate-step-08 hook command runs
      // then: it exits 2 with the host's DENY document, and the reason reaches stderr
      const run = runInstalledHook(GATE_STEP_08_COMMAND, makeProject(), [
        '--session-id',
        '2026-10-28-shape-block-probe',
        // The Step 0.8 backup regex matches this prompt, and no decision or
        // ledger is recorded in the scratch project.
        '--prompt',
        '继续执行下个 slice,直到全部添加完,不用考虑费用'
      ]);
      expect(run.status).toBe(2);
      const document = assertHostDocument(run);
      expect(document.hookSpecificOutput).toMatchObject({
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny'
      });
      // The reason must reach the LLM on the next turn; stderr is that channel.
      expect(run.stderr).toContain('BLOCKED:');
      expect(run.stderr).toContain('peaks code detect-job');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it(
    'when the blocked path is asked for --json, should keep the failure envelope on stdout',
    () => {
      // given: the same Step 0.8 backup prompt, with `--json` added
      // when: the installed gate-step-08 hook command runs
      // then: stdout is still one host document, carrying the STEP_08_BLOCKED envelope at exit 2
      const run = runInstalledHook(GATE_STEP_08_COMMAND, makeProject(), [
        '--session-id',
        '2026-10-28-shape-block-probe',
        '--prompt',
        '继续执行下个 slice,直到全部添加完,不用考虑费用',
        '--json'
      ]);
      expect(run.status).toBe(2);
      const document = assertHostDocument(run);
      expect(document).toMatchObject({ ok: false, code: 'STEP_08_BLOCKED' });
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// peaks gate enforce --json — the SOP / worktree gate
// ---------------------------------------------------------------------------

describe('Scenario: peaks gate enforce --json (the SOP/worktree gate)', () => {
  const options: GateEnforceCliOptions = { project: '.', json: true };

  it(
    'when gate enforce runs, should print one host document and grant nothing',
    () => {
      // given: a fresh project, and the hook that gates every Bash call
      // when: the installed gate enforce --json command runs
      // then: stdout is one document, and it carries no permission grant
      const run = runInstalledHook(GATE_ENFORCE_COMMAND, makeProject());
      const document = assertHostDocument(run);
      expect(run.status).toBe(0);
      // A gate that passes a call through has no opinion to give: an allow
      // decision would be a real GRANT that skips the user's own permission
      // prompt, so the document carries no `hookSpecificOutput` at all.
      expect(document).not.toHaveProperty('hookSpecificOutput');
      // The envelope a downstream consumer parses keeps its field names and values.
      expect(document).toMatchObject({ ok: true, command: 'gate.enforce' });
      expect(document.data).toMatchObject({ decision: 'allow' });
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );

  it('when the SOP check is skipped, should emit one JSON document the host accepts', () => {
    // given: an in-process capture around `emitAllowSkipped`
    // when: the skipped allow path is emitted
    // then: stdout is one document the host accepts, with no root-level decision
    const { io, captured } = makeCapturedIo();
    emitAllowSkipped(io, options);
    const document = parseCaptured(captured.text());
    assertHostAcceptable(document);
    assertNoRootDecision(document);
    expect(document).not.toHaveProperty('hookSpecificOutput');
  });

  it('when the call runs inside the allowed worktree, should emit one document the host accepts', () => {
    // given: an in-process capture around `emitAllowWorktree`
    // when: the worktree-allowed path is emitted
    // then: stdout is one document the host accepts, with no root-level decision
    const { io, captured } = makeCapturedIo();
    emitAllowWorktree(io, options);
    const document = parseCaptured(captured.text());
    assertHostAcceptable(document);
    assertNoRootDecision(document);
    expect(document).not.toHaveProperty('hookSpecificOutput');
  });

  it('when an SOP matches, should emit one JSON document the host accepts', () => {
    // given: an in-process capture around `emitSopAllow`, with a minimal allow decision
    // when: the SOP-allowed path is emitted
    // then: stdout is one document the host accepts, with no root-level decision
    const { io, captured } = makeCapturedIo();
    emitSopAllow(io, options, SOP_ALLOW);
    const document = parseCaptured(captured.text());
    assertHostAcceptable(document);
    assertNoRootDecision(document);
    expect(document).not.toHaveProperty('hookSpecificOutput');
  });

  it('when an allow path is emitted, should keep the envelope fields tooling reads', () => {
    // given: an in-process capture around the skipped allow path
    // when: the emitted envelope is read
    // then: ok, command, data.decision, warnings and nextActions keep their values
    const { io, captured } = makeCapturedIo();
    emitAllowSkipped(io, options);

    const document = parseCaptured(captured.text());
    // The envelope a downstream consumer parses keeps its field names and
    // values. `data.decision` is still `allow` on the skipped path.
    expect(document.ok).toBe(true);
    expect(document.command).toBe('gate.enforce');
    expect(document.data).toMatchObject({ decision: 'allow' });
    expect(document.warnings).toBeDefined();
    expect(document.nextActions).toBeDefined();
  });

  it('when an allow path is emitted, should keep the decision under `data`', () => {
    // given: an in-process capture around the skipped allow path
    // when: the emitted envelope is read
    // then: the gate's own decision stays under `data`, never at the root the host owns
    const { io, captured } = makeCapturedIo();
    emitAllowSkipped(io, options);
    const document = parseCaptured(captured.text());
    expect(document).not.toHaveProperty('decision');
    expect(document.data).toMatchObject({ decision: 'allow', skipped: true });
  });
});

// ---------------------------------------------------------------------------
// peaks code auto-compact — the compaction dispatcher
// ---------------------------------------------------------------------------

describe('Scenario: peaks code auto-compact (the compaction dispatcher)', () => {
  it(
    'when auto-compact runs inside a bound session, should print one document and grant nothing',
    () => {
      // given: a fresh project, and `--session-id` — the one argument the installed spelling
      //   omits: without a session the command exits 1 with EMPTY stdout, a precondition
      //   failure rather than the shape this case measures
      // when: the installed auto-compact hook command runs
      // then: stdout is one document, the verdict stays under `data`, and nothing is granted
      const run = runInstalledHook(AUTO_COMPACT_HOOK_COMMAND, makeProject(), [
        '--session-id',
        '2026-10-28-shape-auto-compact'
      ]);
      const document = assertHostDocument(run);

      expect(run.status).toBe(0);
      expect(document).toMatchObject({ ok: true, command: 'code.auto-compact' });
      // The compaction verdict is business data and stays readable — under
      // `data`, the key the host does not own.
      expect(document.data).toMatchObject({ decision: 'below-threshold' });
      expect(document.nextActions).toBeInstanceOf(Array);

      expect(document).not.toHaveProperty('hookSpecificOutput');
    },
    SUBPROCESS_TEST_TIMEOUT_MS
  );
});

// ---------------------------------------------------------------------------
// This repository's own layer-B dev hooks (tracked .claude/settings.json)
// ---------------------------------------------------------------------------

describe('Scenario: this repository’s own layer-B dev hooks', () => {
  /**
   * Read from the TRACKED settings file rather than a list here: these two are
   * registered per-repository, so a list would be a second copy that can drift.
   */
  function trackedBashHookCommands(): string[] {
    const settings = JSON.parse(
      readFileSync(resolve(REPO_ROOT, '.claude', 'settings.json'), 'utf8')
    ) as { hooks?: { PreToolUse?: { matcher: string; hooks: { command: string }[] }[] } };
    const entries = settings.hooks?.PreToolUse ?? [];
    return entries
      .filter((entry) => entry.matcher.split('|').includes('Bash'))
      .flatMap((entry) => entry.hooks.map((hook) => hook.command));
  }

  it('when the tracked settings are read, should find the layer-B hooks', () => {
    // given: the tracked `.claude/settings.json`
    // when: its Bash PreToolUse commands are read
    // then: there are at least two — an empty list would make the cases below vacuous
    expect(trackedBashHookCommands().length).toBeGreaterThanOrEqual(2);
  });

  it.each(trackedBashHookCommands())('%s → stdout is empty or ONE JSON document', (command) => {
    const run = spawnSync('bash', ['-c', command], {
      input: BASH_PAYLOAD,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT }
    });

    expect(run.status).toBe(0);
    const stdout = (run.stdout ?? '').trim();
    // Empty is this hook's allow answer (measured 2026-10-29). Anything else
    // must be a document the host can parse — never a payload or prose.
    if (stdout.length > 0) {
      const document = parseJsonDocument(stdout, `status ${String(run.status)}`);
      assertHostAcceptable(document);
      assertNoRootDecision(document);
    }
  });
});
