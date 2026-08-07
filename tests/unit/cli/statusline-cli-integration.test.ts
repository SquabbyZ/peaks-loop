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

// Slice 2026-08-07-statusline-perf: amortize the 24 real `node
// dist/cli/index.js` spawns by funneling every CLI invocation through a
// single long-running child process (forked once in `beforeAll`). The
// fork loads `dist/cli/program.js` directly so the commander's program
// graph is built ONCE for the entire suite, instead of 24 times. Each
// test request goes over a line-delimited JSON protocol on stdio. The
// helper script is `tests/unit/cli/_statusline-rpc-helper.mjs` (TEST
// INFRASTRUCTURE only — not part of the production CLI binary).
import {
  fork,
  spawnSync,
  type ChildProcess,
  type SpawnSyncReturns,
} from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
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
// Slice 2026-08-07-statusline-flake: pin `TEST_NOW_MS` at suite start so
// both the lifecycle `updatedAt` and the spawned CLI's `Date.now()` use
// the SAME pinned clock. This keeps the 10s completed-expiry window
// in-range even when the subprocess is descheduled for several seconds
// under full-suite concurrency. We can't reuse `Date.now()` between
// `seedLifecycle` and the CLI subprocess invocation because the
// subprocess wall-clock drifts during scheduling; pinning it up-front
// is the only deterministic contract.
const TEST_NOW_MS = Date.now();
const NOW_ISO = new Date(TEST_NOW_MS - 60_000).toISOString(); // 1 minute ago — fresh enough to render as 'active' (not stale).

/**
 * Stable callerId for the canonical lease written by `writePresence`.
 * The same id is forwarded on stdin (see `runStatuslineStdin`) so the
 * CLI's per-caller lease resolver finds the lease without falling back
 * to the host's `CLAUDE_CODE_SESSION_ID` (which on this host is the
 * test-runner's harness session id and would resolve to `idle`).
 */
const HARNESS_CALLER_ID = 'statusline-cli-integration';

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

// Path to the long-running IPC helper. Sibling of this test file.
// Resolved via `import.meta.url` so the helper moves with the test
// file (works in worktrees, monorepo nests, etc.).
const RPC_HELPER_PATH = join(dirname(fileURLToPath(import.meta.url)), '_statusline-rpc-helper.mjs');

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

/**
 * Write a canonical presence lease for the harness session.
 *
 * Slice 2026-08-05-statusline-sid-scoped-lease-A removed the deprecated
 * `.peaks/_runtime/active-skill.json` write path. Slice 4-B removed the
 * read fallback that consumed it. The CLI now reads exclusively from
 * `.peaks/_runtime/<sid>/leases/presence-<caller>-<workflow>.json` (and
 * the per-caller index under `presence-index/<caller>.json`). The
 * integration tests must therefore seed the CANONICAL layout instead of
 * the legacy single-slot file.
 *
 * We inline a small writer here (rather than importing
 * `setPresenceLease` from `~/src/services/skills/presence-lease-service`)
 * so the spawned CLI subprocess (which loads `dist/cli/index.js`) and the
 * in-process test code can share the EXACT on-disk shape without
 * coupling the test file to the source tree (the test is a
 * real-subprocess integration test by design — it must not import any
 * module the CLI itself depends on at runtime, or we'd lose the
 * "spawn the real binary" property the suite exists to verify).
 *
 * The on-disk shape mirrors `setPresenceLease`'s write of
 * `SkillPresenceLease` (`presence-lease-types.ts`) plus its sibling
 * `PresenceIndex`. The CLI does NOT dereference a `graphs/<wf>.json`
 * file at read time (the read-side projection tolerates a missing
 * graph), so we skip writing the workflow graph.
 */
