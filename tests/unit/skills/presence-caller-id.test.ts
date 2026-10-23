// tests/unit/skills/presence-caller-id.test.ts
//
// The defect: `peaks skill presence:set` required an adapter-resolved
// callerId and had no escape hatch, so on any host that is not Claude Code
// the lease could never be built → `presence` answered `active: false` →
// the status header never appeared. `peaks request init` already had the
// vendor-neutral escape hatches (`--caller-id` / `PEAKS_CALLER_ID`);
// `presence:set` had neither.
//
// The fix: `presence:set` accepts `--caller-id <id>` and reads
// `PEAKS_CALLER_ID`, with the same priority chain as `request init`
// (flag > env > active IDE adapter) and the same D1 validation
// (`^[a-zA-Z0-9._-]{1,200}$`).
//
// The contract that must NOT move: with no caller id at all, the write
// stays fail-closed (`PEAKS_CALLER_NOT_RESOLVED`, exit 1, no lease).
//
// Every case runs in a throwaway temp workspace — this suite never reads
// or writes the real repository's `.peaks/**`.
//
// Dimensions covered:
//   - behavior:    the priority chain and the fail-closed refusal
//   - integration: real leases on disk in a temp project, read back
//   - render:      the `peaks skill presence --json` envelope
//   - a11y:        the human-readable refusal + the exit codes
//
// Run with: pnpm vitest run tests/unit/skills/presence-caller-id.test.ts

import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';

declareDimensions('tests/unit/skills/presence-caller-id.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-24-session-caller01';

let ws: TmpWorkspace;
const savedEnv = { ...process.env };
let savedExitCode: number | string | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-presence-caller-id-');
  // The caller id must NOT resolve, or the "no caller id" case would be
  // decided by an ambient binding instead of the fixture.
  delete process.env.PEAKS_CALLER_ID;
  delete process.env.PEAKS_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_ACTIVE_SKILL;
  savedExitCode = process.exitCode;
  seedBoundSession(ws.path, SESSION_ID);
});

afterEach(() => {
  process.exitCode = savedExitCode;
  Object.assign(process.env, savedEnv);
  cleanupTmpWorkspace();
});

/* ---------- fixtures ---------- */

/** Point the project-global binding at a session tree. */
function seedBoundSession(projectRoot: string, sessionId: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: new Date().toISOString(), projectRoot }, null, 2),
    'utf8'
  );
}

/** The lease files of the bound session tree. */
function leaseFiles(projectRoot: string, sessionId: string): string[] {
  const dir = join(projectRoot, '.peaks', '_runtime', sessionId, 'leases');
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith('presence-') && name.endsWith('.json'));
}

/** The `callerId` recorded on the (single) lease of the bound tree. */
function leaseCallerId(projectRoot: string, sessionId: string): string | undefined {
  const files = leaseFiles(projectRoot, sessionId);
  const first = files[0];
  if (first === undefined) return undefined;
  const raw = readFileSync(
    join(projectRoot, '.peaks', '_runtime', sessionId, 'leases', first),
    'utf8'
  );
  return (JSON.parse(raw) as { callerId?: string }).callerId;
}

/** Run one `peaks skill ...` invocation against the temp workspace. */
async function runSkill(args: readonly string[]): Promise<{
  envelope: Record<string, unknown>;
  stdout: string;
}> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillCommand(program, io);
  await program.parseAsync(['skill', ...args], { from: 'user' });
  const stdout = captured.text();
  return { envelope: JSON.parse(stdout) as Record<string, unknown>, stdout };
}

/* ---------- behavior: the priority chain ---------- */

describe('Scenario: behavior — the presence:set caller-id priority chain', () => {
  it('when an explicit --caller-id is given, should build the lease with that caller id', async () => {
    // given: a temp project with a bound session tree and no caller id in the environment
    // when: presence:set runs with an explicit --caller-id
    // then: the lease is written with that caller id
    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--mode',
      'full-auto',
      '--gate',
      'startup',
      '--caller-id',
      'flag-caller',
      '--json'
    ]);

    expect(envelope.ok).toBe(true);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('flag-caller');
    });
  });

  it('when PEAKS_CALLER_ID is set and no flag is given, should build the lease with the env caller id', async () => {
    // given: a temp project with a bound session tree and no caller id in the environment
    // when: presence:set runs with PEAKS_CALLER_ID set and no flag
    // then: the lease is written with the env caller id
    process.env.PEAKS_CALLER_ID = 'env-caller';

    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--json'
    ]);

    expect(envelope.ok).toBe(true);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('env-caller');
    });
  });

  it('when both the flag and the env var are set, should let the flag win', async () => {
    // given: a temp project with a bound session tree and PEAKS_CALLER_ID set
    // when: presence:set runs with both a --caller-id flag and the env var
    // then: the lease is written with the flag caller id
    process.env.PEAKS_CALLER_ID = 'env-caller';

    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--caller-id',
      'flag-caller',
      '--json'
    ]);

    expect(envelope.ok).toBe(true);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('flag-caller');
    });
  });

  it('when no caller id can be resolved at all, should stay fail-closed and write no lease', async () => {
    // given: a temp project with a bound session tree and no caller id in the environment
    // when: presence:set runs with no caller id at all
    // then: the command is refused with PEAKS_CALLER_NOT_RESOLVED and writes no lease
    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--mode',
      'full-auto',
      '--json'
    ]);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PEAKS_CALLER_NOT_RESOLVED');
    expect(process.exitCode).toBe(1);
    expect(leaseFiles(ws.path, SESSION_ID)).toEqual([]);
  });
});

