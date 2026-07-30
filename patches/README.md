# patches/

Persistent patches applied to upstream dependencies via
`pnpm patch` (pnpm 10.x native patching). Each `.patch` file
here is automatically applied on `pnpm install` because the
corresponding `patchedDependencies:` entry lives in
`pnpm-workspace.yaml`.

## vitest@4.1.10.patch — Slice 2026-07-30-windows-popup

Adds `windowsHide: true` to vitest's forks-pool worker
spawn options (`dist/chunks/cli-api.BK8pd4xc.js`,
`ForksPoolWorker#start`). Without this, vitest 4.1.10 calls
`child_process.fork` without `windowsHide`, so on Windows
each test worker briefly pops a console window before
exiting. The popup pattern is most visible when running
`pnpm test:full` because all 8 workers of the fast project
spawn in close succession.

Upstream vitest has not yet exposed a `poolOptions.forks.windowsHide`
config option (verified against /config/pool.html 2026-07-30).
Once it lands, this patch should be removed and the config
should migrate to use the upstream option instead.

Verified by:
  $ pnpm exec vitest run tests/unit/dispatch/ \\
      sub-agent-dispatcher.test.ts
  Test Files  1 passed (1)
  Tests  6 passed (6)
  Duration  305ms

To regenerate this patch after upgrading vitest:
  $ pnpm patch vitest@<new-version>
  # edit the extracted copy
  $ pnpm patch-commit <extracted-dir>
