// tests/integration/readonly-surface/_proof-helpers.ts
//
// The three-layer proof device's machinery (PRD rid-035 AC-3, AC-4, AC-6, AC-7).
// The arms live in `readonly-proof.test.ts`; this module only measures.
//
// THE LAUNCH SHAPE IS PLATFORM-NEUTRAL BY CONSTRUCTION (spec §8.2, PRD R1). The
// command name `peaks` is never executed: on a host where the CLI installs as a
// `.cmd` shim that fails with `InvalidBatchScriptArg`, and "handle that case" is
// itself the platform branch this slice forbids. Instead the runtime executable
// and the CLI entry are passed as two elements of an argv array
// (`process.execPath`, `bin/peaks.js`), which is the one shape that holds on every
// platform. No `if (win32)` exists anywhere in this file - and none is needed.
//
// THE STATE UNDER SNAPSHOT IS THE WHOLE POINT (AC-3 A). Before/after digests cover
// the fixture project tree AND a per-fixture home directory, less the global log
// directory, which the CLI appends to on every invocation by design (spec §5.2).
// A digest that ignored the log would be measuring a fiction; a digest that
// included it could never be equal.

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { readonlySpawnOptions } from '~/src/services/readonly-surface/argv-guard';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const PEAKS_BIN = join(REPO_ROOT, 'bin', 'peaks.js');
export const DIST_ENTRY = join(REPO_ROOT, 'dist', 'cli', 'index.js');

const HERE = dirname(fileURLToPath(import.meta.url));
export const SPY_PRELOAD_URL = pathToFileURL(join(HERE, '_readonly-spy.mjs')).href;
export const SPY_PROBE_PATH = join(HERE, '_spy-probe.mjs');

/** Per-argv exit budget. A `--watch`-class loop is caught long before this. */
export const ARGV_TIMEOUT_MS = 120_000;

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly argv: readonly string[];
}

/**
 * The runtime executable and the CLI entry, as a two-element shape. This is the
 * reusable launch resolver slice ②'s server also needs; it carries no platform
 * branch because it needs none.
 */
export function cliLaunch(argv: readonly string[]): { command: string; args: string[] } {
  return { command: process.execPath, args: [PEAKS_BIN, ...argv] };
}

export interface RunCliOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  /** Absolute file the layer-B preload writes its counters to. */
  readonly spyOut?: string;
}

export function runCli(argv: readonly string[], options: RunCliOptions): CliRun {
  const launch = cliLaunch(argv);
  const args =
    options.spyOut === undefined
      ? launch.args
      : ['--import', SPY_PRELOAD_URL, ...launch.args];
  const startedAt = Date.now();
  const result: SpawnSyncReturns<string> = spawnSync(launch.command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      ...(options.spyOut === undefined ? {} : { PEAKS_READONLY_SPY_OUT: options.spyOut })
    },
    encoding: 'utf8',
    timeout: options.timeoutMs ?? ARGV_TIMEOUT_MS,
    windowsHide: true,
    ...readonlySpawnOptions()
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    durationMs: Date.now() - startedAt,
    timedOut: (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
    argv
  };
}

function toPosix(value: string): string {
  return value.split('\\').join('/');
}

/** Every file under `root` with its content digest, keyed by POSIX relative path. */
export function digestTree(
  root: string,
  isExcluded: (relativePath: string) => boolean = () => false
): Map<string, string> {
  const digests = new Map<string, string>();
  const walk = (absolute: string): void => {
    let entries;
    try {
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(absolute, entry.name);
      const relativePath = toPosix(relative(root, full));
      if (isExcluded(relativePath)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      try {
        digests.set(
          relativePath,
          createHash('sha256').update(readFileSync(full)).digest('hex')
        );
      } catch {
        digests.set(relativePath, 'UNREADABLE');
      }
    }
  };
  try {
    if (statSync(root).isDirectory()) walk(root);
  } catch {
    // A missing root digests to nothing; the caller's fixture-validity arm is
    // what refuses to treat that as a pass.
  }
  return digests;
}

/** A single digest over a whole tree, or over several trees joined. */
export function snapshotDigest(trees: ReadonlyArray<{ root: string; exclude?: (p: string) => boolean }>): string {
  const hash = createHash('sha256');
  for (const tree of trees) {
    hash.update(`tree:${toPosix(tree.root)}\n`);
    const digests = [...digestTree(tree.root, tree.exclude ?? (() => false)).entries()].sort(
      ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)
    );
    for (const [path, digest] of digests) hash.update(`${path}\u0000${digest}\n`);
  }
  return hash.digest('hex');
}

