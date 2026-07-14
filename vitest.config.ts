import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig as _defineConfig, type TestUserConfig } from 'vitest/config';

// vitest 4.1.10 ships a broken `defineConfig` overload chain in its
// top-level type definitions (see `node_modules/vitest/dist/config.d.ts`:
// all overloads take Vite's `UserConfig`, which lacks `pool`,
// `fileParallelism`, `experimental.fsModuleCache`, etc.). The runtime
// implementation is a passthrough identity function that accepts any
// valid vitest config, so we wrap the typed overload in a narrow
// identity function whose signature matches the literal's real type.
// This sidesteps the broken chain without `as any` casts scattered
// across the file.
const defineConfig = <T>(config: T): T => _defineConfig(config as never);

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)));
const stableCoverageRoot = process.platform === 'win32'
  ? projectRoot.replace(/^[A-Z]:/, (drive) => drive.toLowerCase())
  : projectRoot;

// Hard-code `root` to the project root (resolved from import.meta.url), NOT
// `process.cwd()`. This is deliberate and load-bearing — DO NOT "simplify"
// to process.cwd() in a future cleanup. See PRD 2026-06-24-baseline-92-triage
// (change-id 014-full-dogfood) for the full root-cause analysis.
//
// Why: `peaks session init` / peaks-code orchestrators create a temporary
// workspace under the system Temp dir (e.g. C:\Users\...\AppData\Local\Temp\)
// and the orchestrator's child processes (including vitest workers spawned
// via npm/pnpm scripts) inherit that Temp cwd. vitest's default `root` is
// `process.cwd()`, so worker processes resolve every `tests/**\/*.fixture`
// path against the Temp dir and ENOENT. Pinning `root` to the project root
// computed from `import.meta.url` forces vitest to resolve test files and
// fixtures from the real repo, independent of whatever cwd the orchestrator
// passed down. The peaks session init CWD Temp side-effect itself is a
// design choice (see PRD risk R4) and is intentionally NOT modified here —
// this config isolates vitest from that side-effect without touching the
// orchestrator.
//
// Type note: see the `defineConfig` wrapper above — it bypasses
// vitest 4.1.10's broken top-level `defineConfig` overloads. The
// literal below is annotated as `TestUserConfig` (vitest's real
// `UserConfig`) so every field — `pool`, `fileParallelism`,
// `experimental.fsModuleCache`, etc. — is type-checked correctly.
const config: TestUserConfig = {
  root: stableCoverageRoot,
  // Run test files in PARALLEL forked workers. This is the single biggest
  // lever on suite wall-clock: the suite is now 488 files (not the "121
  // files / ~18s" an earlier comment assumed), and vitest 4 in a single
  // fork accumulates per-test overhead that grows ~O(N) with files-per-
  // worker (documented in
  // .peaks/memory/slice-014-vitest-slowdown-and-race-repeat.md). Forcing
  // all 488 files through one worker pushed the full `pnpm test` run past
  // 10 minutes; spreading them across forks bounds each worker's file
  // count and keeps per-test overhead flat.
  //
  // Why this is now race-free (it wasn't before): the ONLY cross-worker
  // hazard was tests/vitest.setup.ts renaming the shared
  // .peaks/.session.json + .active-skill.json files on every worker. That
  // stash moved to tests/vitest.global-setup.ts, which runs ONCE in the
  // main process before any worker spawns and restores once after they
  // exit. The per-worker tests/vitest.setup.ts now only pins
  // process.cwd() (process-local, safe under parallelism).
  //
  // pool: 'forks' (not 'threads') is deliberate — the setup chdir()s and
  // several tests spy/override process.cwd(); forks give each file its own
  // process so cwd changes cannot leak across concurrently-running files.
  pool: 'forks',
  fileParallelism: true,
  // maxWorkers: 4 is empirical (see sediment below + the full-suite profile
  // at .peaks/_runtime/<sessionId>/rd/vitest-mw4-baseline.json this slice).
  // At maxWorkers=16 cross-fork contention on shared resources produces ~1
  // flaky failure per full run; at 4 the same files report 0 failures while
  // still overlapping real I/O. CI runners with < 4 cores can override via
  // `vitest run --maxWorkers=2` (the CLI flag beats the config value).
  // minWorkers: 1 lets the runner shed workers when the file count drops.
  maxWorkers: 4,
  minWorkers: 1,
  // Slice 2026-07-12-vitest-perf-tune — enable vitest 4's on-disk
  // module cache (`experimental.fsModuleCache`, 4.0.11+). Transformed
  // modules are persisted under `node_modules/.experimental-vitest-cache`
  // and reused on re-runs, skipping the per-run transform/parse work.
  // Independent of pool/parallelism — orthogonal to the deterministic
  // single-worker setup above (no interaction with the
  // .peaks/.session.json race avoidance). Clear with `vitest --clearCache`.
  //
  // Empirical note (2026-07-12): with vitest 4.1.10 + pool=forks +
  // Node 22 + Windows, runtime logs `[write]` events going to
  // `%TEMP%/<random>/ssr/...` (per-fork temp) rather than the
  // persistent fsModuleCache location, and warm runs show no measurable
  // transform-time reduction (cold 17.8s → warm 15.9s is within noise).
  // The flag is kept enabled for forward compatibility with vitest
  // versions where the persistence path is fully wired, and is
  // runtime-accepted by vitest 4.1.10 (no errors). Revisit if a
  // future vitest upgrade resolves the persistence gap.
  experimental: {
    fsModuleCache: true,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/vitest.setup.ts'],
    // Runs once in the main process before any worker spawns (and restores
    // once after). Stashes .peaks/.session.json + .active-skill.json so the
    // per-worker setup no longer races on those shared files — the change
    // that makes `fileParallelism: true` above safe.
    globalSetup: ['./tests/vitest.global-setup.ts'],
// Slice A.1 — raise default testTimeout. Bumped from 10s in vitest 4
    // migration: even with `fileParallelism: false` (which forces
    // single-worker mode), tests that perform real filesystem + git +
    // subprocess I/O regularly take 12–60s on Windows.
    // 60s accommodates the slowest unit-test case (~50s for the worst
    // config-safety tests); integration tests that spawn `tsx`+node+CLI
    // (~3s per call × 7 calls = 21s baseline) can occasionally hit 60s
    // under load and benefit from 120s headroom. We default to 120s
    // to cover both layers with one ceiling. Per-test `{ timeout: … }`
    // overrides below this for tests that already pin a smaller one.
    testTimeout: 120_000,
    // Slice A.1 (cont.) — raise hookTimeout in lockstep with testTimeout.
    // afterEach hooks that rmSync a fixture tree (e.g.
    // job-resource-snapshot.test.ts afterEach deleting a nested project
    // tree) take >10s on Windows; default 10s hookTimeout is the same
    // 10s/30s cliff as testTimeout was, and we hit it for the same
    // reason (real I/O in fixtures under a single-worker fork). 60s
    // matches testTimeout so the cliff stays out of the picture.
    hookTimeout: 60_000,
    // Slice 2026-07-12-vitest-perf-tune — flag any test or suite that
    // exceeds 1s as "slow" in vitest's reporter output. Pure
    // observability — no behavior change, no timeout interaction.
    // Default is 300ms which is too noisy for a real-I/O-heavy suite
    // where legitimate filesystem / git / subprocess calls routinely
    // take hundreds of milliseconds. 1000ms surfaces genuinely slow
    // cases (CI candidate for further slicing) without flooding output.
    slowTestThreshold: 1000,
    /**
     * Slice A.3 / AC-5.1 — G5 race-detector mode is documented below.
     *
     * Activated by `pnpm test:race` (vitest --no-file-parallelism <4 files>).
     * vitest 4.1.x (the version this repo pins) does not expose a
     * `--repeat` CLI flag (added in vitest 2.2+). To satisfy AC-5.1's
     * "20× repeat" intent without bumping the vitest dep, each fuzz case
     * in the 4 race-mode files internally loops the case body 20×
     * (constant `RACE_REPEAT = 20`). This is documented in each test file.
     *
     * The 4 race-mode test files (per PRD v2-14-0-anti-fake-green-hardening
     * AC-5.1):
     *   - tests/unit/g8-shared-channel.test.ts
     *   - tests/unit/dispatch-record-writer.test.ts
     *   - tests/unit/services/retrospective/heartbeat.test.ts
     *   - tests/unit/cli/commands/share-commands.test.ts
     */
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/cli/index.ts',
        'src/cli/program.ts',
        'src/cli/commands/shadcn-commands.ts',
        'src/cli/commands/core-artifact-commands.ts',
        'src/cli/commands/codegraph-commands.ts',
        'src/cli/commands/project-commands.ts',
        'src/cli/commands/workflow-commands.ts',
        'src/cli/commands/request-commands.ts',
        'src/cli/commands/scan-commands.ts',
        'src/shared/paths.ts',
        'src/shared/result.ts',
        'src/services/recommendations/recommendation-types.ts',
        'src/services/artifacts/artifact-service.ts',
        'src/services/artifacts/workspace-service.ts',
        'src/services/config/config-service.ts',
        'src/services/config/config-safety.ts',
        'src/shared/frontmatter.ts',
        'src/services/skills/skill-registry.ts',
        'src/services/doctor/doctor-service.ts',
        'src/services/proxy/proxy-service.ts',
        'src/services/codegraph/codegraph-process-runner.ts',
        'src/services/shadcn/shadcn-service.ts',
        'src/services/mcp/mcp-types.ts',
        'src/services/mcp/mcp-stdio-transport.ts',
        'src/services/openspec/openspec-types.ts',
        'src/services/understand/understand-types.ts',
        'src/services/scan/scan-types.ts',
        'src/services/session/index.ts',
      ],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
    },
  },
};
export default defineConfig(config);