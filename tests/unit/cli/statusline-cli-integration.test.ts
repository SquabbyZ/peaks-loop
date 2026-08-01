// tests/unit/cli/statusline-cli-integration.test.ts
//
// 4-dimension real-filesystem + real-subprocess CLI integration test for the
// `peaks statusline` family. The previous tests in this slice either
// (a) exercise the pure `renderStatusLine` / `decideCompactStatusline` layer
//     with hand-built `StatusLineModel` fixtures, OR
// (b) drive the service layer against a tmp `process.cwd()` to read real
//     `.peaks/_runtime/<sid>/compact-lifecycle.json` fixtures.
//
// This file closes the gap the user-facing "first live version" demo needs:
// end-to-end, a built CLI artifact, a real on-disk lifecycle fixture, and
// the exact output the statusline consumer will display.
//
// Why this test lives under `tests/unit/`, NOT `tests/integration/`:
//   vitest.config.ts:36-41 has `include: ['tests/unit/**/*.test.ts']` and
//   explicitly `exclude: ['tests/integration/**', 'tests/e2e/**', ...]`.
//   `pnpm test:integration` exits 0 with "No test files found" because of
//   the exclude (verified empirically). Putting the file in
//   `tests/integration/` would silently produce a fake-green run. The
//   vitest 4-dim convention in `.peaks/standards/typescript/testing.md` says
//   `integration` describes unit-level boundary mocks; this file is the
//   next-rung-out coverage: a real subprocess against a real fs. We keep
//   it under `tests/unit/` so the suite actually runs it, and we declare
//   the dimension as `integration` per the 4-dim convention.
//
// Why we spawn `node <repo>/dist/cli/index.js` instead of the `peaks` bin:
//   (1) The `peaks` bin on PATH in this host has historically shadowed the
//       local version (memory: global-path-shadow-resolved-2026-07-25).
//       Spawning a globally-installed `peaks` would mask build-state drift
//       and produce false green. Resolving the local-built entry
//       explicitly gives the test one source of truth.
//   (2) The `pretest` script in package.json runs
//       `pnpm build && check-build-integrity` so by the time vitest
//       spawns, `dist/cli/index.js` is guaranteed populated and integrity-
//       checked.
//
// Known finding carried into the report (not fixed here):
//   `peaks statusline compact --json` is documented in `--help` but the
//   `if (options.json === true)` branch (statusline-commands.ts:269) does
//   not fire — `--json` is silently dropped and the plain label is
//   printed. Reproduced directly: `node dist/cli/index.js statusline
//   compact --json` prints `compact [░░░░░░░░]\n` with no envelope. The
//   default-render path (`peaks statusline --json`) DOES honor `--json`.
//   This test does NOT regress the documented behavior — it asserts the
//   plain-text contract (which is what the IDE consumer actually uses) and
//   only checks the JSON envelope on the default-render path. Fixing the
//   compact subcommand's --json flag is filed in the task-6 report
//   concerns section for a follow-up slice.
//
// Dimensions covered:
//   - render:        CLI plain-text label shape per stage; JSON envelope
//                    on the default render path
//   - behavior:      each lifecycle stage yields the documented cell bar
//   - integration:   real fs lifecycle record + real subprocess spawn
//   - a11y:          rendered labels stay single-line English, no CLI
//                    verbs, no `?` ratio guess, no `peaks <verb>` prompt
//
// Run with: pnpm vitest run tests/unit/cli/statusline-cli-integration.test.ts

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  writeCompactLifecycle,
  type CompactLifecycleRecord,
} from '~/src/services/compact-statusline/compact-lifecycle-store';