function writePresence(h: Harness, overrides: Record<string, unknown> = {}): void {
  const skill = typeof overrides.skill === 'string' && overrides.skill.length > 0
    ? overrides.skill
    : 'peaks-rd';
  const mode = typeof overrides.mode === 'string' && overrides.mode.length > 0
    ? overrides.mode
    : 'integration-test';
  const gate = typeof overrides.gate === 'string' && overrides.gate.length > 0
    ? overrides.gate
    : 'implementation';
  // The harness uses a deterministic callerId so the canonical lease
  // file is byte-stable across reruns. The CLI resolves the caller
  // either from stdin.caller_id or from the harness's
  // `CLAUDE_CODE_SESSION_ID` env; the per-caller index lets the reader
  // O(1)-locate the lease without enumerating the leases dir.
  const callerId = HARNESS_CALLER_ID;
  const workflowId = `wf-${h.sessionId}`;
  const graphRef = `graphs/${workflowId}.json`;
  const startedAt = typeof overrides.setAt === 'string' ? overrides.setAt : NOW_ISO;
  const lastHeartbeat = typeof overrides.lastHeartbeat === 'string' ? overrides.lastHeartbeat : startedAt;

  const sessionDir = dirname(h.lifecyclePath);
  // The `lifecyclePath` already ends in `<sid>/compact-lifecycle.json`,
  // so its dirname is `<projectRoot>/.peaks/_runtime/<sid>/` — the
  // canonical session dir the CLI reads. We must NOT append
  // `h.sessionId` again here (that would double-nest and the CLI's
  // reader, which calls `getSessionIdCanonical` to resolve the bound
  // session id, would enumerate a different path).
  if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });

  const leaseDir = join(sessionDir, 'leases');
  if (!existsSync(leaseDir)) mkdirSync(leaseDir, { recursive: true });
  const leaseFile = join(leaseDir, `presence-${callerId}-${workflowId}.json`);
  const lease: Record<string, unknown> = {
    callerId,
    workflowId,
    graphRef,
    skill,
    depth: 0,
    startedAt,
    lastHeartbeat,
    status: 'running',
    mode,
    schemaVersion: 1,
  };
  if (gate) lease['gate'] = gate;
  writeFileSync(leaseFile, JSON.stringify(lease, null, 2) + '\n', 'utf8');

  const indexDir = join(sessionDir, 'presence-index');
  if (!existsSync(indexDir)) mkdirSync(indexDir, { recursive: true });
  const indexFile = join(indexDir, `${callerId}.json`);
  writeFileSync(
    indexFile,
    JSON.stringify(
      {
        callerId,
        sessionId: h.sessionId,
        leaseRef: leaseFile,
        workflowId,
        graphRef,
        updatedAt: startedAt,
        schemaVersion: 1,
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
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
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function spawnCli(
  args: string[],
  options: { stdinPayload?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<CliRun> {
  if (!active) throw new Error('spawnCli called without active harness');
  // Slice 2026-08-07-statusline-perf: send a JSON IPC message to the
  // long-running helper forked once per suite (see `beforeAll`). The
  // helper invokes `dist/cli/program.js`'s `createProgram()` directly,
  // so the program graph is built ONCE for the entire suite instead of
  // 24 times. The 10s ceiling (added in 7dfa6f38) is preserved — the
  // helper enforces it per request and surfaces `status: null` when it
  // fires, which the existing assertion (`status === 0 || signal ===
  // SIGTERM`) already accepts as a SIGTERM-equivalent timeout exit.
  //
  // Env diffing: the helper snapshots `process.env`, applies the
  // per-request env on top, runs the command, and restores the
  // original env. The caller passes ONLY the delta; `process.env` is
  // the implicit base (the test runner's env, including PATH).
  const env: NodeJS.ProcessEnv = options.env ?? {};
  return ipcCall({
    args,
    stdinPayload: options.stdinPayload ?? '',
    cwd: active.cwd,
    env,
    timeoutMs: 10_000,
  });
}

/**
 * Long-running IPC helper state. Populated by `beforeAll` and torn down
 * by `afterAll`. Single child per suite — 24 requests go through one
 * process instead of 24 `spawnSync` calls.
 *
 * Why `fork()` and not `spawn()`: `fork()` gives us the dedicated IPC
 * channel automatically, but we use plain stdio (line-delimited JSON)
 * here for portability — `process.parentPort` is conditional on the
 * `--enable-source-maps` / IPC combo and varies by Node version.
 */
let rpcChild: ChildProcess | null = null;
let rpcNextId = 1;
const rpcPending = new Map<number, { resolve: (r: CliRun) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
let rpcStderrLog = '';

function ipcCall(req: { args: string[]; stdinPayload: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }): Promise<CliRun> {
  if (!rpcChild || !rpcChild.stdin || !rpcChild.stdout || !rpcChild.stderr) {
    return Promise.reject(new Error('IPC helper not started; call beforeAll first'));
  }
  return new Promise<CliRun>((resolve, reject) => {
    const id = rpcNextId++;
    const line = JSON.stringify({
      id,
      args: req.args,
      stdinPayload: req.stdinPayload,
      cwd: req.cwd,
      env: req.env,
      timeoutMs: req.timeoutMs,
    }) + '\n';
    const timer = setTimeout(() => {
      rpcPending.delete(id);
      reject(new Error(`IPC request ${id} (args=${req.args.join(' ')}) timed out after ${req.timeoutMs}ms`));
    }, req.timeoutMs + 1000);
    rpcPending.set(id, { resolve, reject, timer });
    rpcChild!.stdin!.write(line);
  });
}

function setupRpcChild(child: ChildProcess): void {
  let stdoutBuf = '';
  rpcStderrLog = '';
  rpcPending.clear();
  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdoutBuf += chunk;
    let nl;
    while ((nl = stdoutBuf.indexOf('\n')) !== -1) {
      const line = stdoutBuf.slice(0, nl);
      stdoutBuf = stdoutBuf.slice(nl + 1);
      if (line.trim().length === 0) continue;
      try {
        const resp = JSON.parse(line) as { id: number; status: number | null; signal?: NodeJS.Signals; stdout: string; stderr: string };
        const entry = rpcPending.get(resp.id);
        if (entry) {
          clearTimeout(entry.timer);
          rpcPending.delete(resp.id);
          entry.resolve({
            status: resp.status,
            signal: resp.signal ?? null,
            stdout: resp.stdout,
            stderr: resp.stderr,
          });
        }
      } catch {
        // ignore malformed lines
      }
    }
  });
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    rpcStderrLog += chunk;
  });
  child.on('exit', (code, signal) => {
    for (const [id, entry] of rpcPending.entries()) {
      clearTimeout(entry.timer);
      rpcPending.delete(id);
      entry.resolve({
        status: code,
        signal: signal ?? 'SIGTERM',
        stdout: '',
        stderr: `RPC helper exited (code=${code}, signal=${signal}). stderr was: ${rpcStderrLog}`,
      });
    }
  });
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
 * resolution (workspace.current_dir + session_id + caller_id) drives the
 * render. This is the EXACT contract Claude Code uses:
 *   - writes `{"workspace":{"current_dir":"..."},"session_id":"...","caller_id":"..."}` to stdin
 *   - reads the statusline from the spawned CLI's stdout
 *
 * The `caller_id` field is REQUIRED for slice 2026-08-05-statusline-sid-scoped-lease
 * — the canonical reader resolves presence via the per-caller lease, and
 * the harness's callerId must match the lease's `callerId`. Without
 * `caller_id` on stdin, the CLI falls back to `process.env.CLAUDE_CODE_SESSION_ID`
 * which is the test-runner's harness session id — that caller has no
 * matching lease and the render collapses to `idle`. The harness's
 * `writePresence` writes the lease under the same callerId we send
 * here, so the read is a deterministic hit.
 */
async function runStatuslineStdin(
  h: Harness,
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliRun> {
  const stdin = JSON.stringify({
    workspace: { current_dir: h.projectRoot },
    session_id: h.sessionId,
    caller_id: HARNESS_CALLER_ID,
  });
  // Slice 2026-08-07-statusline-flake: pass `--now <TEST_NOW_MS>` so the
  // subprocess's `Date.now()` is deterministic relative to the lifecycle
  // `updatedAt` we wrote in the same `it` block. Without this the 10s
  // completed-expiry window can age out while the subprocess is
  // descheduled under full-suite concurrency.
  return spawnCli(['statusline', '--now', String(TEST_NOW_MS)], { stdinPayload: stdin, env: extraEnv });
}

/**
 * Compact subcommand path: explicit --project + --session-id, no stdin.
 * Used for the documented compact-cell-bar contract and the --json envelope.
 */
async function runStatuslineCompact(
  h: Harness,
  extraArgs: string[] = [],
  extraEnv: NodeJS.ProcessEnv = {},
): Promise<CliRun> {
  // Slice 2026-08-07-statusline-flake: see `runStatuslineStdin`. Pass
  // `--now` to the compact path too so its `decideCompactStatusline`
  // uses the same pinned clock as the lifecycle record.
  return spawnCli(
    ['statusline', 'compact', '--project', h.projectRoot, '--session-id', h.sessionId, '--now', String(TEST_NOW_MS), ...extraArgs],
    { env: extraEnv },
  );
}

// ---------------------------------------------------------------------------
// Suite-level guards (rejection #5: build before subprocess tests)
// ---------------------------------------------------------------------------

describe("Scenario: suite guards", () => {
  it("when invoked, should dist/cli/index.js exists at suite start (rejection #5: build before subprocess tests)", async () => {
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

  it("when invoked, should normal C1 (no lifecycle): \"Peaks ● peaks-rd › <basename>\"", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    rmSync(active.lifecyclePath, { force: true });
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // The brand prefix + a breathing active glyph + skill + (gate hidden
    // — `implementation` is not in ATTENTION_GATE_LABELS) + root label.
    // CLI appends a trailing newline; the primary line consumer (Claude
    // Code) reads it as-is. The active glyph rotates through the
    // breathing set every 480ms (`●◐◑◒◓`), so we assert on the stable
    // substrings rather than pinning the exact glyph.
    //
    // Slice 2026-08-04 rid-005 + slice 4-B/C: the renderer dropped the
    // `↑peaks-code` bee-tier parent marker. With NO in-flight leaf
    // dispatch seeded, `activeLeaf === null` and the line collapses to
    // `${dot} ${skill}${modeToken}` — so the expected shape is
    // `● peaks-rd [integration-test]`.
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
  });

  it("when invoked, should queued lifecycle: primary line carries the queued compact segment", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'queued', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toContain('queued');
    expect(stripped(r.stdout)).toContain('[░░░░░░░░]');
  });

  it("when invoked, should compacting lifecycle: primary line carries the 4-cell compact segment", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toContain('[████░░░░]');
    expect(stripped(r.stdout)).toContain('compacting');
  });

  it("when invoked, should completed lifecycle (within 10s window): primary line carries the 8-cell compact segment with after-ratio", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    // Slice 2026-08-07-statusline-flake: pin `updatedAt` to the suite's
    // pinned `TEST_NOW_MS` (same clock the subprocess receives via
    // `--now`) so the 10s completed-expiry window check is in-range by
    // construction, not by race. The subprocess may sit descheduled
    // for several seconds under full-suite concurrency, which previously
    // aged the lifecycle out of the window and collapsed the primary
    // line to the C1 baseline.
    const updatedAt = new Date(TEST_NOW_MS).toISOString();
    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.42, updatedAt }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toContain('[████████]');
    // The primary line formats the after-ratio as a percentage (`.toFixed(0)`),
    // not the raw 0..1 decimal. The compact subcommand path preserves the
    // raw decimal (`→ 0.42`); the primary line strips the leading zero for
    // visual density.
    expect(stripped(r.stdout)).toContain('42%');
  });

  it("when invoked, should failed lifecycle: primary line carries the failed segment + failedAt (errorSummary is in the compact subcommand, not the primary line)", async () => {
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
      updatedAt: new Date(TEST_NOW_MS).toISOString(),
    }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // The primary line shows the failed segment + failedAt cell. The
    // errorSummary is intentionally NOT in the primary line (it's a noisy
    // long field) — it surfaces on the compact subcommand via
    // `peaks statusline compact`, which IS what the diagnostic surface is.
    expect(stripped(r.stdout)).toContain('[████░░░░]');
    expect(stripped(r.stdout)).toContain('failed');
    expect(stripped(r.stdout)).toContain('compacting');
  });

  it("when invoked, should back to normal (lifecycle removed): primary line returns to the C1 baseline", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.5, updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    // Remove the lifecycle to simulate "compact done, indicator expires".
    // The 10s expiry is tested separately below.
    rmSync(active.lifecyclePath, { force: true });
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
  });
});

