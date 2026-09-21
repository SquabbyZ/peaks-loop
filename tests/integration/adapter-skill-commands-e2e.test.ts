// tests/integration/adapter-skill-commands-e2e.test.ts
//
// P2-B.4 adapter/distribution e2e — the `peaks skill …` surface.
//
// Split out of the single 848-line `adapter-commands-e2e.test.ts` by slice
// rid-b1 (that file crossed the 800-line cap `peaks request transition`
// enforces). Its siblings are
// `adapter-hooks-statusline-e2e.test.ts` and
// `adapter-dispatch-capability-e2e.test.ts`; the shared spawn helper, payload
// schemas and tmp-project lifecycle live in
// `_adapter-commands-harness.ts`. No assertion was moved or removed by the
// split.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  BIN_TIMEOUT_MS,
  REPO,
  auditConformancePayload,
  cleanupProjects,
  expectCommandNotRegistered,
  expectRegisteredHelp,
  initWorkspace,
  makeProject,
  parseCliEnvelopeWith,
  parseJson,
  presenceClearPayload,
  presenceSetPayload,
  runCli,
  skillActivePayload,
  skillDoctorPayload,
  skillListPayload,
  skillRunbookPayload,
  skillSearchPayload,
  skillSyncPayload,
  skillVisibilityPayload
} from './_adapter-commands-harness.js';

afterEach(cleanupProjects);

describe('peaks skill list (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns the skill catalog envelope', () => {
    expectRegisteredHelp(['skill', 'list'], 'peaks skill list [options]');
    const result = runCli(['skill', 'list', '--json']);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, skillListPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.list');
    expect(envelope.data.skills.length).toBeGreaterThan(0);
  });
});

describe('peaks skill sync (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'dry-run reports all platform plans without applying them',
    () => {
      const project = makeProject('peaks-p2b4-skill-sync-');
      expectRegisteredHelp(['skill', 'sync'], 'peaks skill sync [options]', project);
      const result = runCli(
        ['skill', 'sync', '--project', project, '--dry-run', '--json'],
        project
      );
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, skillSyncPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('skill.sync');
      expect(envelope.data.applied).toBe(false);
      expect(envelope.data.dryRun).toBe(true);
      expect(envelope.data.perPlatform.length).toBeGreaterThan(0);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks skill install <name> (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no destructive install action is attempted', () => {
    expectCommandNotRegistered(
      ['skill', 'install', 'peaks-code'],
      'peaks skill [options] [command]'
    );
  });
});

describe('peaks skill search (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and returns its documented raw result array', () => {
    expectRegisteredHelp(['skill', 'search'], 'peaks skill search [options]');
    const result = runCli(['skill', 'search', '--query', 'code']);
    expect(result.code).toBe(0);
    // NOT an envelope: `peaks skill search --json` writes a bare result array
    // (the case name says so). Feeding it to `parseCliEnvelope` would throw.
    const skills = parseJson(result.stdout, skillSearchPayload);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills.every(({ name, matchScore }) => name.length > 0 && matchScore > 0)).toBe(true);
  });
});

describe('peaks skill conformance (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'is not registered; the top-level skills:audit-conformance replacement works',
    () => {
      expectCommandNotRegistered(['skill', 'conformance'], 'peaks skill [options] [command]');
      expectRegisteredHelp(
        ['skills:audit-conformance'],
        'peaks skills:audit-conformance [options]'
      );
      const replacement = runCli(['skills:audit-conformance', '--project', REPO, '--json']);
      expect(replacement.code).toBe(0);
      const envelope = parseCliEnvelopeWith(replacement.stdout, auditConformancePayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('skills.audit-conformance');
      expect(envelope.data.checked).toBeGreaterThan(0);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks skill visibility (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; the top-level skill:visibility replacement works', () => {
    expectCommandNotRegistered(['skill', 'visibility'], 'peaks skill [options] [command]');
    expectRegisteredHelp(['skill:visibility'], 'peaks skill:visibility [options]');
    const replacement = runCli(['skill:visibility', '--list', '--json']);
    expect(replacement.code).toBe(0);
    // NOT an envelope: `skill:visibility --list --json` writes
    // `{ ok, skills }` with no `command` / `data` head
    // (`src/cli/commands/skill-visibility.ts`). `parseCliEnvelope` would throw.
    const output = parseJson(replacement.stdout, skillVisibilityPayload);
    expect(output.ok).toBe(true);
    expect(output.skills.length).toBeGreaterThan(0);
  });
});

