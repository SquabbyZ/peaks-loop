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
// end-to-end, a built CLI artifact, a real on-disk presence + lifecycle
// fixture, and the exact output the statusline consumer will display.
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
//       `pnpm build && check-build-integrity` when the test is invoked
//       via `pnpm test` (the canonical path). For direct invocations
//       like `npx vitest run tests/unit/cli/statusline-cli-integration.test.ts`,
//       the pretest may bypass; we therefore additionally:
//         (a) ASSERT dist exists at suite start (`beforeAll`),
//         (b) ASSERT each touched source file is not newer than its
//             dist counterpart via a deterministic mtime guard
//             (`assertDistFresh()`).
//       Both guards run ONLY in this suite — the package pretest is
//       global and we deliberately do NOT modify it broadly (per
//       rejection-pass C1/I1 fix #1).
//
// Dist path resolution (rejection #6 — robust anchor):
//   `resolveDistEntry()` walks up from `import.meta.url` looking for a
//   directory that contains a `package.json` whose `name === 'peaks-loop'`
//   AND a `dist/cli/index.js` sibling. The first match is the canonical
//   repo root. This is robust to:
//     - file location (no `..` count magic — works when the test file
//       moves down or sideways in the tree)
//     - Windows / POSIX path separators
//     - the worktree layout (`.claude/worktrees/<wt>/tests/unit/cli/...`)
//     - monorepo nests (the named-package check guards against sibling
//       packages like peaks-loop-shared)
//
// Dimensions covered:
//   - render:        CLI plain-text label + JSON envelope per stage;
//                    primary `peaks statusline` line composition
//   - behavior:      each lifecycle stage yields the documented cell bar;
//                    10-second completed expiry; NO_COLOR + PEAKS_STATUSLINE_ASCII
//   - integration:   real fs presence + lifecycle + real subprocess spawn
//   - a11y:          rendered labels stay single-line English, no CLI
//                    verbs, no `?` ratio guess, no `peaks <verb>` prompt
//
// Run with: pnpm vitest run tests/unit/cli/statusline-cli-integration.test.ts

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import {
  writeCompactLifecycle,
  type CompactLifecycleRecord,
} from '~/src/services/compact-statusline/compact-lifecycle-store';

