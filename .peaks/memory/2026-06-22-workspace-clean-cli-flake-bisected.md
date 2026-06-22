# Workspace-clean-cli full-suite flake — root cause identified

**Bisection completed:** 4 flakes are caused by **environment pollution** leaking from one test into the spawned `node` child process.

## Root cause (one-line)

`tests/unit/artifact-setup.test.ts` calls `vi.stubEnv('HOME', home)` in its LAST test, and `vi.unstubAllEnvs()` only runs in `beforeEach` — never `afterEach`. The stubbed HOME (`C:\Users\SMALLM~1\AppData\Local\Temp\peaks-home-<ts>`) survives across all subsequent test files because `process.env` is module-global. The spawned `node bin/peaks.js` inherits this stubbed HOME via the default `env: process.env` in `execSync`.

## Why this breaks the workspace-clean-cli test

1. `artifact-setup` last test calls `vi.stubEnv('HOME', stubHome)` where `stubHome` is a child of `tmpdir()`.
2. `workspace-clean-cli` runs next. Its `cli()` helper does `execSync('node ${CLI_BIN} ${args}', { cwd })` — **does not pass `env`**, so the spawned child inherits the parent's stubbed HOME.
3. Inside the spawned CLI, `resolveCanonicalProjectRoot(project)` reads `homedir()` (which uses HOME on Windows). With HOME below the project's tmpdir, the heuristic walks UP past the project looking for `.git`/`package.json`/`.peaks/config.json`, doesn't find any, and returns `pkgRoot = C:\Users\SMALLM~1` (the **real** home that node-os also returns when HOME is unset).
4. `executeRuntimeCleanup(C:\Users\SMALLM~1, ...)` then lists `C:\Users\SMALLM~1\.peaks\_runtime` which doesn't exist → returns 0 sessions.
5. The test asserts `expect(out.data[0].deleted).toEqual(['2026-06-10-session-aaa111'])` → `actual: []` → FAIL.

Same root cause for all 4 tests (`--runtime`, `--apply`, `--sub-agents --invalid`, `archive`).

## Reproduction (minimal)

```bash
pnpm vitest run \
  tests/integration/workspace-clean-cli.test.ts \
  tests/unit/config-migration.test.ts \
  tests/unit/config-restore.test.ts \
  tests/unit/artifact-setup.test.ts
```

4 fail. Remove `artifact-setup.test.ts` → all pass. Add ONLY `artifact-setup.test.ts` → pass. The stubbed HOME from artifact-setup's last test is the trigger.

## Fix options

### Option A — Surgical fix in `workspace-clean-cli.test.ts` (recommended)

Snapshot the env at module load (BEFORE any vitest test runs) and pass `env: BASELINE_ENV` to `execSync`. This protects ALL spawned children from any vitest-side env stub, regardless of which test pollutes.

```ts
// At top of test file, before any other test can run:
const BASELINE_ENV = { ...process.env };

function cli(args: string, cwd: string): { ... } {
  const stdout = execSync(`node ${CLI_BIN} ${args}`, {
    cwd,
    env: BASELINE_ENV,   // ← spawn with pre-test snapshot, not current process.env
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  // ...
}
```

Caveat: vitest may run this test file in any order, so `process.env` at module load may already be stubbed by another file. **Safer:** snapshot in a `globalSetup` or capture from `process.env` in a `beforeAll` of this file. Or — simplest — `delete process.env.HOME` and `delete process.env.USERPROFILE` inside `BASELINE_ENV`, letting the OS return the real home.

### Option B — Fix in `artifact-setup.test.ts`

Add an `afterEach(() => { vi.unstubAllEnvs(); })`. But this is fragile: any future test that stubs env must remember to unstub. Option A is robust because it makes the workspace-clean-cli test self-defending.

### Option C — Fix in `resolveCanonicalProjectRoot` / CLI

Make the spawned child re-read HOME from a different source (e.g. `os.homedir()` actually ignores stubbed HOME on Windows and returns the real one — but our repro shows it doesn't). The actual fix is in test infrastructure.

**Recommendation: Option A.** Test-infrastructure fix is the smallest blast radius and protects any future spawned-CLI test.

## Carry-forward for Plan 3

After fix + re-run full suite → push 12+1 commits to origin/main → start Plan 3 (peaks-rd strategic/tactical split).