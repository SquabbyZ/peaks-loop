// tests/unit/skills/skill-presence-role.test.ts
//
// The Role cell of the status header is a machine fact, not model prose.
//
// The presence projection used to carry the skill and the gate and nothing
// else, so the `Peaks-Loop Role:` cell had no source at all: the agent wrote
// its own guess. This file holds down the projection that replaced that guess
// — `data.role` — together with the two facts that depend on it: the status
// header the agent is told to render, and the marker detector that watches
// for it.
//
// Dimensions: behavior (the projected tier follows the lease's skill),
// integration (a real lease on disk, read by the presence projection and by
// the marker hook), render (the `peaks skill presence --json` envelope).
// a11y omitted — this surface is a JSON envelope and a typed hook result; it
// renders no human-facing text.
//
// Run with: node node_modules/vitest/vitest.mjs run tests/unit/skills/skill-presence-role.test.ts

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import { getSkillPresence } from '../../../src/services/skills/skill-presence-service.js';
import { detectPresenceMarker } from '../../../src/services/hooks/presence-marker-detector.js';
import { registerSkillCommand } from '../../../src/cli/commands/core/skill-command.js';

declareDimensions(
  'tests/unit/skills/skill-presence-role.test.ts',
  ['behavior', 'integration', 'render'],
  [
    {
      dim: 'a11y',
      reason: 'the surface is a JSON envelope and a typed hook result; no human-facing text'
    }
  ]
);

const SID = '2026-10-24-session-0000cc';

/** The five-segment header the response contract publishes. */
const FIVE_SEGMENT_HEADER =
  'Peaks-Loop Skill: peaks-rd | Peaks-Loop Role: bee | Peaks-Loop Gate: rd-dry-run | Peaks-Loop Context: 42.3% (none) | Next: write the slice';

let ws: TmpWorkspace;
const savedEnv = { ...process.env };
let savedExitCode: number | string | null | undefined;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-skill-presence-role-');
  // An ambient caller binding would decide the bound-session path instead of
  // the fixture, so the env is cleared for every test in this file.
  delete process.env.PEAKS_CALLER_ID;
  delete process.env.PEAKS_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  savedExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  Object.assign(process.env, savedEnv);
  cleanupTmpWorkspace();
});

/* ---------- fixtures ---------- */

/** Point the project-global binding at the fixture session tree. */
function seedBoundSession(projectRoot: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId: SID, projectRoot }, null, 2),
    'utf8'
  );
}

/** Write a canonical sid-scoped lease carrying `skill`. */
function writeLease(projectRoot: string, skill: string): void {
  const dir = join(projectRoot, '.peaks', '_runtime', SID, 'leases');
  mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  writeFileSync(
    join(dir, 'presence-caller-a-wf-a.json'),
    JSON.stringify(
      {
        callerId: 'caller-a',
        workflowId: 'wf-a',
        graphRef: 'graphs/wf-a.json',
        skill,
        depth: 0,
        startedAt: now,
        lastHeartbeat: now,
        status: 'running',
        schemaVersion: 1
      },
      null,
      2
    ),
    'utf8'
  );
}

/** Run `peaks skill presence --json` against a project root and parse it. */
async function runPresenceJson(projectRoot: string): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerSkillCommand(program, io);
  await program.parseAsync(['skill', 'presence', '--project', projectRoot, '--json'], {
    from: 'user'
  });
  const envelope = JSON.parse(captured.text()) as { data: Record<string, unknown> };
  return envelope.data;
}

/* ---------- behavior: the projected tier ---------- */
describe('Scenario: behavior — the presence projection carries the role tier', () => {
  it('when the lease names an orchestrator, should project the orchestrator tier', () => {
    // given: a live lease whose skill is an orchestrator
    // when: the presence is read
    // then: the presence carries the orchestrator tier
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-code');
    const presence = getSkillPresence(ws.path);
    expect(presence?.skill).toBe('peaks-code');
    expect(presence?.role).toBe('orchestrator');
  });

  it('when the lease names a bee, should project the bee tier', () => {
    // given: a live lease whose skill is a bee
    // when: the presence is read
    // then: the presence carries the bee tier
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-rd');
    expect(getSkillPresence(ws.path)?.role).toBe('bee');
  });

  it('when the lease names a skill outside both tiers, should project no tier at all', () => {
    // given: a live lease whose skill is in neither tier list
    // when: the presence is read
    // then: the tier is null — the key is present, and the value is null
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-not-a-skill');
    const presence = getSkillPresence(ws.path);
    expect(presence?.role).toBeNull();
    expect(presence !== null && 'role' in presence).toBe(true);
  });
});

/* ---------- integration: the marker hook and the five-segment header ---------- */
describe('Scenario: integration — the marker detector and the five-segment header', () => {
  it('when a five-segment header is the latest message, should still find the marker', () => {
    // given: an active presence and a five-segment status header
    // when: the marker detector reads the latest assistant message
    // then: the marker is found — the Role and Context cells do not hide it
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-rd');
    const result = detectPresenceMarker({
      project: ws.path,
      latestAssistantMessage: FIVE_SEGMENT_HEADER
    });
    expect(result.active).toBe(true);
    expect(result.markerFound).toBe(true);
  });

  it('when a five-segment header carries no marker at all, should report the marker missing', () => {
    // given: an active presence and a message with no status header
    // when: the marker detector reads it
    // then: the marker is reported missing — the five-segment shape is not what it keys on
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-rd');
    const result = detectPresenceMarker({
      project: ws.path,
      latestAssistantMessage: 'working on the slice now'
    });
    expect(result.active).toBe(true);
    expect(result.markerFound).toBe(false);
  });
});

/* ---------- render: the `--json` envelope ---------- */
describe('Scenario: render — the `peaks skill presence --json` envelope', () => {
  it('when the envelope is read, should carry the role next to the skill', async () => {
    // given: a live lease for an orchestrator
    // when: the presence is read as JSON
    // then: the envelope reports the skill and the tier that belongs to it
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-code');
    const data = await runPresenceJson(ws.path);
    expect(data.active).toBe(true);
    expect(data.skill).toBe('peaks-code');
    expect(data.role).toBe('orchestrator');
  });

  it('when the envelope is read for a bee, should report the bee tier', async () => {
    // given: a live lease for a bee
    // when: the presence is read as JSON
    // then: the envelope reports the bee tier
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-qa');
    const data = await runPresenceJson(ws.path);
    expect(data.skill).toBe('peaks-qa');
    expect(data.role).toBe('bee');
  });

  it('when the envelope is read for an unknown skill, should report a null role', async () => {
    // given: a live lease whose skill is in neither tier list
    // when: the presence is read as JSON
    // then: the envelope reports role null — the key is there, with no tier
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-not-a-skill');
    const data = await runPresenceJson(ws.path);
    expect(data.skill).toBe('peaks-not-a-skill');
    expect(data.role).toBeNull();
    expect('role' in data).toBe(true);
  });

  it('when the envelope is read for a bee, should carry the context the header renders', async () => {
    // given: a live lease for a bee
    // when: the presence is read as JSON
    // then: the envelope carries the context fields the Context cell copies
    seedBoundSession(ws.path);
    writeLease(ws.path, 'peaks-rd');
    const data = await runPresenceJson(ws.path);
    const context = data.context as { ratioPct?: string; action?: string };
    expect(typeof context.ratioPct).toBe('string');
    expect(typeof context.action).toBe('string');
  });
});
