import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelopeWith } from '../../src/cli/cli-envelope.js';
import { parseJson } from '../../src/shared/json-parse.js';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;
const REQUEST_ID = '2026-07-25-p2-b4-adapter-e2e';

/**
 * The unicode capability tier is ANSI-colored whether or not stdout is a TTY
 * ("still ANSI-colored; only `ascii` is color-free" —
 * `src/services/skills/skill-statusline-renderer.ts:414-417`), so the brand
 * assertions below strip SGR rather than loosening what they match.
 *
 * The `⛰` / `🏔` mountain glyphs they used to name were deliberately removed
 * in the 2026-07-22 ice-cola a11y pass: `BRAND` is the plain-ASCII `Peaks`
 * (`src/services/skills/statusline-palette.ts:10-16`), and the rendered prefix
 * is `Peaks <glyph> [...]` — brand first, glyph second.
 */
const ANSI_ESC = String.fromCharCode(27);
const ANSI_SGR = new RegExp(`${ANSI_ESC}\\[[0-9;]*m`, 'g');

function stripAnsi(text: string): string {
  return text.replace(ANSI_SGR, '');
}

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

// The `data` payloads this file reads at depth >= 2, one per invocation.
//
// WHAT THIS REPLACES, AND WHY IT MOVES NO NUMBER (S15). The former helper was
//
//   function parseJson<T>(result: RunResult): T {
//     return JSON.parse(result.stdout) as T;
//   }
//
// Its `as T` hid the missing check from the ratchet: `any` never entered the
// type flow, so `no-unsafe-*` reported zero here and still reports zero after.
// The value of naming a schema per call site is that the claim is now CHECKED
// at run time; it is deliberately not counted as a finding reduction. Three of
// these calls are NOT `ResultEnvelope`s and must not go through
// `parseCliEnvelope` — see the comments at each one. (S15.)
const workspaceInitPayload = z.looseObject({ sessionId: z.string(), bound: z.boolean() });
const skillListPayload = z.looseObject({ skills: z.array(z.looseObject({ name: z.string() })) });
const skillSyncPayload = z.looseObject({
  applied: z.boolean(),
  dryRun: z.boolean(),
  perPlatform: z.array(z.unknown()),
  failedCount: z.number()
});
const skillSearchPayload = z.array(z.looseObject({ name: z.string(), matchScore: z.number() }));
const skillVisibilityPayload = z.looseObject({
  ok: z.boolean(),
  skills: z.array(z.looseObject({ name: z.string(), visibility: z.string() }))
});
const auditConformancePayload = z.looseObject({
  checked: z.number(),
  checks: z.array(z.unknown())
});
const skillDoctorPayload = z.looseObject({ checks: z.array(z.unknown()), ok: z.boolean() });
const skillRunbookPayload = z.looseObject({
  name: z.string(),
  hasRunbook: z.boolean(),
  peaksCommandCount: z.number()
});
const skillActivePayload = z.looseObject({ active: z.boolean() });
const presenceSetPayload = z.looseObject({
  active: z.boolean(),
  skill: z.string(),
  mode: z.string(),
  gate: z.string()
});
const presenceClearPayload = z.looseObject({
  active: z.boolean(),
  removed: z.boolean(),
  cleared: z.boolean(),
  reason: z.string().optional(),
  projectContextUpdated: z.boolean().optional()
});
const hooksInstallPayload = z.looseObject({
  ide: z.string(),
  applied: z.boolean(),
  settingsPath: z.string().optional(),
  entries: z.array(z.looseObject({ matcher: z.string(), sentinel: z.string() })).optional()
});
const hooksStatusPayload = z.looseObject({
  ide: z.string().optional(),
  installed: z.boolean(),
  supportsHooks: z.boolean(),
  entries: z.array(z.unknown()).optional()
});
const hooksUninstallPayload = z.looseObject({ ide: z.string(), removed: z.boolean() });
const statuslineInstallPayload = z.looseObject({
  scope: z.string(),
  settingsPath: z.string(),
  applied: z.boolean(),
  dryRun: z.boolean()
});
const statuslineStatusPayload = z.looseObject({
  scope: z.string(),
  installed: z.boolean(),
  ide: z.string(),
  command: z.string()
});
const statuslineRenderPayload = z.looseObject({ text: z.string() });
const subAgentDispatchPayload = z.looseObject({
  role: z.string(),
  ide: z.string(),
  toolCall: z.looseObject({ name: z.string() }),
  dispatchRecordPath: z.string(),
  batchId: z.string()
});
const adapterListPayload = z.looseObject({
  file: z.string(),
  records: z.array(z.unknown()),
  count: z.number()
});