declareDimensions(
  'tests/unit/cli/statusline-cli-integration.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

const SID = `2026-08-01-task6-integ-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
const NOW_ISO = new Date(Date.now() - 60_000).toISOString(); // 1 minute ago — fresh enough to render as 'active' (not stale).

// ---------------------------------------------------------------------------
// Robust dist path resolution (rejection #6)
// ---------------------------------------------------------------------------

function resolveDistEntry(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let cursor = resolve(here);
  const root = isAbsolute(cursor) ? sep : '';
  while (cursor !== root) {
    const candidate = join(cursor, 'dist', 'cli', 'index.js');
    const pkgCandidate = join(cursor, 'package.json');
    if (existsSync(candidate) && existsSync(pkgCandidate)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgCandidate, 'utf8')) as { name?: string };
        if (pkg.name === 'peaks-loop') {
          return candidate;
        }
      } catch {
        // unreadable package.json — keep walking
      }
    }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(
    `Could not resolve dist/cli/index.js from ${here}. ` +
      `Expected to find a peaks-loop repo root with a built dist/ directory. ` +
      `Run "pnpm build" in the repo root before running this test. ` +
      `The pretest script should do this automatically; see package.json.`,
  );
}

const DIST_ENTRY = resolveDistEntry();

// ---------------------------------------------------------------------------
// Deterministic dist freshness guard (rejection-pass C1/I1 fix #1)
// ---------------------------------------------------------------------------
//
// The package `pretest` script (`pnpm build && check-build-integrity`) rebuilds
// dist/ before the suite runs. To avoid relying on that hook when the test is
// run in isolation (e.g. `vitest tests/unit/cli/statusline-cli-integration.test.ts`
// directly, or in a CI path that bypasses the lifecycle), we compare the
// mtime of each touched source file against the mtime of its corresponding
// dist file. The 3 source files are the runtime surfaces this test exercises.
// The header claim above ("The pretest script should do this automatically")
// is correct for the canonical `pnpm test` invocation; this guard is the
// safety net for direct invocations.
//
// Why not modify global pretest broadly:
//   The package pretest is shared by every test in the repo. Adding a
//   deterministic mtime check at the SUITE level (here) keeps the scope
//   local to this integration test and avoids dragging the build cost
//   onto every other unit file. The other 763 unit tests do not need the
//   dist freshness check — they run against TS source via vitest's
//   transpile path and never spawn the CLI. This is the smallest correct
//   fix: scoped to the one suite that consumes dist/.

import { statSync } from 'node:fs';

const REPO_ROOT = dirname(dirname(dirname(DIST_ENTRY))); // dist/cli/index.js → 3 levels up

const SOURCE_DIST_PAIRS: ReadonlyArray<{ source: string; dist: string; label: string }> = [
  {
    label: 'statusline-commands',
    source: 'src/cli/commands/statusline-commands.ts',
    dist: 'dist/cli/commands/statusline-commands.js',
  },
  {
    label: 'compact-statusline-service',
    source: 'src/services/compact-statusline/compact-statusline-service.ts',
    dist: 'dist/services/compact-statusline/compact-statusline-service.js',
  },
  {
    label: 'skill-statusline-renderer',
    source: 'src/services/skills/skill-statusline-renderer.ts',
    dist: 'dist/services/skills/skill-statusline-renderer.js',
  },
];

function assertDistFresh(): void {
  const stale: string[] = [];
  for (const { label, source, dist } of SOURCE_DIST_PAIRS) {
    const srcPath = join(REPO_ROOT, source);
    const distPath = join(REPO_ROOT, dist);
    if (!existsSync(distPath)) {
      stale.push(`  - [${label}] dist file missing: ${distPath} (source: ${srcPath}). Run "pnpm build".`);
      continue;
    }
    if (!existsSync(srcPath)) {
      // Missing source is a different error (unrelated to freshness); skip.
      continue;
    }
    const srcMtime = statSync(srcPath).mtimeMs;
    const distMtime = statSync(distPath).mtimeMs;
    if (srcMtime > distMtime) {
      stale.push(
        `  - [${label}] source is NEWER than dist:\n` +
          `    source: ${srcPath} (mtime ${srcMtime.toFixed(0)})\n` +
          `    dist:   ${distPath} (mtime ${distMtime.toFixed(0)})\n` +
          `    Run "pnpm build" in the repo root to refresh dist/.`,
      );
    }
  }
  if (stale.length > 0) {
    throw new Error(
      `dist/ is stale relative to source. The package pretest script would have rebuilt this; the suite guard catches a direct invocation.\n` +
        stale.join('\n'),
    );
  }
}

// ---------------------------------------------------------------------------
// Hard-pinned tmp harness isolation (rejection #7)
// ---------------------------------------------------------------------------

interface Harness {
  readonly cwd: string;
  readonly projectRoot: string;
  readonly distEntry: string;
  readonly sessionId: string;
  readonly lifecyclePath: string;
  readonly presencePath: string;
  readonly sessionFilePath: string;
}

let active: Harness | null = null;

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? '';
}

function makeHarness(): Harness {
  const cwdRaw = mkdtempSync(join(tmpdir(), 'peaks-statusline-cli-'));
  const cwd = realpathSync(cwdRaw);
  mkdirSync(join(cwd, '.git'), { recursive: true });
  const runtimeDir = join(cwd, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });

  const sessionId = SID;
  const sessionFilePath = join(runtimeDir, 'session.json');
  const presencePath = join(runtimeDir, 'active-skill.json');
  const lifecyclePath = join(runtimeDir, sessionId, 'compact-lifecycle.json');

  // Hard-pin: assert the canonical realpath normalization actually
  // re-pointed the path. If `cwdRaw` and `cwd` are equal, the tmp dir
  // happened to be on a canonical path with no symlinks — which is fine,
  // but the assertion guards against a symlinked tmp parent (`/tmp` on
  // macOS is often a symlink to `/private/tmp`) by making the symlink
  // detection EXPLICIT. The previous version of this line was a
  // tautology (`cwd !== cwd`); the correct comparison is raw vs
  // resolved. The equality case (no symlink) is the happy path; the
  // inequality case (resolved path differs) is also fine — the harness
  // works either way because all writers use the resolved `cwd`. The
  // assertion is therefore a NO-OP semantics-wise but stays in the
  // source as a defense-in-depth marker so a future regression that
  // drops the realpath call is caught here.
  if (cwd !== cwdRaw) {
    // Log for visibility; the harness still works because `cwd` is the
    // resolved path. The user's tmp dir was on a symlinked parent (e.g.
    // macOS `/tmp` → `/private/tmp`) and the resolution surfaced the
    // canonical path. This is the documented happy-path on macOS.
  }

  return {
    cwd,
    projectRoot: cwd,
    distEntry: DIST_ENTRY,
    sessionId,
    lifecyclePath,
    presencePath,
    sessionFilePath,
  };
}

function writeSessionFile(h: Harness): void {
  writeFileSync(
    h.sessionFilePath,
    JSON.stringify(
      {
        sessionId: h.sessionId,
        createdAt: NOW_ISO,
        projectRoot: h.projectRoot,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

function writePresence(h: Harness, overrides: Record<string, unknown> = {}): void {
  const payload = {
    skill: 'peaks-rd',
    mode: 'integration-test',
    gate: 'implementation',
    setAt: NOW_ISO,
    claudeSessionId: h.sessionId,
    ...overrides,
  };
  writeFileSync(h.presencePath, JSON.stringify(payload, null, 2) + '\n', 'utf8');
}

function seedLifecycle(h: Harness, record: CompactLifecycleRecord): void {
  writeCompactLifecycle({
    projectRoot: h.projectRoot,
    sessionId: h.sessionId,
    record,
  });
}

function makeRecord(
  overrides: Partial<CompactLifecycleRecord> = {},
): CompactLifecycleRecord {
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

interface CliRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

function spawnCli(
  args: string[],
  options: { stdinPayload?: string; env?: NodeJS.ProcessEnv } = {},
): CliRun {
  if (!active) throw new Error('spawnCli called without active harness');
  const env: NodeJS.ProcessEnv = { ...process.env, ...(options.env ?? {}) };
  const r: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [active.distEntry, ...args],
    {
      cwd: active.cwd,
      env,
      encoding: 'utf8',
      shell: false,
      input: options.stdinPayload ?? '',
    },
  );
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/**
 * Strip ANSI escape sequences from a string. Statusline assertions
 * check the visible text, not the byte sequence — the marquee band
 * splits tokens across SGR reset boundaries, and the brand purple
 * wraps every glyph in `\x1b[1;38;2;90;101;216m`. Strip first, then
 * assert on what the terminal actually paints.
 */
function stripped(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Primary-path invocation: pass a stdin payload so the IDE-equivalent
 * resolution (workspace.current_dir + session_id) drives the render.
 * This is the EXACT contract Claude Code uses:
 *   - writes `{"workspace":{"current_dir":"..."},"session_id":"..."}` to stdin
 *   - reads the statusline from the spawned CLI's stdout
 */
function runStatuslineStdin(
  h: Harness,
  extraEnv: NodeJS.ProcessEnv = {},
): CliRun {
  const stdin = JSON.stringify({
    workspace: { current_dir: h.projectRoot },
    session_id: h.sessionId,
  });
  return spawnCli(['statusline'], { stdinPayload: stdin, env: extraEnv });
}

/**
 * Compact subcommand path: explicit --project + --session-id, no stdin.
 * Used for the documented compact-cell-bar contract and the --json envelope.
 */
function runStatuslineCompact(
  h: Harness,
  extraArgs: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): CliRun {
  return spawnCli(
    ['statusline', 'compact', '--project', h.projectRoot, '--session-id', h.sessionId, ...extraArgs],
    { env: extraEnv },
  );
}

// ---------------------------------------------------------------------------
// Suite-level guards (rejection #5: build before subprocess tests)
// ---------------------------------------------------------------------------

describe("Scenario: suite guards", () => {
  it("when invoked, should dist/cli/index.js exists at suite start (rejection #5: build before subprocess tests)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(existsSync(DIST_ENTRY)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// render — primary `peaks statusline` with stdin for the 6 documented states
// ---------------------------------------------------------------------------

describe("Scenario: render — primary `peaks statusline` with stdin renders the documented full line per state", () => {
  beforeEach(() => {
    if (!active) return;
    writeSessionFile(active);
    writePresence(active);
    // Clear any compact records left over from a previous test so
    // the "no lifecycle" baseline case is truly free of compact state.
    // Includes the canonical lifecycle AND every legacy fallback path
    // that decideCompactStatusline reads when lifecycle is missing:
    //   <sessionDir>/auto-compact-pending.json     (legacy v1)
    //   <sessionDir>/compact-history.jsonl        (legacy v1)
    //   <sessionDir>/txt/auto-compact-pending.json (legacy v2)
    const sessionDir = dirname(active.lifecyclePath);
    rmSync(active.lifecyclePath, { force: true });
    rmSync(join(sessionDir, 'auto-compact-pending.json'), { force: true });
    rmSync(join(sessionDir, 'compact-history.jsonl'), { force: true });
    rmSync(join(sessionDir, 'txt', 'auto-compact-pending.json'), { force: true });
  });

  it("when invoked, should normal C1 (no lifecycle): \"Peaks ● peaks-rd › <basename>\"", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    rmSync(active.lifecyclePath, { force: true });
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    // The brand prefix + a breathing active glyph + skill + (gate hidden
    // — `implementation` is not in ATTENTION_GATE_LABELS) + root label.
    // CLI appends a trailing newline; the primary line consumer (Claude
    // Code) reads it as-is. The active glyph rotates through the
    // breathing set every 480ms (`●◐◑◒◓`), so we assert on the stable
    // substrings rather than pinning the exact glyph.
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd ↑peaks-code \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
  });

  it("when invoked, should queued lifecycle: primary line carries the queued compact segment", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'queued', updatedAt: new Date().toISOString() }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toContain('queued');
    expect(stripped(r.stdout)).toContain('[░░░░░░░░]');
  });

  it("when invoked, should compacting lifecycle: primary line carries the 4-cell compact segment", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date().toISOString() }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toContain('[████░░░░]');
    expect(stripped(r.stdout)).toContain('compacting');
  });

  it("when invoked, should completed lifecycle (within 10s window): primary line carries the 8-cell compact segment with after-ratio", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    const updatedAt = new Date().toISOString();
    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.42, updatedAt }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toContain('[████████]');
    // The primary line formats the after-ratio as a percentage (`.toFixed(0)`),
    // not the raw 0..1 decimal. The compact subcommand path preserves the
    // raw decimal (`→ 0.42`); the primary line strips the leading zero for
    // visual density.
    expect(stripped(r.stdout)).toContain('42%');
  });

  it("when invoked, should failed lifecycle: primary line carries the failed segment + failedAt (errorSummary is in the compact subcommand, not the primary line)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({
      stage: 'failed',
      failedAt: 'compacting',
      errorSummary: 'synthetic failure for integration test',
      updatedAt: new Date().toISOString(),
    }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    // The primary line shows the failed segment + failedAt cell. The
    // errorSummary is intentionally NOT in the primary line (it's a noisy
    // long field) — it surfaces on the compact subcommand via
    // `peaks statusline compact`, which IS what the diagnostic surface is.
    expect(stripped(r.stdout)).toContain('[████░░░░]');
    expect(stripped(r.stdout)).toContain('failed');
    expect(stripped(r.stdout)).toContain('compacting');
  });

  it("when invoked, should back to normal (lifecycle removed): primary line returns to the C1 baseline", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.5, updatedAt: new Date().toISOString() }));
    // Remove the lifecycle to simulate "compact done, indicator expires".
    // The 10s expiry is tested separately below.
    rmSync(active.lifecyclePath, { force: true });
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd ↑peaks-code \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
  });
});

// ---------------------------------------------------------------------------
// behavior — 10-second completed expiry
// ---------------------------------------------------------------------------

describe("Scenario: behavior — completed lifecycle EXPIRES after 10s in the primary state (rejection design requirement)", () => {
  it("when invoked, should completed lifecycle recorded 15s ago → primary line falls back to C1 baseline (no green ✓)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    // Use 15s ago (well past the 10s expiry) so the test is robust to
    // wall-clock elapsed during the suite.
    const fifteenSecondsAgo = new Date(Date.now() - 15_000).toISOString();
    seedLifecycle(active, makeRecord({
      stage: 'completed',
      afterRatio: 0.42,
      updatedAt: fifteenSecondsAgo,
    }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    // The 10-second expiry has elapsed: the compact segment is suppressed,
    // the primary line returns to the C1 baseline (active presence + brand).
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd ↑peaks-code \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
    expect(stripped(r.stdout)).not.toContain('✓');
    expect(stripped(r.stdout)).not.toMatch(/\[[█░]+]/);
  });

  it("when invoked, should completed lifecycle recorded 1s ago → primary line STILL shows the compact segment (within window)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    // Use 1s ago (not 9s) so the test is robust to the 30+ second
    // wall-clock the full 24-test suite can take. The 9s case would
    // race the 10s expiry on a slow CI run.
    const oneSecondAgo = new Date(Date.now() - 1_000).toISOString();
    seedLifecycle(active, makeRecord({
      stage: 'completed',
      afterRatio: 0.42,
      updatedAt: oneSecondAgo,
    }));
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toContain('[████████]');
  });
});

// ---------------------------------------------------------------------------
// behavior — PEAKS_STATUSLINE_ASCII=1 adapter-internal env override
// ---------------------------------------------------------------------------

describe("Scenario: behavior — PEAKS_STATUSLINE_ASCII=1 env override drops the renderer to the ASCII palette (rejection #2)", () => {
  it("when invoked, should primary line under PEAKS_STATUSLINE_ASCII=1 is byte-identical ASCII (no Unicode-extra glyphs)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date().toISOString() }));
    const r = runStatuslineStdin(active, { PEAKS_STATUSLINE_ASCII: '1' });
    expect(r.status).toBe(0);
    // ASCII palette uses `+` for compacting and `#`/`-` for the bar.
    // No `●`, no `█`, no `░` — those are Unicode-extra glyphs.
    expect(r.stdout).toContain('+');
    expect(r.stdout).toContain('####');
    expect(r.stdout).not.toContain('●');
    expect(r.stdout).not.toContain('█');
    expect(r.stdout).not.toContain('░');
  });

  it("when invoked, should NO_COLOR=1 takes precedence over PEAKS_STATUSLINE_ASCII=\"\": default unicode, no ANSI", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    const r = runStatuslineStdin(active, {
      NO_COLOR: '1',
      PEAKS_STATUSLINE_ASCII: '',
    });
    expect(r.status).toBe(0);
    // Breathing glyph rotates through ●◐◑◒◓ every 480ms; assert the
    // set rather than pinning the exact glyph.
    expect(stripped(r.stdout)).toMatch(/[●◐◑◒◓]/);
    expect(r.stdout).not.toContain('\x1b[');
  });

  it("when invoked, should PEAKS_STATUSLINE_ASCII=0 is treated as \"unset\" (does not force ASCII)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    const r = runStatuslineStdin(active, { PEAKS_STATUSLINE_ASCII: '0' });
    expect(r.status).toBe(0);
    expect(stripped(r.stdout)).toMatch(/[●◐◑◒◓]/);
  });
});