/** Human-readable difference between two tree digests. */
export function diffTrees(
  before: ReadonlyMap<string, string>,
  after: ReadonlyMap<string, string>
): string[] {
  const changes: string[] = [];
  for (const [path, digest] of before) {
    const now = after.get(path);
    if (now === undefined) changes.push(`removed: ${path}`);
    else if (now !== digest) changes.push(`modified: ${path}`);
  }
  for (const path of after.keys()) {
    if (!before.has(path)) changes.push(`created: ${path}`);
  }
  return changes.sort();
}

/** The global log directory, relative to a fixture home. Always excluded. */
export const LOG_DIR_RELATIVE = '.peaks/logs';

export function isGlobalLog(relativePath: string): boolean {
  return relativePath === LOG_DIR_RELATIVE || relativePath.startsWith(`${LOG_DIR_RELATIVE}/`);
}

export interface ReadonlyFixture {
  readonly projectRoot: string;
  readonly homeDir: string;
  readonly sessionId: string;
  /** Environment overrides that keep every byte of state inside the fixture. */
  readonly env: Readonly<Record<string, string>>;
  /** The per-invocation CLI runs the setup needed; kept for diagnosis. */
  readonly setupRuns: readonly CliRun[];
}

function mustRun(argv: readonly string[], options: RunCliOptions): CliRun {
  const run = runCli(argv, options);
  if (run.code !== 0) {
    throw new Error(`fixture setup failed (${run.code}) for peaks ${argv.join(' ')}: ${run.stderr}`);
  }
  return run;
}

/** True when this process was asked to behave as if it were in the CI sandbox. */
export function sandboxRequested(): boolean {
  return process.env['PEAKS_READONLY_SANDBOX'] === '1';
}

/**
 * Make a tree unwritable, so that a write is a FAILURE rather than a silent
 * change. This is the in-process half of layer C's read-only mount: the CI job
 * supplies the network-less namespace, and this supplies the refusal. Directories
 * keep the execute bit, otherwise nothing inside them can be read at all.
 *
 * PLATFORM BOUNDARY, MEASURED (QA repair cycle 1, P5). On win32 these exact modes
 * (dirs 0o555, files 0o444) do NOT stop a NEW file from being created inside a
 * "read-only" directory - only MODIFYING an existing file raises EPERM. So on
 * Windows this makes the tree unmodifiable, not unwritable, and a pass there says
 * nothing about read-only mounting. The full guarantee is only expected on the
 * Linux CI runner; it is not claimed for a local Windows run.
 */
export function makeTreeReadOnly(root: string): void {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      makeTreeReadOnly(full);
      chmodSync(full, 0o555);
    } else if (entry.isFile()) {
      chmodSync(full, 0o444);
    }
  }
  chmodSync(root, 0o555);
}