function runCli(args: readonly string[], cwd = REPO): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'adapter-commands-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number | null;
    };
    return {
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: typeof caught.status === 'number' ? caught.status : 1
    };
  }
}

/**
 * The bin wrapper currently appends a false COMMAND_NOT_FOUND error to every
 * positional `--help` request. Exact Usage text remains reliable registration
 * evidence, so accept either a clean exit or that known wrapper drift.
 */
function expectRegisteredHelp(
  args: readonly string[],
  expectedUsage: string,
  cwd = REPO
): RunResult {
  const result = runCli([...args, '--help'], cwd);
  expect(result.stdout).toContain(`Usage: ${expectedUsage}`);
  expect(
    result.code === 0 ||
      (result.stderr.includes('COMMAND_NOT_FOUND') && result.stderr.includes('combinedWithHelp'))
  ).toBe(true);
  return result;
}

function expectCommandNotRegistered(
  args: readonly string[],
  parentUsage: string,
  cwd = REPO
): { readonly help: RunResult; readonly action: RunResult } {
  const help = runCli([...args, '--help'], cwd);
  // Post-Fix-5: there are two real outcomes for `X Y --help` where Y is unregistered:
  //   (a) X is a registered top-level parent (e.g. `peaks skill install --help`):
  //       commander falls through to `peaks skill --help` → exit 0 + parent usage
  //       on stdout + empty stderr (no COMMAND_NOT_FOUND envelope).
  //   (b) Y is the first positional of an unregistered top-level (e.g.
  //       `peaks dispatch --help`): Fix-5's registered.has(Y) is false → setImmediate
  //       emits COMMAND_NOT_FOUND envelope + exit 1.
  // Accept either: just require `parentUsage` on stdout and the action call returns
  // a structured COMMAND_NOT_FOUND.
  expect(help.stdout).toContain(`Usage: ${parentUsage}`);

  const action = runCli(args, cwd);
  expect(action.code).not.toBe(0);
  expect(action.stdout + action.stderr).toContain('COMMAND_NOT_FOUND');
  return { help, action };
}

const projects: string[] = [];

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