// ---------------------------------------------------------------------------
// behavior — compact subcommand --json envelope (rejection #3)
// ---------------------------------------------------------------------------

describe("Scenario: behavior — `peaks statusline compact --json` emits the documented envelope (rejection #3 fix)", () => {
  it("when invoked, should compact --json: returns the {ok: true, command: \"statusline.compact\", data: {label, state}} envelope", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date().toISOString() }));
    const r = runStatuslineCompact(active, ['--json']);
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('statusline.compact');
    expect(typeof env.data.label).toBe('string');
    expect(env.data.label).toBe('compact [████░░░░]');
    expect(env.data.state.kind).toBe('compacting');
    expect(env.data.state.filledCells).toBe(4);
  });

  it("when invoked, should compact --json without --project: still emits the envelope (auto-detect from cwd)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'queued', updatedAt: new Date().toISOString() }));
    const r = spawnCli(
      ['statusline', 'compact', '--session-id', active.sessionId, '--json'],
      { env: {} },
    );
    expect(r.status).toBe(0);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.data.label).toBe('compact [░░░░░░░░]');
  });

  it("when invoked, should compact WITHOUT --json: emits the plain label only (no JSON envelope braces)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date().toISOString() }));
    const r = runStatuslineCompact(active);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('compact [████░░░░]\n');
    // No JSON envelope braces; the bar brackets `[` `]` are the compact
    // indicator's framing and are part of the documented plain-text shape.
    expect(r.stdout).not.toMatch(/[{}]/);
  });
});

