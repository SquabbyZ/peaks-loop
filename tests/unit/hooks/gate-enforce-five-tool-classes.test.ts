// tests/unit/hooks/gate-enforce-five-tool-classes.test.ts
//
// AC-9 of the rid-035 PRD (QA repair cycle 1, P3):
//
//   "对 Bash / Agent / Task / EnterWorktree / Workflow 五类既有调用的放行-阻断结果
//    与改动前逐例一致。"
//
// QA measured that this held only BY CODE IDENTITY: `grep EnterWorktree tests/`
// was 0 hits, so nothing enumerated the five classes and nothing would notice if
// one of them silently changed class. This file enumerates all five and pins,
// per class, two facts: the tool name -> internal kind mapping, and the
// resulting allow/block decision.
//
// It drives the REAL code the PreToolUse hook drives - `classifyTool` ->
// `handleWorktreeGate` -> `evaluateWorktreeAuth` - with the REAL payload shape,
// and hands `handleWorktreeGate` the parsed stdin + command exactly as
// `runGateEnforceAction` does. The assembly is not re-implemented here, so this
// test cannot agree with a private copy of the logic instead of the logic.
//
// Dimensions covered: behavior, integration, a11y.
// Dimensions omitted: render - the deny envelope's exact byte shape is pinned by
// the hook output contract suite; this file only asserts the decision.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { classifyTool, handleWorktreeGate } from '~/src/cli/commands/gate-commands-enforce';
import { parseClaudeShapeStdin } from '~/src/services/ide/hook-translator';
import {
  decideFromAuthorization,
  type ToolCallKind
} from '~/src/services/hooks/worktree-authorization-gate';
import { HOOK_BLOCK_EXIT_CODE } from '~/src/services/hooks/output';
import { DISPATCH_PROVENANCE_ENV } from '~/src/services/worktree/dispatch-provenance';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';

declareDimensions(
  'tests/unit/hooks/gate-enforce-five-tool-classes.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the deny envelope shape is pinned by the hook output contract suite.'
    }
  ]
);

/** The five tool classes the PRD names, verbatim. */
const FIVE_TOOL_CLASSES = ['Bash', 'Agent', 'Task', 'EnterWorktree', 'Workflow'] as const;

interface ClassCase {
  readonly toolName: (typeof FIVE_TOOL_CLASSES)[number];
  /** One Claude-shaped PreToolUse payload for this class. */
  readonly payload: Record<string, unknown>;
  /** What `classifyTool` must map it to. */
  readonly kind: ToolCallKind;
  /** The allow/block result of the worktree gate. */
  readonly blocked: boolean;
  readonly why: string;
}

const CASES: readonly ClassCase[] = [
  {
    toolName: 'Bash',
    payload: { tool_name: 'Bash', tool_input: { command: 'git worktree add ../wt' } },
    kind: 'Bash',
    blocked: true,
    why: 'a worktree-mutating Bash command is gated'
  },
  {
    toolName: 'Bash',
    payload: { tool_name: 'Bash', tool_input: { command: 'ls' } },
    kind: 'Bash',
    blocked: false,
    why: 'a Bash command that is not worktree-mutating is not gated'
  },
  {
    toolName: 'Agent',
    payload: { tool_name: 'Agent', tool_input: { isolation: 'worktree' } },
    kind: 'Agent',
    blocked: true,
    why: 'a worktree-isolated Agent is gated'
  },
  {
    toolName: 'Agent',
    payload: { tool_name: 'Agent', tool_input: { prompt: 'summarise the module' } },
    kind: 'Agent',
    blocked: false,
    why: 'an Agent without worktree isolation is not gated'
  },
  {
    toolName: 'Task',
    payload: { tool_name: 'Task', tool_input: { isolation: 'worktree' } },
    kind: 'Agent',
    blocked: true,
    why: 'Task is folded into the Agent class, so it is gated identically'
  },
  {
    toolName: 'EnterWorktree',
    payload: { tool_name: 'EnterWorktree' },
    kind: 'EnterWorktree',
    blocked: true,
    why: 'the explicit EnterWorktree tool is always gated'
  },
  {
    toolName: 'Workflow',
    payload: { tool_name: 'Workflow' },
    kind: 'Workflow',
    blocked: false,
    why: 'no worktree-creating Workflow tool exists, so the gate is a no-op'
  }
];

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpRoots.length = 0;
});

/** An empty project root: no worktree-auth.json, so every gated call fails closed. */
function makeEmptyProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-gate-five-'));
  tmpRoots.push(root);
  return root;
}