/* ---------- integration: the lease on disk ---------- */

describe('Scenario: integration — the lease a non-Claude-Code host can build', () => {
  it('when presence:set ran with --caller-id, should read the lease back as active with the right skill and gate', async () => {
    // given: a lease written with an explicit caller id, a skill and a gate
    // when: the presence is read back
    // then: the read reports the lease as active with the same skill and gate
    await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--mode',
      'full-auto',
      '--gate',
      'startup',
      '--caller-id',
      'flag-caller',
      '--json'
    ]);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('flag-caller');
    });

    const { envelope } = await runSkill(['presence', '--project', ws.path, '--json']);
    const data = envelope.data as Record<string, unknown>;

    expect(data.active).toBe(true);
    expect(data.skill).toBe('peaks-code');
    expect(data.gate).toBe('startup');
    expect(data.mode).toBe('full-auto');
  });

  it('when the presence was written with an explicit caller id, should not report it stale', async () => {
    // given: a lease written with an explicit caller id
    // when: the presence is read with --check-stale
    // then: the lease is not reported as stale
    await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--gate',
      'startup',
      '--caller-id',
      'flag-caller',
      '--json'
    ]);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('flag-caller');
    });

    const { envelope } = await runSkill([
      'presence',
      '--project',
      ws.path,
      '--check-stale',
      '--json'
    ]);
    const data = envelope.data as Record<string, unknown>;

    expect(data.stale).toBe(false);
    expect(data.staleReason).toBeNull();
  });

  it('when the project binding points at another empty session tree, should still see the live lease', async () => {
    // given: a project bound to an empty session tree, and a live lease in another tree
    // when: the presence is read
    // then: the live lease is still reported as active
    await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--gate',
      'startup',
      '--caller-id',
      'flag-caller',
      '--json'
    ]);
    await vi.waitFor(() => {
      expect(leaseCallerId(ws.path, SESSION_ID)).toBe('flag-caller');
    });
    // The binding now points at a tree that holds NO lease.
    seedBoundSession(ws.path, '2026-10-23-session-emptyee');

    const { envelope } = await runSkill(['presence', '--project', ws.path, '--json']);
    const data = envelope.data as Record<string, unknown>;

    expect(data.active).toBe(true);
    expect(data.skill).toBe('peaks-code');
  });
});

/* ---------- render: the presence envelope ---------- */

describe('Scenario: render — the presence:set envelope', () => {
  it('when presence:set succeeds, should report the recorded skill, mode and gate', async () => {
    // given: a temp project with a bound session tree
    // when: presence:set runs with a skill, a mode and a gate
    // then: the envelope reports the recorded skill, mode and gate
    const { envelope } = await runSkill([
      'presence:set',
      'peaks-rd',
      '--project',
      ws.path,
      '--mode',
      'assisted',
      '--gate',
      'qa-validation',
      '--caller-id',
      'flag-caller',
      '--json'
    ]);

    expect(envelope.ok).toBe(true);
    const data = envelope.data as Record<string, unknown>;
    expect(data.active).toBe(true);
    expect(data.skill).toBe('peaks-rd');
    expect(data.mode).toBe('assisted');
    expect(data.gate).toBe('qa-validation');
  });

  it('when the --caller-id option is registered, should document the priority chain in its help text', () => {
    // given: the registered presence:set command
    // when: its --caller-id option is looked up
    // then: the option exists and its help text names the flag, the env var and the adapter
    const { io } = makeCapturedIo();
    const program = new Command();
    registerSkillCommand(program, io);
    const skill = program.commands.find((c) => c.name() === 'skill');
    const presenceSet = skill?.commands.find((c) => c.name() === 'presence:set');
    const option = presenceSet?.options.find((o) => o.long === '--caller-id');

    expect(option).toBeDefined();
    expect(option?.description).toContain('--caller-id');
    expect(option?.description).toContain('PEAKS_CALLER_ID');
    expect(option?.description).toContain('adapter');
  });
});

/* ---------- a11y: the human-facing refusal ---------- */

describe('Scenario: a11y — a malformed caller id is refused in plain language', () => {
  it('when --caller-id does not match the D1 regex, should refuse with a readable message and exit 65', async () => {
    // given: a temp project with a bound session tree
    // when: presence:set runs with a caller id that breaks the D1 pattern
    // then: the command is refused with CALLER_ID_INVALID, exits 65 and writes no lease
    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--caller-id',
      'bad id!',
      '--json'
    ]);

    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CALLER_ID_INVALID');
    expect(String(envelope.message)).toContain('^[a-zA-Z0-9._-]{1,200}$');
    expect(process.exitCode).toBe(65);
    expect(leaseFiles(ws.path, SESSION_ID)).toEqual([]);
  });

  it('when no caller id can be resolved, should point at both escape hatches', async () => {
    // given: a temp project with no resolvable caller id
    // when: presence:set is refused
    // then: the refusal names both the --caller-id flag and the PEAKS_CALLER_ID env var
    const { envelope } = await runSkill([
      'presence:set',
      'peaks-code',
      '--project',
      ws.path,
      '--json'
    ]);

    expect(envelope.code).toBe('PEAKS_CALLER_NOT_RESOLVED');
    const nextActions = (envelope.nextActions as string[] | undefined) ?? [];
    expect(nextActions.join('\n')).toContain('--caller-id');
    expect(nextActions.join('\n')).toContain('PEAKS_CALLER_ID');
  });
});