describe('peaks skill doctor (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'is registered and returns structured skill checks',
    () => {
      expectRegisteredHelp(['skill', 'doctor'], 'peaks skill doctor [options]');
      const result = runCli(['skill', 'doctor', '--json']);
      const envelope = parseCliEnvelopeWith(result.stdout, skillDoctorPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('skill.doctor');
      expect(Array.isArray(envelope.data.checks)).toBe(true);
      expect(result.code).toBe(envelope.data.ok ? 0 : 1);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks skill runbook (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and inspects the peaks-code runbook', () => {
    expectRegisteredHelp(
      ['skill', 'runbook', 'peaks-code'],
      'peaks skill runbook [options] <name>'
    );
    const result = runCli(['skill', 'runbook', 'peaks-code', '--json']);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, skillRunbookPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.runbook');
    expect(envelope.data.name).toBe('peaks-code');
    expect(envelope.data.hasRunbook).toBe(true);
  });
});

describe('peaks skill presence (P2-B.4 adapter/distribution e2e)', () => {
  test('reports active:false in an isolated project with no marker', () => {
    const project = makeProject('peaks-p2b4-presence-get-');
    expectRegisteredHelp(['skill', 'presence'], 'peaks skill presence [options]', project);
    const result = runCli(['skill', 'presence', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, skillActivePayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('skill.presence');
    expect(envelope.data.active).toBe(false);
  });
});

describe('peaks skill presence:set (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'sets a session-bound marker inside a temporary project',
    () => {
      const project = makeProject('peaks-p2b4-presence-set-');
      initWorkspace(project);
      expectRegisteredHelp(
        ['skill', 'presence:set', 'peaks-rd'],
        'peaks skill presence:set [options] <name>',
        project
      );
      const result = runCli(
        [
          'skill',
          'presence:set',
          'peaks-rd',
          '--project',
          project,
          '--mode',
          'strict',
          '--gate',
          'p2-b4-e2e',
          '--json'
        ],
        project
      );
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, presenceSetPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('skill.presence:set');
      expect(envelope.data).toMatchObject({
        active: true,
        skill: 'peaks-rd',
        mode: 'strict',
        gate: 'p2-b4-e2e'
      });
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks skill presence:clear (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'reports the lease it did not clear: an ad-hoc lease survives outside session exit',
    () => {
      const project = makeProject('peaks-p2b4-presence-clear-');
      initWorkspace(project);
      runCli(['skill', 'presence:set', 'peaks-rd', '--project', project, '--json'], project);
      const help = expectRegisteredHelp(
        ['skill', 'presence:clear'],
        'peaks skill presence:clear [options]',
        project
      );
      // The help text used to promise a routing this command does not perform
      // ("routes workflow leases through `workflow terminalize`"). A caller who
      // believed it ran `presence:clear` expecting a live workflow lease to
      // terminalize, got exit 0, and kept a running lease. Asserting the ABSENCE
      // of the claim is the point of the case: the command must not describe
      // itself as the terminalizer.
      // Commander wraps the description to the terminal width, so compare on
      // collapsed whitespace rather than on raw line breaks.
      const helpText = help.stdout.replace(/\s+/g, ' ');
      expect(helpText).not.toContain('routes workflow leases through');
      expect(helpText).toContain('does NOT terminalize a live presence lease');
      expect(helpText).toContain('peaks workflow terminalize');
      const result = runCli(['skill', 'presence:clear', '--project', project, '--json'], project);
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, presenceClearPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('skill.presence:clear');
      // Two independent facts, asserted separately:
      //
      //   `removed` — whether the DEPRECATED single-slot marker file
      //   (`.peaks/_runtime/active-skill.json` / `.peaks/.active-skill.json`, both
      //   pre-4.0.11) was actually unlinked. It is not "was a marker cleared".
      //   Since 4.0.11 the live marker is the sid-scoped lease under
      //   `.peaks/_runtime/<sid>/leases/`, and `clearSkillPresence` deliberately
      //   does not touch it (workflow leases terminalize through
      //   `terminalizeWorkflow`): `clearSkillPresence` @
      //   src/services/skills/skill-presence-service.ts:731-775. This project
      //   never carried a legacy file, so nothing was unlinked.
      //
      //   `active` — the LIVE state, re-read through the same projection
      //   `peaks skill presence` serves. The lease above was set by
      //   `presence:set` and is AD-HOC (no workflow binding), so
      //   `presence:clear` must leave it running: only session exit may
      //   terminalize an ad-hoc lease, and raw unlink is FORBIDDEN. The
      //   envelope must report that truthfully — reporting `active: false`
      //   here would be a state the command never reached, contradicted by
      //   the very next `peaks skill presence` call.
      expect(envelope.data).toMatchObject({ active: true, removed: false, cleared: false });
      // ...and WHY it is still there. `active: true, removed: false` alone cannot
      // distinguish "you ran the wrong command" from "this command has no opinion
      // on live leases"; the two terminalization routes below are the whole
      // answer, so the envelope has to carry them rather than leave the caller to
      // infer them from the help text.
      expect(envelope.data.reason).toBe('live-lease-survives-presence-clear');
      // `nextActions` is OPTIONAL on the real envelope (`src/cli/cli-envelope.ts`)
      // — S12 measured that `ok` and `data` are its only universal members. The
      // local `CliEnvelope<T>` this replaced declared it required, so the `?? []`
      // preserves the assertion's strength rather than loosening it: an absent
      // array still fails `toContain` below, it just fails on `''` not on a
      // TypeError.
      const nextActions = (envelope.nextActions ?? []).join('\n');
      expect(nextActions).toContain('peaks workflow terminalize');
      expect(nextActions).toContain('session exit');

      const after = parseCliEnvelopeWith(
        runCli(['skill', 'presence', '--project', project, '--json'], project).stdout,
        skillActivePayload
      );
      expect(after.data.active).toBe(true);
    },
    BIN_TIMEOUT_MS
  );

  test(
    'removes a planted pre-4.0.11 single-slot marker and reports removed:true',
    () => {
      // The other half of the `removed` contract: the shim's own job. Planted so
      // `removed` is exercised in both directions rather than only ever read as
      // `false`.
      const project = makeProject('peaks-p2b4-presence-clear-legacy-');
      initWorkspace(project);
      const legacyMarker = join(project, '.peaks', '_runtime', 'active-skill.json');
      mkdirSync(join(project, '.peaks', '_runtime'), { recursive: true });
      writeFileSync(legacyMarker, '{"skill":"peaks-rd"}\n', 'utf8');

      const result = runCli(['skill', 'presence:clear', '--project', project, '--json'], project);
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, presenceClearPayload);
      expect(envelope.data).toMatchObject({ active: false, removed: true, cleared: true });
      // The other direction of the `reason` contract: nothing survived, so there
      // is nothing to explain. Asserted so `reason` is exercised both ways rather
      // than only ever read as set.
      expect(envelope.data.reason).toBeUndefined();
      // Left un-`??`ed on purpose: `toEqual([])` already distinguishes "an empty
      // array" from "absent", so a `?? []` here WOULD be a strength reduction.
      expect(envelope.nextActions).toEqual([]);
      expect(existsSync(legacyMarker)).toBe(false);
    },
    BIN_TIMEOUT_MS
  );
});