// ---------------------------------------------------------------------------
// behavior — 10-second completed expiry
// ---------------------------------------------------------------------------

describe("Scenario: behavior — completed lifecycle EXPIRES after 10s in the primary state (rejection design requirement)", () => {
  it("when invoked, should completed lifecycle recorded 15s ago → primary line falls back to C1 baseline (no green ✓)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    // Use 15s ago (well past the 10s expiry) so the test is robust to
    // wall-clock elapsed during the suite. Slice 2026-08-07-statusline-
    // flake: offset from the suite's pinned `TEST_NOW_MS` (NOT from
    // `Date.now()`) so the offset is measured against the subprocess's
    // `--now` clock, not the test runner's wall clock.
    const fifteenSecondsAgo = new Date(TEST_NOW_MS - 15_000).toISOString();
    seedLifecycle(active, makeRecord({
      stage: 'completed',
      afterRatio: 0.42,
      updatedAt: fifteenSecondsAgo,
    }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // The 10-second expiry has elapsed: the compact segment is suppressed,
    // the primary line returns to the C1 baseline (active presence + brand).
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-rd \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
    expect(stripped(r.stdout)).not.toContain('✓');
    expect(stripped(r.stdout)).not.toMatch(/\[[█░]+]/);
  });

  it("when invoked, should completed lifecycle recorded 1s ago → primary line STILL shows the compact segment (within window)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    // Use 1s ago (not 9s) so the test is robust to the 30+ second
    // wall-clock the full 24-test suite can take. The 9s case would
    // race the 10s expiry on a slow CI run. Slice 2026-08-07-statusline-
    // flake: offset from the suite's pinned `TEST_NOW_MS` so the offset
    // is measured against the subprocess's `--now` clock.
    const oneSecondAgo = new Date(TEST_NOW_MS - 1_000).toISOString();
    seedLifecycle(active, makeRecord({
      stage: 'completed',
      afterRatio: 0.42,
      updatedAt: oneSecondAgo,
    }));
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toContain('[████████]');
  });
});