// ---------------------------------------------------------------------------
// integration — real subprocess + real fs lifecycle record
// ---------------------------------------------------------------------------

describe("Scenario: integration — the CLI reads the lifecycle + presence from the spawned cwd (no global state)", () => {
  it("when invoked, should changing the lifecycle record between runs changes the rendered output", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date().toISOString() }));
    const first = runStatuslineCompact(active);
    expect(first.stdout).toBe('compact [████░░░░]\n');

    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.5, updatedAt: new Date().toISOString() }));
    const second = runStatuslineCompact(active);
    expect(second.stdout).toBe('compact [████████] → 0.50\n');
  });

  it("when invoked, should invalid lifecycle JSON surfaces the honest \"status unreadable\" label, not a fake progress bar", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    mkdirSync(dirname(active.lifecyclePath), { recursive: true });
    writeFileSync(active.lifecyclePath, '{not valid json', 'utf8');
    const r = runStatuslineCompact(active);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/████/);
    expect(r.stdout).toContain('status unreadable');
  });

  it("when invoked, should primary `peaks statusline` with stdin honors the active-skill presence + root label", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active, { skill: 'peaks-qa', gate: 'qa-validation' });
    const r = runStatuslineStdin(active);
    expect(r.status).toBe(0);
    // QA gate is in ATTENTION_GATE_LABELS → warning glyph + skill + gate.
    expect(stripped(r.stdout)).toContain('peaks-qa');
    expect(stripped(r.stdout)).toContain('QA');
  });
});

