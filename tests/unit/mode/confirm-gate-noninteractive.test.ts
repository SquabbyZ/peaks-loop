// tests/unit/mode/confirm-gate-noninteractive.test.ts
//
// 4-dimension unit test for the assisted/strict confirmation gate
// (`requireUserConfirmation`) after the 2026-09-09 non-interactive fix.
//
// Before the fix the gate opened a `readline` prompt on process.stdin when
// no bypass flag was passed. In an LLM-driven session stdin is not a TTY,
// so the promise never settled and the command hung. The gate must now
// refuse immediately with a machine-readable `ConfirmationRequiredError`
// (transitionKey + mode + nextActions) and must never touch stdin.
//
// Dimensions covered:
//   - render:      `peaks request transition --json` envelope on refusal
//                  (code + data.transitionKey + data.mode + nextActions)
//   - behavior:    mode/flag matrix — assisted listed/unlisted, strict,
//                  full-auto, 24h, `--confirm`, `--force-confirm`,
//                  `PEAKS_AUTO_CONFIRM=1`
//   - integration: real fs presence lease + `process.stdin` trap (the
//                  strongest form of "never reads stdin")
//   - a11y:        human-visible error text (no `y/N`, no "interactive
//                  terminal") + a repo-wide guard that the misleading
//                  phrase cannot come back
//
// Run with: pnpm vitest run tests/unit/mode/confirm-gate-noninteractive.test.ts

import { Command } from 'commander';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import {
  ConfirmationRequiredError,
  requireUserConfirmation,
} from '../../../src/services/mode/mode-enforcement.js';
import { setPresenceLease } from '../../../src/services/skills/presence-lease-service.js';

declareDimensions('tests/unit/mode/confirm-gate-noninteractive.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const __m = vi.hoisted(() => ({ transitionRequestArtifact: vi.fn() }));

vi.mock('../../../src/services/artifacts/request-artifact-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/artifacts/request-artifact-service.js')
  >('../../../src/services/artifacts/request-artifact-service.js');
  return { ...actual, transitionRequestArtifact: __m.transitionRequestArtifact };
});

import { registerRequestCommands } from '../../../src/cli/commands/request-commands.js';

const SID = '2026-09-09-session-confirm-gate';
const CALLER = 'test-caller-confirm-gate';

const tmpRoots: string[] = [];

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-confirm-gate-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
  writeFileSync(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SID, projectRoot: root }),
    'utf8',
  );
  return root;
}

function writeLease(projectRoot: string, mode: string): void {
  setPresenceLease({
    projectRoot,
    sessionId: SID,
    callerId: CALLER,
    workflowId: 'wf-confirm-gate',
    graphRef: 'graphs/wf-confirm-gate.json',
    skill: 'peaks-code',
    mode,
    now: '2026-09-09T10:00:00.000Z',
  });
}

async function attempt(
  root: string,
  mode: string,
  transitionKey: `${string}:${string}`,
  extra: { confirmed?: boolean; forceConfirm?: boolean } = {},
): Promise<unknown> {
  writeLease(root, mode);
  try {
    await requireUserConfirmation({ projectRoot: root, transitionKey, ...extra });
    return null;
  } catch (error) {
    return error;
  }
}

/**
 * Replace `process.stdin` with a getter that throws. If the gate reads
 * stdin (the pre-fix readline branch) the rejection carries STDIN_ACCESSED
 * instead of ConfirmationRequiredError — a deterministic, side-effect-free
 * proof that the gate never touches stdin.
 */
async function withoutStdin<T>(fn: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(process, 'stdin');
  if (descriptor === undefined || descriptor.configurable !== true) {
    throw new Error('cannot trap process.stdin in this runtime');
  }
  Object.defineProperty(process, 'stdin', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      throw new Error('STDIN_ACCESSED');
    },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(process, 'stdin', descriptor);
  }
}