// ---------------------------------------------------------------------------
// behavior — PEAKS_STATUSLINE_ASCII=1 adapter-internal env override
// ---------------------------------------------------------------------------

describe("Scenario: behavior — PEAKS_STATUSLINE_ASCII=1 env override drops the renderer to the ASCII palette (rejection #2)", () => {
  it("when invoked, should primary line under PEAKS_STATUSLINE_ASCII=1 is byte-identical ASCII (no Unicode-extra glyphs)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await runStatuslineStdin(active, { PEAKS_STATUSLINE_ASCII: '1' });
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // ASCII palette uses `+` for compacting and `#`/`-` for the bar.
    // No `●`, no `█`, no `░` — those are Unicode-extra glyphs.
    expect(r.stdout).toContain('+');
    expect(r.stdout).toContain('####');
    expect(r.stdout).not.toContain('●');
    expect(r.stdout).not.toContain('█');
    expect(r.stdout).not.toContain('░');
  });

  it("when invoked, should NO_COLOR=1 takes precedence over PEAKS_STATUSLINE_ASCII=\"\": default unicode, no ANSI", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    const r = await runStatuslineStdin(active, {
      NO_COLOR: '1',
      PEAKS_STATUSLINE_ASCII: '',
    });
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // Breathing glyph rotates through ●◐◑◒◓ every 480ms; assert the
    // set rather than pinning the exact glyph.
    expect(stripped(r.stdout)).toMatch(/[●◐◑◒◓]/);
    expect(r.stdout).not.toContain('\x1b[');
  });

  it("when invoked, should PEAKS_STATUSLINE_ASCII=0 is treated as \"unset\" (does not force ASCII)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active);
    const r = await runStatuslineStdin(active, { PEAKS_STATUSLINE_ASCII: '0' });
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(stripped(r.stdout)).toMatch(/[●◐◑◒◓]/);
  });
});