/** Keep the lease / provenance env out of the decision, so a class cannot flip by leaking state. */
function clearGateEnv(): void {
  withEnv('PEAKS_WORKTREE_LEASE_ID', undefined);
  withEnv('PEAKS_CONTAINER_LEASE_ID', undefined);
  withEnv(DISPATCH_PROVENANCE_ENV, undefined);
}

describe('Scenario: behavior - the five tool classes are all enumerated', () => {
  it('when the cases are read, should cover exactly the five PRD classes', () => {
    // given: the enumerated cases
    // when:  the distinct tool names are collected
    const covered = [...new Set(CASES.map((testCase) => testCase.toolName))].sort();
    // then:  all five are present, and no case names a class the PRD did not list
    expect(covered).toEqual([...FIVE_TOOL_CLASSES].sort());
  });

  it('when each class is classified, should map to the kind the gate documents', () => {
    // given: each class's payload, parsed exactly as the hook parses stdin
    // when:  the tool name is classified
    // then:  the mapping is pinned per class, including Task -> Agent
    for (const testCase of CASES) {
      const { toolName } = parseClaudeShapeStdin(testCase.payload);
      expect(classifyTool(toolName), testCase.toolName).toBe(testCase.kind);
    }
  });
});

describe('Scenario: integration - each class keeps its allow/block result', () => {
  for (const testCase of CASES) {
    const label = `${testCase.toolName} (${testCase.why})`;
    it(`when ${label} is gated, should ${testCase.blocked ? 'block' : 'allow'} it`, () => {
      // given: an empty project root - no worktree grant exists, so the gate is fail-closed
      clearGateEnv();
      const root = makeEmptyProject();
      const { io } = makeCapturedIo();
      const previousExitCode = process.exitCode;
      try {
        const parsed = parseClaudeShapeStdin(testCase.payload);
        const kind = classifyTool(parsed.toolName);
        // when:  the worktree gate runs, exactly as the hook runs it
        const blocked = handleWorktreeGate(io, { project: root, json: false }, kind, {
          command: parsed.command,
          parsedStdin: testCase.payload
        });
        // then:  this class's decision is what it was before the readonly slice
        expect(blocked, label).toBe(testCase.blocked);
      } finally {
        process.exitCode = previousExitCode;
      }
    });
  }
});