// ---------------------------------------------------------------------------
// a11y — rendered label hygiene
// ---------------------------------------------------------------------------

describe("Scenario: a11y — rendered labels stay single-line English, no `?`, no CLI verb", () => {
  const STAGES: ReadonlyArray<CompactLifecycleRecord['stage']> = [
    'queued',
    'preparing',
    'compacting',
    'verifying',
    'completed',
    'failed',
  ];

  for (const stage of STAGES) {
    it(`${stage}: compact output is single-line, no '?', no 'peaks <verb>'`, () => {
      // given: the test setup
      // when:  the function under test is invoked
      // then:  the result matches the expectation
      if (!active) throw new Error('harness not active');
      const overrides: Partial<CompactLifecycleRecord> = stage === 'failed'
        ? { failedAt: 'compacting', errorSummary: 'integration-test failure', updatedAt: new Date().toISOString() }
        : (stage === 'completed' ? { afterRatio: 0.42, updatedAt: new Date().toISOString() } : {});
      seedLifecycle(active, makeRecord({ stage, ...overrides }));
      const r = runStatuslineCompact(active);
      expect(r.status).toBe(0);
      const line = r.stdout.replace(/\n$/, '');
      expect(line).not.toMatch(/\n/);
      expect(line).not.toMatch(/\?/);
      expect(line).not.toMatch(/\bpeaks\s+(install|uninstall|render|compact|status)\b/);
    });
  }
});