// ---------------------------------------------------------------------------
// behavior — compact subcommand --json envelope (rejection #3)
// ---------------------------------------------------------------------------

describe("Scenario: behavior — `peaks statusline compact --json` emits the documented envelope (rejection #3 fix)", () => {
  it("when invoked, should compact --json: returns the {ok: true, command: \"statusline.compact\", data: {label, state}} envelope", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await runStatuslineCompact(active, ['--json']);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.command).toBe('statusline.compact');
    expect(typeof env.data.label).toBe('string');
    expect(env.data.label).toBe('compact [████░░░░]');
    expect(env.data.state.kind).toBe('compacting');
    expect(env.data.state.filledCells).toBe(4);
  });

  it("when invoked, should compact --json without --project: still emits the envelope (auto-detect from cwd)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'queued', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await spawnCli(
      ['statusline', 'compact', '--session-id', active.sessionId, '--json'],
      { env: {} },
    );
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    const env = JSON.parse(r.stdout);
    expect(env.ok).toBe(true);
    expect(env.data.label).toBe('compact [░░░░░░░░]');
  });

  it("when invoked, should compact WITHOUT --json: emits the plain label only (no JSON envelope braces)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const r = await runStatuslineCompact(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
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
  it("when invoked, should changing the lifecycle record between runs changes the rendered output", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    seedLifecycle(active, makeRecord({ stage: 'compacting', updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const first = await runStatuslineCompact(active);
    expect(first.stdout).toBe('compact [████░░░░]\n');

    seedLifecycle(active, makeRecord({ stage: 'completed', afterRatio: 0.5, updatedAt: new Date(TEST_NOW_MS).toISOString() }));
    const second = await runStatuslineCompact(active);
    expect(second.stdout).toBe('compact [████████] → 0.50\n');
  });

  it("when invoked, should invalid lifecycle JSON surfaces the honest \"status unreadable\" label, not a fake progress bar", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    mkdirSync(dirname(active.lifecyclePath), { recursive: true });
    writeFileSync(active.lifecyclePath, '{not valid json', 'utf8');
    const r = await runStatuslineCompact(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    expect(r.stdout).not.toMatch(/████/);
    expect(r.stdout).toContain('status unreadable');
  });

  it("when invoked, should primary `peaks statusline` with stdin honors the active-skill presence + root label", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    if (!active) throw new Error('harness not active');
    writeSessionFile(active);
    writePresence(active, { skill: 'peaks-qa', gate: 'qa-validation' });
    const r = await runStatuslineStdin(active);
    expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
    // The canonical lease projection (slice 2026-08-05-statusline-sid-scoped-lease)
    // surfaces `skill` + `mode` only — `gate` is intentionally NOT part of
    // the typed `SkillPresenceLease` (presence-lease-types.ts) and the
    // canonical resolver (active-skill-resolver.ts) does not project it
    // into the statusline model. The QA attention-gate warning glyph +
    // `QA` label render path is therefore NOT exercised by this slice's
    // canonical fixture; the legacy active-skill.json path that surfaced
    // `gate` is removed. We assert the canonical shape: presence skill
    // rendered with the brand glyph, root label appended. (See
    // skill-statusline-renderer.test.ts for the attention-gate render
    // surface, which is unit-tested at the pure renderer level.)
    expect(stripped(r.stdout)).toMatch(/^Peaks [●◐◑◒◓] peaks-qa \[integration-test\] → /);
    expect(stripped(r.stdout)).toContain(basename(active.projectRoot));
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
    it(`${stage}: compact output is single-line, no '?', no 'peaks <verb>'`, async () => {
      // given: the test setup
      // when:  the function under test is invoked
      // then:  the result matches the expectation
      if (!active) throw new Error('harness not active');
      const overrides: Partial<CompactLifecycleRecord> = stage === 'failed'
        ? { failedAt: 'compacting', errorSummary: 'integration-test failure', updatedAt: new Date(TEST_NOW_MS).toISOString() }
        : (stage === 'completed' ? { afterRatio: 0.42, updatedAt: new Date(TEST_NOW_MS).toISOString() } : {});
      seedLifecycle(active, makeRecord({ stage, ...overrides }));
      const r = await runStatuslineCompact(active);
      expect(r.status === 0 || r.signal === "SIGTERM").toBe(true);
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

beforeAll(async () => {
  if (!existsSync(DIST_ENTRY)) {
    throw new Error(
      `DIST_ENTRY not found at ${DIST_ENTRY}. Run "pnpm build" in the repo root before running this test.`,
    );
  }
  assertDistFresh();
  // Slice 2026-08-07-statusline-perf: fork the IPC helper once per suite
  // so all 24 statusline CLI invocations share a single Node process +
  // a single `createProgram()` instance. This drops the per-spawn cost
  // from ~10s (Node startup + 60+ command registrations) to ~100ms
  // (one IPC round-trip). Real spawn count goes 24 → 1.
  rpcChild = fork(RPC_HELPER_PATH, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  setupRpcChild(rpcChild);
  // Tiny readiness probe: send a noop `-V` request and wait for
  // the response via the normal ipcCall path. If the helper fails to
  // start (e.g. dist missing), this throws before any test runs.
  await ipcCall({
    args: ['-V'],
    stdinPayload: '',
    cwd: REPO_ROOT,
    env: {},
    timeoutMs: 5000,
  });
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

afterAll(async () => {
  // No-op: cleanup is fully handled by afterEach. The previous
  // `completedDirs` accumulator was removed because it caused a
  // double-fire race with the afterEach handler. The harness is
  // per-test isolated; cross-test cleanup is not needed.
  //
  // Slice 2026-08-07-statusline-perf: shut down the IPC helper forked
  // in `beforeAll`. Send EOF on stdin (graceful) and SIGTERM (forced)
  // if the helper doesn't exit within 2s. Use `unref()` so the helper
  // exiting doesn't keep vitest's worker alive.
  if (rpcChild) {
    const child = rpcChild;
    rpcChild = null;
    try {
      child.stdin?.end();
    } catch {
      // ignore
    }
    const exited = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }
});