/** Restore write permission so a fixture can be torn down. */
export function makeTreeWritable(root: string): void {
  const restore = (absolute: string): void => {
    let entries;
    try {
      chmodSync(absolute, 0o755);
      entries = readdirSync(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(absolute, entry.name);
      if (entry.isDirectory()) restore(full);
      else if (entry.isFile()) chmodSync(full, 0o644);
    }
  };
  restore(root);
}

const MEMORY_ENTRIES: ReadonlyArray<{ file: string; title: string; body: string }> = [
  { file: 'fixture-alpha.md', title: 'Fixture decision alpha', body: 'Alpha body for the readonly proof.' },
  { file: 'fixture-beta.md', title: 'Fixture decision beta', body: 'Beta body for the readonly proof.' }
];

/**
 * A NON-EMPTY fixture (AC-4): sessions, memory entries, a job and two request
 * artifacts, all written by the CLI itself so the shapes are the ones the readers
 * really expect. An empty fixture would make "nothing changed" vacuously true.
 */
export function createReadonlyFixture(): ReadonlyFixture {
  const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-readonly-project-'));
  const homeDir = mkdtempSync(join(tmpdir(), 'peaks-readonly-home-'));
  const env = {
    HOME: homeDir,
    USERPROFILE: homeDir,
    PEAKS_CALLER_ID: 'readonly-proof'
  };
  const setupRuns: CliRun[] = [];
  const run = (argv: readonly string[]): void => {
    setupRuns.push(mustRun(argv, { cwd: projectRoot, env }));
  };

  // The CLI resolves a project root through its git (or package) root, so a bare
  // temp directory resolves to the peaks-loop install instead of the fixture:
  // `workspace init` then reports success and writes nothing the fixture owns.
  // One `git init` is what makes the fixture a project rather than a directory.
  execFileSync('git', ['init', '--quiet'], {
    cwd: projectRoot,
    stdio: 'ignore',
    windowsHide: true
  });

  run(['workspace', 'init', '--project', '.']);
  const sessionId = (
    JSON.parse(readFileSync(join(projectRoot, '.peaks', '_runtime', 'session.json'), 'utf8')) as {
      sessionId: string;
    }
  ).sessionId;
  run(['job', 'init', '--project', '.', '--job-id', 'fixture-job', '--slice-list', 'slice-a,slice-b']);
  for (const role of ['rd', 'prd']) {
    run([
      'request',
      'init',
      '--project',
      '.',
      '--role',
      role,
      '--id',
      'fixture-request',
      '--session-id',
      sessionId,
      '--apply'
    ]);
  }
  const memoryDir = join(projectRoot, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });
  for (const entry of MEMORY_ENTRIES) {
    writeFileSync(
      join(memoryDir, entry.file),
      `---\nkind: decision\ntitle: ${entry.title}\nupdatedAt: 2026-01-01T00:00:00.000Z\n---\n\n# ${entry.title}\n\n${entry.body}\n`,
      'utf8'
    );
  }
  run(['memory', 'reindex', '--project', '.', '--apply']);

  if (sandboxRequested()) makeTreeReadOnly(projectRoot);

  return { projectRoot, homeDir, sessionId, env, setupRuns };
}

export function disposeFixture(fixture: ReadonlyFixture | undefined): void {
  // Tolerates a `beforeAll` that failed before the fixture existed, so the
  // teardown reports the setup failure instead of masking it with its own.
  if (fixture === undefined) return;
  makeTreeWritable(fixture.projectRoot);
  for (const dir of [fixture.projectRoot, fixture.homeDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
}

function countMatching(root: string, matches: (relativePath: string) => boolean): number {
  let count = 0;
  for (const path of digestTree(root).keys()) {
    if (matches(path)) count += 1;
  }
  return count;
}

export interface FixturePopulation {
  readonly sessions: number;
  readonly memoryEntries: number;
  readonly jobs: number;
  readonly requests: number;
  readonly valid: boolean;
  readonly reason: string;
}

/**
 * AC-4's refusal: a zero-change result on an unpopulated fixture is INVALID, not a
 * pass. The arm asserts `valid` is true for the real fixture and false for an
 * empty one, so "nothing changed because nothing was read" cannot be reported as
 * evidence that nothing was written.
 */
export function measurePopulation(projectRoot: string): FixturePopulation {
  const sessions = countMatching(projectRoot, (path) =>
    /^\.peaks\/_runtime\/\d{4}-\d{2}-\d{2}-session-[^/]+\/session\.json$/.test(path)
  );
  const memoryEntries = countMatching(
    projectRoot,
    (path) => /^\.peaks\/memory\/[^/]+\.md$/.test(path) && !path.endsWith('/MEMORY.md')
  );
  const jobs = countMatching(projectRoot, (path) => /^\.peaks\/_runtime\/[^/]+\/job\/[^/]+\/state\.json$/.test(path));
  const requests = countMatching(projectRoot, (path) => /^\.peaks\/_runtime\/[^/]+\/[^/]+\/requests\/[^/]+\.md$/.test(path));
  const missing: string[] = [];
  if (sessions === 0) missing.push('sessions');
  if (memoryEntries === 0) missing.push('memory entries');
  if (jobs === 0) missing.push('jobs');
  if (requests === 0) missing.push('requests');
  return {
    sessions,
    memoryEntries,
    jobs,
    requests,
    valid: missing.length === 0,
    reason:
      missing.length === 0
        ? `${sessions} session(s), ${memoryEntries} memory entry/entries, ${jobs} job(s), ${requests} request artifact(s)`
        : `fixture is EMPTY for: ${missing.join(', ')} — a zero-change result here proves nothing`
  };
}
