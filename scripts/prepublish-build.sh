#!/usr/bin/env bash
#
# v2.13.3 AC-2 — publish pipeline build step.
#
# Prepublish hook that runs `pnpm run build` (which in turn calls
# sync-version + clean-dist + tsc) before `npm publish` ships the
# package. Without this hook, `bin/peaks.js` was published with a
# stale dist (last built on Jun 13 in the 2.13.2 dogfood); new
# commands shipped in 2.13.x source never reached the published
# artifact.
#
# Wired via `package.json` -> `"prepublishOnly": "bash scripts/prepublish-build.sh"`.
# On Windows + Git Bash, `pnpm` is the same script entry; the build
# step itself is OS-portable (Node + tsc).
#
# Karpathy §2 (Simplicity First): 4 lines of script. No retry logic,
# no env-var juggling — pnpm's exit code is the contract.

set -euo pipefail

cd "$(dirname "$0")/.."

echo "[prepublish-build] peaks-loop v2.13.3 — running pnpm build before publish"
pnpm run build
echo "[prepublish-build] build OK — proceeding to publish"