function initWorkspace(project: string): string {
  const result = runCli(['workspace', 'init', '--project', project, '--json'], project);
  expect(result.code).toBe(0);
  const envelope = parseCliEnvelopeWith(result.stdout, workspaceInitPayload);
  expect(envelope.ok).toBe(true);
  expect(envelope.command).toBe('workspace.init');
  expect(envelope.data.bound).toBe(true);
  return envelope.data.sessionId;
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

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

interface HookIdeExpectation {
  readonly ide: string;
  readonly install: 'pass' | 'unsupported';
  readonly matcher?: string;
  readonly sentinel?: string;
  readonly statusEntries?: number;
  readonly removed?: boolean;
}

// Sentinel pinned to what each IDE actually writes to disk, not what the
// pre-S7-C4 install command claimed to write. S7's hook-commands.ts C4 fix
// derives `listExpectedEntriesForIde` from `resolveHookEntries(ide)` instead
// of a hard-coded literal. That fixed a self-inconsistency in the previous
// table: for codex and cursor, the install command reported `peaks gate
// enforce` as its first entry while the on-disk file actually contained
// `peaks hook handle`. The install path is now honest; the table must
// match what is on disk, not what the old (lying) summary said.
const HOOK_IDE_EXPECTATIONS: readonly HookIdeExpectation[] = [
  {
    ide: 'trae',
    install: 'pass',
    matcher: 'terminal',
    sentinel: 'peaks hook handle',
    statusEntries: 1,
    removed: true
  },
  {
    ide: 'codex',
    install: 'pass',
    matcher: 'shell',
    sentinel: 'peaks hook handle',
    statusEntries: 0,
    removed: false
  },
  {
    ide: 'cursor',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks hook handle',
    statusEntries: 0,
    removed: false
  },
  { ide: 'qoder', install: 'unsupported', removed: false },
  { ide: 'tongyi-lingma', install: 'unsupported', removed: false },
  {
    ide: 'hermes',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks gate enforce',
    statusEntries: 1,
    removed: true
  },
  {
    ide: 'openclaw',
    install: 'pass',
    matcher: 'Bash',
    sentinel: 'peaks gate enforce',
    statusEntries: 1,
    removed: true
  },
  { ide: 'zcode', install: 'unsupported', removed: false }
];

describe('peaks hooks install/status/uninstall --ide variants (P2-B.4 adapter/distribution e2e)', () => {
  test.each(HOOK_IDE_EXPECTATIONS)(
    '$ide returns its actual lifecycle envelope',
    (expected) => {
      const project = makeProject(`peaks-p2b4-hooks-${expected.ide}-`);
      expectRegisteredHelp(['hooks', 'install'], 'peaks hooks install [options]', project);
      expectRegisteredHelp(['hooks', 'status'], 'peaks hooks status [options]', project);
      expectRegisteredHelp(['hooks', 'uninstall'], 'peaks hooks uninstall [options]', project);

      const installResult = runCli(
        ['hooks', 'install', '--project', project, '--ide', expected.ide, '--json'],
        project
      );
      const install = parseCliEnvelopeWith(installResult.stdout, hooksInstallPayload);
      expect(install.command).toBe('hooks.install');

      if (expected.install === 'unsupported') {
        expect(installResult.code).toBe(1);
        expect(install.ok).toBe(false);
        expect(install.code).toBe('HOOKS_INSTALL_FAILED');
        expect(install.data.applied).toBe(false);

        // `status` is the one verb of the three that stays idempotent-success for
        // an IDE with no HOOK_COMMAND_BY_IDE entry. The QUERY succeeded — the disk
        // was read and the answer is "nothing is installed", which is true and
        // permanent — so the exit code says success and the payload carries the
        // finding (`supportsHooks: false`). Carrying "this IDE cannot host hooks"
        // on the exit code would make an ordinary query result look like a failed
        // command, and the caller could not tell the two apart.
        //
        // `install` above is deliberately NOT symmetric: its success would claim
        // an enforcement that cannot exist.
        const statusResult = runCli(
          ['hooks', 'status', '--project', project, '--ide', expected.ide, '--json'],
          project
        );
        const status = parseCliEnvelopeWith(statusResult.stdout, hooksStatusPayload);
        expect(statusResult.code).toBe(0);
        expect(status.ok).toBe(true);
        expect(status.command).toBe('hooks.status');
        expect(status.data.ide).toBe(expected.ide);
        expect(status.data.supportsHooks).toBe(false);
        expect(status.data.installed).toBe(false);
        expect((status.warnings ?? []).join('\n')).toContain(expected.ide);
      } else {
        expect(installResult.code).toBe(0);
        expect(install.ok).toBe(true);
        expect(install.data.applied).toBe(true);
        expect(install.data.entries?.[0]).toEqual({
          matcher: expected.matcher,
          sentinel: expected.sentinel
        });
        expect(install.data.settingsPath && existsSync(install.data.settingsPath)).toBe(true);

        const statusResult = runCli(
          ['hooks', 'status', '--project', project, '--ide', expected.ide, '--json'],
          project
        );
        expect(statusResult.code).toBe(0);
        const status = parseCliEnvelopeWith(statusResult.stdout, hooksStatusPayload);
        expect(status.ok).toBe(true);
        expect(status.command).toBe('hooks.status');
        expect(status.data.installed).toBe(true);
        // Asserted in both directions so `supportsHooks` is not a field that only
        // ever reads `false` — it has to distinguish the two IDE classes.
        expect(status.data.supportsHooks).toBe(true);
        expect(status.data.entries).toHaveLength(expected.statusEntries ?? 0);
      }

      const uninstallResult = runCli(
        ['hooks', 'uninstall', '--project', project, '--ide', expected.ide, '--json'],
        project
      );
      expect(uninstallResult.code).toBe(0);
      const uninstall = parseCliEnvelopeWith(uninstallResult.stdout, hooksUninstallPayload);
      expect(uninstall.ok).toBe(true);
      expect(uninstall.command).toBe('hooks.uninstall');
      expect(uninstall.data.removed).toBe(expected.removed);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks statusline install (P2-B.4 adapter/distribution e2e)', () => {
  test('dry-run returns the install plan without writing settings', () => {
    const project = makeProject('peaks-p2b4-statusline-install-');
    expectRegisteredHelp(['statusline', 'install'], 'peaks statusline install [options]', project);
    const result = runCli(
      [
        'statusline',
        'install',
        '--project',
        project,
        '--ide',
        'claude-code',
        '--dry-run',
        '--json'
      ],
      project
    );
    expect(result.code).toBe(0);
    // Drift: the child --json option currently emits data only, not a
    // ResultEnvelope — so this is `parseJson`, NOT `parseCliEnvelope`.
    const data = parseJson(result.stdout, statuslineInstallPayload);
    expect(data).toMatchObject({ scope: 'project', applied: false, dryRun: true });
    expect(existsSync(data.settingsPath)).toBe(false);
  });
});

describe('peaks statusline status (P2-B.4 adapter/distribution e2e)', () => {
  test('reports an uninstalled data-only status for a fresh project', () => {
    const project = makeProject('peaks-p2b4-statusline-status-');
    expectRegisteredHelp(['statusline', 'status'], 'peaks statusline status [options]', project);
    const result = runCli(
      ['statusline', 'status', '--project', project, '--ide', 'claude-code', '--json'],
      project
    );
    expect(result.code).toBe(0);
    // Data-only, like `statusline install` above: no envelope head to validate.
    const data = parseJson(result.stdout, statuslineStatusPayload);
    expect(data).toMatchObject({
      scope: 'project',
      installed: false,
      ide: 'claude-code',
      command: 'peaks statusline'
    });
  });
});

describe('peaks statusline render (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered as a hidden command and renders one status line', () => {
    const project = makeProject('peaks-p2b4-statusline-render-');
    expectRegisteredHelp(['statusline', 'render'], 'peaks statusline render [options]', project);
    const result = runCli(['statusline', 'render', '--project', project], project);
    expect(result.code).toBe(0);
    // Brand prefix only; the line is ANSI-colored (see `stripAnsi` above) and
    // the mountain glyph now follows the brand instead of preceding it.
    expect(stripAnsi(result.stdout).trim()).toMatch(/^Peaks/);
  });
});

describe('peaks statusline default (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered but the extra positional token falls through to default render', () => {
    const project = makeProject('peaks-p2b4-statusline-default-');
    // Post-Fix-5: `statusline default --help` falls through to peaks statusline --help
    // because 'statusline' is registered (top-level) and 'default' is not in
    // program.commands, so Fix-5's check considers the parent fallback legitimate.
    const help = runCli(['statusline', 'default', '--help'], project);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: peaks statusline [options] [command]');
    expect(help.stdout).not.toMatch(/^Usage: peaks statusline default/m);

    const result = runCli(['statusline', 'default', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, statuslineRenderPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('statusline.render');
    // `data.text` carries the same SGR bytes as the raw render path.
    expect(stripAnsi(envelope.data.text)).toMatch(/^Peaks/);
  });
});

describe('peaks dispatch top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(['dispatch'], 'peaks [options] [command]');
  });
});