describe('Scenario: a11y - a blocked class explains itself and an allowed one stays silent', () => {
  it('when a class is blocked, should emit the deny envelope with the block exit code', () => {
    // given: a gated class with no grant
    clearGateEnv();
    const root = makeEmptyProject();
    const { io, captured } = makeCapturedIo();
    const previousExitCode = process.exitCode;
    try {
      const testCase = CASES.find((candidate) => candidate.toolName === 'EnterWorktree');
      expect(testCase).toBeDefined();
      const parsed = parseClaudeShapeStdin(testCase?.payload ?? {});
      // when:  the gate blocks it
      const blocked = handleWorktreeGate(
        io,
        { project: root, json: false },
        classifyTool(parsed.toolName),
        { command: parsed.command, parsedStdin: testCase?.payload }
      );
      // then:  the reason is on stdout as a deny decision, and exit 2 signals the block
      expect(blocked).toBe(true);
      expect(captured.text()).toContain('"permissionDecision":"deny"');
      expect(captured.stderrText()).toContain('worktree');
      expect(process.exitCode).toBe(HOOK_BLOCK_EXIT_CODE);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('when a class is allowed, should write no deny envelope and leave the exit code alone', () => {
    // given: an ungated class, and an exit code deliberately parked on a non-zero value
    clearGateEnv();
    const root = makeEmptyProject();
    const { io, captured } = makeCapturedIo();
    const previousExitCode = process.exitCode;
    process.exitCode = 7;
    try {
      const testCase = CASES.find((candidate) => candidate.toolName === 'Workflow');
      const parsed = parseClaudeShapeStdin(testCase?.payload ?? {});
      // when:  the gate runs
      const blocked = handleWorktreeGate(
        io,
        { project: root, json: false },
        classifyTool(parsed.toolName),
        { command: parsed.command, parsedStdin: testCase?.payload }
      );
      // then:  nothing was blocked and the caller's exit code is untouched - an
      //        allow inside the gate never writes a decision of its own
      expect(blocked).toBe(false);
      expect(captured.text()).not.toContain('permissionDecision');
      expect(process.exitCode).toBe(7);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

/**
 * The DENY TEXT, not the decision.
 *
 * The gate's reader is the agent, and the agent is the party the gate exists to
 * constrain, so a refusal that tells its reader to run `peaks worktree auth
 * grant` routes it to an action it cannot complete — the measured defect. The
 * arms below pin BOTH directions: the user-side path is named, AND the old
 * instruction is gone. The second arm is the one that matters, because a
 * message can gain the new sentence and keep the impossible one.
 */
describe('Scenario: a11y - the refusal names the user-side path, not an impossible one', () => {
  const IMPOSSIBLE_INSTRUCTION =
    'Ask the user to explicitly authorize this worktree-mutating operation, then run';

  function denyStashDrop(): { blocked: boolean; text: string } {
    clearGateEnv();
    const root = makeEmptyProject();
    const { io, captured } = makeCapturedIo();
    const payload = {
      tool_name: 'Bash',
      tool_input: { command: 'git stash drop stash@{0}' }
    };
    const parsed = parseClaudeShapeStdin(payload);
    const blocked = handleWorktreeGate(
      io,
      { project: root, json: false },
      classifyTool(parsed.toolName),
      {
        command: parsed.command,
        parsedStdin: payload
      }
    );
    return { blocked, text: `${captured.text()}\n${captured.stderrText()}` };
  }

  it('when a stash drop is refused, should keep the code and the exit behaviour', () => {
    const previousExitCode = process.exitCode;
    try {
      const { blocked, text } = denyStashDrop();
      // then: the refusal itself is unchanged - same code, same block exit code
      expect(blocked).toBe(true);
      expect(process.exitCode).toBe(HOOK_BLOCK_EXIT_CODE);
      expect(text).toContain('WORKTREE_USER_AUTH_REQUIRED');
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('when the text is read, should name the user-side path and drop the impossible one', () => {
    const previousExitCode = process.exitCode;
    try {
      const { text } = denyStashDrop();
      // then: the reader is told whose authorization this is, and how it is recorded
      expect(text).toContain("The authorization is the USER's to give");
      expect(text).toContain('peaks worktree auth grant --operation git-stash-mutating');
      // and: the sentence that routed the reader to a refused command is gone
      expect(text).not.toContain(IMPOSSIBLE_INSTRUCTION);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  /**
   * The message must not promise an issuer check the gate does not have.
   *
   * A first revision of this text said an agent-issued grant "is not the consent
   * this gate checks for, so the reader cannot satisfy this refusal itself".
   * That was false, and the test below is built from the input that makes it
   * false rather than from an idea of it: a well-formed grant whose `reason`
   * says out loud that no user was involved. Both arms are needed — the text arm
   * keeps the sentence from coming back, and the behaviour arm keeps the text
   * honest if the gate ever DOES learn to check the issuer (it would then have
   * to change this text, and this arm would redden).
   *
   * Measured end to end before the repair: exit 2 for `git stash drop stash@{0}`
   * → the agent runs `worktree auth grant --reason "the agent wrote this itself;
   * no user was involved"` (`ok: true`) → the SAME call exits 0.
   */
  it('when a grant carries an agent-written reason, should still be accepted — so the text cannot deny it', () => {
    const sessionId = '2026-10-13-session-self-grant';
    const issuedAt = new Date();
    const file = {
      schemaVersion: 1 as const,
      sessionId,
      createdAt: issuedAt.toISOString(),
      grants: [
        {
          operation: 'git-stash-mutating' as const,
          reason: 'the agent wrote this itself; no user was involved',
          promptHash: null,
          requestId: null,
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + 300_000).toISOString(),
          consume: false,
          consumed: false
        }
      ]
    };

    const decision = decideFromAuthorization(
      {
        projectRoot: '.',
        sessionId,
        toolName: 'Bash',
        command: 'git stash drop stash@{0}',
        isolation: null,
        requestId: null,
        leaseId: null,
        containerLeaseId: null
      },
      'git-stash-mutating',
      file
    );

    // then: nothing about the issuer mattered. If this ever flips to false, the
    // gate grew an issuer check and the denial text has to be rewritten again.
    expect(decision.allow).toBe(true);

    // and: the denial text does not claim otherwise
    const previousExitCode = process.exitCode;
    try {
      const { text } = denyStashDrop();
      expect(text).not.toContain('cannot satisfy this refusal itself');
      expect(text).not.toContain('is not the consent this gate checks for');
      expect(text).toContain('Nothing in the gate records or checks WHO issued a grant');
      // the ask survives, because the rule survives even though the gate cannot enforce it
      expect(text).toContain('ask them first');
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});