declareDimensions(
  'tests/unit/cli/statusline-cli-integration.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const SID = '2026-08-01-task6-integ';
const NOW_ISO = '2026-08-01T12:00:00.000Z';

interface Harness {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly distEntry: string;
}

let active: Harness | null = null;

function makeHarness(): Harness {
  // The tmp dir is the spawned subprocess's project root. We drop a `.git`
  // marker so `findProjectRoot` (config-safety.ts:61) returns this dir
  // immediately instead of walking up to the real peaks-loop worktree.
  const cwd = mkdtempSync(join(tmpdir(), 'peaks-statusline-cli-'));
  mkdirSync(join(cwd, '.git'), { recursive: true });
  // The session file's projectRoot must equal the canonical realpath of the
  // tmp dir. session-manager.ts:178-184 requires the stored projectRoot to
  // canonicalize to the same realpath the resolver uses, otherwise the
  // session binding is treated as a foreign project (and falls back to
  // `state: 'idle'`, no compact segment).
  const projectRoot = realpathSync(cwd);
  const runtimeDir = join(cwd, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify(
      {
        sessionId: SID,
        createdAt: NOW_ISO,
        projectRoot,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  // The worktree test file is at:
  //   <peaks-loop>/.claude/worktrees/<wt>/tests/unit/cli/statusline-cli-integration.test.ts
  // The built CLI lives at <peaks-loop>/dist/cli/index.js, i.e. SIX levels
  // up from this file. Resolving too few levels lands inside the worktree
  // (which has no `dist/`); too many lands in `.claude`. The vitest config
  // runs `pool: 'forks'`, so this path is computed once per test fork and
  // is independent of the worker's cwd.
  const distEntry = resolve(__dirname, '..', '..', '..', '..', '..', '..', 'dist', 'cli', 'index.js');
  if (!existsSync(distEntry)) {
    throw new Error(
      `Built CLI entry not found at ${distEntry}. Run \`pnpm build\` first (the pretest hook should do this).`,
    );
  }
  return { cwd, projectRoot, distEntry };
}

interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function spawnCli(args: string[], stdinPayload = ''): CliRun {
  if (!active) throw new Error('spawnCli called without active harness');
  const r: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [active.distEntry, ...args],
    {
      cwd: active.cwd,
      env: process.env,
      encoding: 'utf8',
      shell: false,
      input: stdinPayload,
    },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function runStatuslineCompact(extraArgs: string[] = []): CliRun {
  if (!active) throw new Error('runStatuslineCompact called without active harness');
  return spawnCli([
    'statusline',
    'compact',
    '--project', active.projectRoot,
    '--session-id', SID,
    ...extraArgs,
  ]);
}

function runDefaultStatusline(extraArgs: string[] = [], stdinPayload = ''): CliRun {
  if (!active) throw new Error('runDefaultStatusline called without active harness');
  return spawnCli(
    ['statusline', '--project', active.projectRoot, ...extraArgs],
    stdinPayload,
  );
}

function seedLifecycle(record: CompactLifecycleRecord): void {
  if (!active) throw new Error('seedLifecycle called without active harness');
  writeCompactLifecycle({ projectRoot: active.projectRoot, sessionId: SID, record });
}

function makeRecord(overrides: Partial<CompactLifecycleRecord> = {}): CompactLifecycleRecord {
  return {
    schemaVersion: 1,
    runId: 'run-task6',
    stage: 'queued',
    updatedAt: NOW_ISO,
    triggerRatio: 0.87,
    redLine: false,
    ...overrides,
  };
}

beforeEach(() => {
  active = makeHarness();
});

afterEach(() => {
  const ws = active?.cwd;
  active = null;
  if (ws) {
    try {
      rmSync(ws, { recursive: true, force: true });
    } catch {
      // best-effort; the OS reaps tmp dirs eventually
    }
  }
});

// ---------------------------------------------------------------------------
// render — CLI plain-text label + JSON envelope shape
// ---------------------------------------------------------------------------

describe('render — `peaks statusline compact` plain-text label matches the documented cell bar', () => {
  it('queued lifecycle → "compact [░░░░░░░░]\\n"', () => {
    seedLifecycle(makeRecord({ stage: 'queued' }));
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [░░░░░░░░]\n');
  });

  it('compacting lifecycle → "compact [████░░░░]\\n"', () => {
    seedLifecycle(makeRecord({ stage: 'compacting' }));
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [████░░░░]\n');
  });
});

describe('render — default-render path JSON envelope preserves the documented shape (ok / command / data.text)', () => {
  it('compacting lifecycle → JSON envelope with data.text containing the cell bar verbatim', () => {
    seedLifecycle(makeRecord({ stage: 'compacting' }));
    // The default render path honors --json. `peaks statusline compact
    // --json` does not (see file-header concern note); we test the JSON
    // envelope on the path that actually supports it.
    const stdin = JSON.stringify({
      workspace: { current_dir: active!.projectRoot },
      session_id: SID,
    });
    const r = runDefaultStatusline(['--json'], stdin);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('statusline.render');
    expect(typeof env.data.text).toBe('string');
    // The compact cell bar must surface in the primary line. The exact
    // prefix differs from `peaks statusline compact` (which is the IDE
    // consumer surface) — the default render path prepends the brand and
    // the root label. We assert on the cell bar, not the prefix, so the
    // test is robust to that intentional composition.
    expect(env.data.text).toContain('[████░░░░]');
    expect(env.data.text).toContain('compacting');
  });
});

// ---------------------------------------------------------------------------
// behavior — every documented lifecycle stage maps to the expected cell bar
// ---------------------------------------------------------------------------

describe('behavior — every documented lifecycle stage maps to the expected cell bar end to end', () => {
  const EXPECTED: ReadonlyArray<{
    stage: CompactLifecycleRecord['stage'];
    cells: 0 | 2 | 4 | 6 | 8;
  }> = [
    { stage: 'queued', cells: 0 },
    { stage: 'preparing', cells: 2 },
    { stage: 'compacting', cells: 4 },
    { stage: 'verifying', cells: 6 },
  ];

  for (const { stage, cells } of EXPECTED) {
    it(`${stage} → ${cells} cells filled in the rendered label`, () => {
      seedLifecycle(makeRecord({ stage }));
      const r = runStatuslineCompact();
      expect(r.status).toBe(0);
      const filled = '█'.repeat(cells);
      const empty = '░'.repeat(8 - cells);
      expect(r.stdout).toBe(`compact [${filled}${empty}]\n`);
    });
  }

  it('completed WITH afterRatio surfaces "compact [████████] → 0.42\\n"', () => {
    seedLifecycle(makeRecord({ stage: 'completed', afterRatio: 0.42 }));
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [████████] → 0.42\n');
    expect(r.stdout).not.toMatch(/\?/);
  });

  it('completed WITHOUT afterRatio surfaces the honest "after-ratio not recorded" hint, not a guessed ratio', () => {
    seedLifecycle(makeRecord({ stage: 'completed' }));
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [████████] (after-ratio not recorded)\n');
    expect(r.stdout).not.toMatch(/\?/);
  });

  it('failed retains the failedAt cell and surfaces an explicit "failed at <stage>" segment', () => {
    seedLifecycle(makeRecord({
      stage: 'failed',
      failedAt: 'compacting',
      errorSummary: 'synthetic failure',
    }));
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('compact [████░░░░] failed at compacting');
    expect(r.stdout).toContain('synthetic failure');
    expect(r.stdout).not.toMatch(/\?/);
  });
});

// ---------------------------------------------------------------------------
// behavior — session-bypass path yields the documented "none" label
// ---------------------------------------------------------------------------

describe('behavior — when no lifecycle record exists, the compact subcommand reports the empty bar', () => {
  it('missing lifecycle → "compact [░░░░░░░░]\\n"', () => {
    // Note: do NOT seedLifecycle(). The store is genuinely empty.
    const r = runStatuslineCompact();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [░░░░░░░░]\n');
  });
});

// ---------------------------------------------------------------------------
// integration — real subprocess + real fs lifecycle record
// ---------------------------------------------------------------------------

describe('integration — the CLI reads the lifecycle file from the spawned cwd (no global state)', () => {
  it('changing the lifecycle record between runs changes the rendered output', () => {
    seedLifecycle(makeRecord({ stage: 'compacting' }));
    const first = runStatuslineCompact();
    expect(first.stdout).toBe('compact [████░░░░]\n');

    // Overwrite with completed; next run must see the new state.
    seedLifecycle(makeRecord({ stage: 'completed', afterRatio: 0.5 }));
    const second = runStatuslineCompact();
    expect(second.stdout).toBe('compact [████████] → 0.50\n');
  });

  it('invalid lifecycle JSON surfaces the honest "status unreadable" label, not a fake progress bar', () => {
    // writeCompactLifecycle validates and would refuse this, so we
    // hand-write the file to simulate on-disk corruption.
    const sessionDir = join(active!.projectRoot, '.peaks', '_runtime', SID);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'compact-lifecycle.json'), '{not valid json', 'utf8');
    const r = runStatuslineCompact();
    // The compact subcommand treats invalid as a non-fatal state (no
    // exception escapes), so exit code is 0; the label MUST surface the
    // invalid kind so the user sees a "status unreadable" diagnostic
    // instead of a reassuring green bar.
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/████/);
    expect(r.stdout).toContain('status unreadable');
  });
});

// ---------------------------------------------------------------------------
// a11y — rendered label hygiene: no "?", no CLI verb, single line
// ---------------------------------------------------------------------------

describe('a11y — rendered labels stay single-line English, no `?`, no CLI verb', () => {
  const STAGES: ReadonlyArray<CompactLifecycleRecord['stage']> = [
    'queued',
    'preparing',
    'compacting',
    'verifying',
    'completed',
    'failed',
  ];

  for (const stage of STAGES) {
    it(`${stage}: output is single-line, no '?', no 'peaks <verb>'`, () => {
      const overrides: Partial<CompactLifecycleRecord> = stage === 'failed'
        ? { failedAt: 'compacting', errorSummary: 'integration-test failure' }
        : (stage === 'completed' ? { afterRatio: 0.42 } : {});
      seedLifecycle(makeRecord({ stage, ...overrides }));
      const r = runStatuslineCompact();
      expect(r.status).toBe(0);
      const line = r.stdout.replace(/\n$/, '');
      expect(line).not.toMatch(/\n/);
      expect(line).not.toMatch(/\?/);
      expect(line).not.toMatch(/\bpeaks\s+(install|uninstall|render|compact|status)\b/);
    });
  }
});
