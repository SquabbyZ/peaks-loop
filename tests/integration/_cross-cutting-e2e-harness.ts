// tests/integration/_cross-cutting-e2e-harness.ts
//
// The transport layer under `tests/integration/cross-cutting-e2e.test.ts` — the P2-D
// cross-cutting sweep that drives the real CLI through `bin/peaks.js` as a CHILD PROCESS
// and asserts the envelope shape each surface returns (release lifecycle, share-bundle
// drift pointers, skill sync, project context, config migrate, the loop surface, classify).
//
// Why the seam is HERE: the seven describe blocks decide what is acceptable; this module
// only spawns a process, hands back stdout/stderr/code, allocates the tmp projects, and
// builds the one repo shape `peaks release canary` insists on. Every line below was moved
// byte-for-byte out of the test file; the only edit is the `export ` prefix on the names it
// reads back. All eleven cases stay in the collected file, in the same order, with every
// assertion literal unchanged, and the `afterEach` that drains `projects` is still
// registered there verbatim — it mutates the imported ARRAY, not the binding.
//
// What did NOT move, and why that is the rule rather than an oversight:
// `parseEnvelope` stayed in the test file. It carries that file's pre-existing
// `@typescript-eslint/only-throw-error` finding (`throw lastError ?? new Error(...)`), and
// this campaign requires a NEW file to be clean outright — a finding does not get to move
// into a file that never had one. Fixing it is debt work with its own contract, not a
// line-budget edit. The two types it consumes (`RunResult`, `Envelope`) live here and are
// imported back as types, which is why the split is at the transport/decision seam and not
// at the middle of the envelope parser.
//
// WHAT MUST NOT SLIP
//
// `runCli` is the only place this suite touches a process: `windowsHide: true` is the repo
// convention that `tests/unit/spawn-windows-hide-guard.test.ts` enforces at every
// `child_process` call site — this module is a `child_process` importer, so the guard walks
// it and the flag travels WITH the call, not beside it. The `PEAKS_CALLER_ID` in `env` is
// pinned to `cross-cutting-e2e` because several of these commands resolve a caller and
// would otherwise inherit whatever the ambient environment holds (a caller id that is not
// this suite is a real cross-session failure mode, not a hygiene detail).
//
// `REPO` and `BIN` are computed from `__dirname`, and `__dirname` is the SAME directory in
// both files because this module sits next to the test it serves — moving it out of
// `tests/integration/` would silently re-point the repo root and the binary.
//
// `seedCanaryPrecheckFixture` exists because rid-010 made `peaks release canary` run the
// 4-layer version precheck before it touches any lifecycle state, and two of those layers
// read a real repo layout; a bare tmp dir fails closed with `PRECHECK_BLOCKER`, which is
// the precheck WORKING. Its three files and version strings are load-bearing. `makeProject
//` registers into `projects` so the collected file can still clean up after itself.
//
// A harness, not a test file: no `.test.ts` suffix, so `vitest.config.integration.ts`
// (`include: tests/integration/**/*.test.ts`) does not collect it and it declares no
// dimensions. It IS under `tests/`, so the ESM-extension guard walks it — which is why it
// imports only `node:` builtins and has no relative specifier to get wrong.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
export const BIN = resolve(__dirname, '../../bin/peaks.js');
export const REPO = resolve(__dirname, '../..');
export const BIN_TIMEOUT_MS = 120_000;

export interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'cross-cutting-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: caught.status ?? 1
    };
  }
}
export interface Envelope {
  ok: boolean;
  command: string;
  code?: string;
  message?: string;
  data: unknown;
  warnings: readonly unknown[];
  nextActions: readonly string[];
}
export const projects: string[] = [];

export function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}
/**
 * Build the peaks-loop repo shape `peaks release canary` requires.
 *
 * Since rid-010 the canary action runs the 4-layer version precheck before it
 * transitions anything (`release-commands.ts:167-205` → `executeCanaryAction`
 * → `runAllLayers`), and two of those layers read a real repo layout:
 * `rootVsShared` compares root `package.json#version` against
 * `packages/peaks-loop-shared/dist/version.js`, and `workspaceLockstep` wants
 * `peaks-loop-shared` workspace-linked with a clean semver
 * (`version-precheck-service.ts:152-219`, `:328-394`). A bare tmp dir therefore
 * can never reach canary — it fails closed with `PRECHECK_BLOCKER` before the
 * lifecycle is touched, which is the precheck working, not the release
 * lifecycle regressing. Three files, all written by this test; no git needed
 * (the tag-collision layer degrades to a warning outside a repository).
 */
export function seedCanaryPrecheckFixture(project: string, version: string): void {
  const sharedDir = join(project, 'packages', 'peaks-loop-shared');
  mkdirSync(join(sharedDir, 'dist'), { recursive: true });
  writeFileSync(
    join(project, 'package.json'),
    `${JSON.stringify(
      {
        name: 'p2d-release-fixture',
        version,
        private: true,
        dependencies: { 'peaks-loop-shared': 'workspace:*' }
      },
      null,
      2
    )}\n`,
    'utf8'
  );
  writeFileSync(
    join(sharedDir, 'package.json'),
    `${JSON.stringify({ name: 'peaks-loop-shared', version, private: true }, null, 2)}\n`,
    'utf8'
  );
  writeFileSync(
    join(sharedDir, 'dist', 'version.js'),
    `export const CLI_VERSION = "${version}";\n`,
    'utf8'
  );
}