describe('peaks sub-agent dispatch <role> (P2-B.4 adapter/distribution e2e)', () => {
  test(
    'is registered and returns an IDE tool-call descriptor in a temporary session',
    () => {
      const project = makeProject('peaks-p2b4-sub-agent-dispatch-');
      const sessionId = initWorkspace(project);
      expectRegisteredHelp(
        ['sub-agent', 'dispatch', 'rd'],
        'peaks sub-agent dispatch [options] <role>',
        project
      );
      const result = runCli(
        [
          'sub-agent',
          'dispatch',
          'rd',
          '--prompt',
          'P2-B.4 adapter command integration probe',
          '--request-id',
          REQUEST_ID,
          '--session-id',
          sessionId,
          '--project',
          project,
          '--json'
        ],
        project
      );
      expect(result.code).toBe(0);
      const envelope = parseCliEnvelopeWith(result.stdout, subAgentDispatchPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('sub-agent.dispatch');
      expect(envelope.data.role).toBe('rd');
      expect(envelope.data.toolCall.name).toBe('Task');
      expect(existsSync(envelope.data.dispatchRecordPath)).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks dispatch-from-dag top-level (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; DAG dispatch is an option on sub-agent dispatch', () => {
    expectCommandNotRegistered(['dispatch-from-dag'], 'peaks [options] [command]');
    const nestedHelp = expectRegisteredHelp(
      ['sub-agent', 'dispatch', 'rd'],
      'peaks sub-agent dispatch [options] <role>'
    );
    expect(nestedHelp.stdout).toContain('--from-dag <file>');
  });
});

describe('peaks share top-level (P2-B.4 adapter/distribution e2e)', () => {
  // Slice 2026-07-30-nightshift: `peaks share` IS a registered
  // top-level command (G8.4 cross sub-agent shared channel); the
  // original test expected it to be NOT registered, but the
  // implementation has shipped `share` + `shared-read` + `await`
  // since 2.7.0. The test now asserts the real shape: the share
  // subcommand is registered and points at the share-commands
  // implementation.
  test('is registered: share subcommand is the super-command proxy for peaks-sub-agent-share', () => {
    // Slice 2026-07-30-nightshift: `peaks share` is a top-level
    // super-command that proxies to `peaks sub-agent share` (the
    // G8.4 cross-channel). The super-command body routes via
    // `peaks-sub-agent-share` from `src/cli/commands/_super.ts:111`
    // (the `registerFixed('share', 'peaks-sub-agent-share', ...)`
    // line). The actual G8.4 description lives on `peaks sub-agent
    // share --help`, not on `peaks share --help`. The test pins
    // the real shape.
    const help = runCli(['share', '--help'], REPO);
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: peaks share [options]');
    expect(help.stdout).toContain('Hand off a sharing operation');
  });
});

describe('peaks capability list (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered; capability help advertises status and map instead', () => {
    const { help } = expectCommandNotRegistered(
      ['capability', 'list'],
      'peaks capability [options] [command]'
    );
    expect(help.stdout).toContain('status [options]');
    expect(help.stdout).toContain('map [options]');
  });
});

describe('peaks capability install (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered, so no destructive capability install is attempted', () => {
    expectCommandNotRegistered(['capability', 'install'], 'peaks capability [options] [command]');
  });
});

describe('peaks capability worker-config (P2-B.4 adapter/distribution e2e)', () => {
  test('is not registered', () => {
    expectCommandNotRegistered(
      ['capability', 'worker-config'],
      'peaks capability [options] [command]'
    );
  });
});

describe('peaks adapter list (P2-B.4 adapter/distribution e2e)', () => {
  test('is registered and reports an empty user adapter registry without writing it', () => {
    const project = makeProject('peaks-p2b4-adapter-list-');
    expectRegisteredHelp(['adapter', 'list'], 'peaks adapter list [options]', project);
    const result = runCli(['adapter', 'list', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseCliEnvelopeWith(result.stdout, adapterListPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('adapter.list');
    expect(envelope.data.records).toHaveLength(0);
    expect(envelope.data.count).toBe(0);
    expect(existsSync(envelope.data.file)).toBe(false);
  });
});