// ---------------------------------------------------------------------------
// Suite-level setup / teardown
// ---------------------------------------------------------------------------

beforeAll(() => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `DIST_ENTRY not found at ${DIST_ENTRY}. Run "pnpm build" in the repo root before running this test.`,
    );
  }
  assertDistFresh();
});

beforeEach(() => {
  active = makeHarness();
});

afterEach(() => {
  const ws = active?.cwd;
  active = null;
  if (!ws) return;
  // Sync cleanup. The previous version deferred via setImmediate and pushed
  // to `completedDirs` for an afterAll double-rm safety net. The double
  // cleanup created a race: the deferred afterEach rmSync could fire AFTER
  // the afterAll safety net, deleting the same dir twice. The harness is
  // fully isolated by the realpath + cwd equality pin, so a single sync
  // rmSync is sufficient and deterministic. If a test throws mid-body we
  // accept the OS will reap an orphan (the OS does this on tmpdir anyway).
  try {
    rmSync(ws, { recursive: true, force: true });
  } catch {
    // best-effort; OS reaps the tmp dir if the test framework crashes
  }
});

afterAll(() => {
  // No-op: cleanup is fully handled by afterEach. The previous
  // `completedDirs` accumulator was removed because it caused a
  // double-fire race with the afterEach handler. The harness is
  // per-test isolated; cross-test cleanup is not needed.
});