afterEach(() => {
  process.exitCode = 0;
  vi.restoreAllMocks();
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// behavior — mode / flag matrix
// ---------------------------------------------------------------------------

describe('Scenario: behavior — refusal replaces the interactive prompt', () => {
  it(
    'when assisted needs a listed transition and no bypass flag is given, should refuse immediately',
    { timeout: 2000 },
    async () => {
      const error = await attempt(makeProjectRoot(), 'assisted', 'prd:confirmed-by-user');
      expect(error).toBeInstanceOf(ConfirmationRequiredError);
    },
  );

  it('when assisted sees an unlisted transition, should proceed', async () => {
    const error = await attempt(makeProjectRoot(), 'assisted', 'unlisted:key');
    expect(error).toBeNull();
  });

  it('when strict sees any transition, should refuse', async () => {
    const error = await attempt(makeProjectRoot(), 'strict', 'unlisted:key');
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
  });

  it('when the mode auto-proceeds, should not refuse', async () => {
    for (const mode of ['full-auto', '24h']) {
      const error = await attempt(makeProjectRoot(), mode, 'prd:confirmed-by-user');
      expect(error).toBeNull();
    }
  });

  it('when no presence is recorded, should not refuse', async () => {
    const root = makeProjectRoot();
    await expect(
      requireUserConfirmation({ projectRoot: root, transitionKey: 'prd:confirmed-by-user' }),
    ).resolves.toBeUndefined();
  });

  it('when --confirm is passed, should bypass the gate', async () => {
    const error = await attempt(makeProjectRoot(), 'assisted', 'prd:confirmed-by-user', {
      confirmed: true,
    });
    expect(error).toBeNull();
  });

  it('when --force-confirm is passed, should bypass with a warning', async () => {
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = await attempt(makeProjectRoot(), 'strict', 'rd:qa-handoff', {
      forceConfirm: true,
    });
    expect(error).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain('--force-confirm');
  });
});

// ---------------------------------------------------------------------------
// integration — env var semantics + stdin is never read
// ---------------------------------------------------------------------------

describe('Scenario: integration — PEAKS_AUTO_CONFIRM and stdin isolation', () => {
  it('when PEAKS_AUTO_CONFIRM=1 is set alone, should still refuse', async () => {
    withEnv('PEAKS_AUTO_CONFIRM', '1');
    const error = await attempt(makeProjectRoot(), 'assisted', 'prd:confirmed-by-user');
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
  });

  it('when PEAKS_AUTO_CONFIRM=1 and --force-confirm are both set, should bypass', async () => {
    withEnv('PEAKS_AUTO_CONFIRM', '1');
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const error = await attempt(makeProjectRoot(), 'assisted', 'prd:confirmed-by-user', {
      forceConfirm: true,
    });
    expect(error).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it(
    'when the gate refuses, should never read process.stdin',
    { timeout: 2000 },
    async () => {
      const root = makeProjectRoot();
      const error = await withoutStdin(() =>
        attempt(root, 'assisted', 'prd:confirmed-by-user'),
      );
      expect(error).toBeInstanceOf(ConfirmationRequiredError);
      expect((error as Error).message).not.toContain('STDIN_ACCESSED');
    },
  );
});

// ---------------------------------------------------------------------------
// a11y — the refusal is machine-readable and free of prompt language
// ---------------------------------------------------------------------------

describe('Scenario: a11y — actionable, prompt-free refusal', () => {
  it('when refused, should carry transitionKey + mode + nextActions', () => {
    const error = new ConfirmationRequiredError('rd:qa-handoff', 'assisted');
    expect(error.name).toBe('ConfirmationRequiredError');
    expect(error.transitionKey).toBe('rd:qa-handoff');
    expect(error.mode).toBe('assisted');
    expect(error.nextActions).toHaveLength(2);
    expect(error.nextActions[0]).toContain('AskUserQuestion');
    expect(error.nextActions[1]).toContain('--confirm');
  });

  it('when refused, should not expose terminal-prompt language', () => {
    const error = new ConfirmationRequiredError('qa:verdict-issued', 'strict');
    expect(error.message).toContain('Transition QA → verdict-issued');
    expect(error.message).toContain('strict');
    expect(error.message).not.toContain('interactive terminal');
    expect(error.message).not.toContain('Proceed? (y/N)');
    expect(error.message).not.toContain('readline');
  });

  it('when scanned, should not document "interactive terminal" anywhere in src/ or skills/', () => {
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    for (const dir of ['src', 'skills']) {
      const files: string[] = [];
      collectFiles(join(repoRoot, dir), files);
      for (const file of files) {
        if (/interactive terminal/.test(readFileSync(file, 'utf8'))) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(path, out);
    } else {
      out.push(path);
    }
  }
}

// ---------------------------------------------------------------------------
// render — CLI envelope on refusal
// ---------------------------------------------------------------------------

describe('Scenario: render — request.transition refusal envelope', () => {
  it('when the transition refuses, should render CONFIRMATION_REQUIRED with the error fields', async () => {
    __m.transitionRequestArtifact.mockRejectedValueOnce(
      new ConfirmationRequiredError('rd:qa-handoff', 'assisted'),
    );
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerRequestCommands(program, io);
    await program.parseAsync(
      [
        'request',
        'transition',
        '2026-09-09-confirm-gate',
        '--role',
        'rd',
        '--state',
        'qa-handoff',
        '--project',
        makeProjectRoot(),
        '--session-id',
        SID,
        '--json',
      ],
      { from: 'user' },
    );

    const envelope = JSON.parse(captured.text()) as {
      ok: boolean;
      code: string;
      data: Record<string, unknown>;
      nextActions: string[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CONFIRMATION_REQUIRED');
    expect(envelope.data['transitionKey']).toBe('rd:qa-handoff');
    expect(envelope.data['mode']).toBe('assisted');
    expect(envelope.nextActions.join(' ')).toContain('AskUserQuestion');
    expect(envelope.nextActions.join(' ')).toContain('--confirm');
    expect(JSON.stringify(envelope)).not.toContain('interactive terminal');
  });
});
