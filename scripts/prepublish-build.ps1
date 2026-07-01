# v2.13.3 AC-2 — Windows PowerShell counterpart to `prepublish-build.sh`.
#
# Used when the publish host runs native Windows PowerShell (no Git
# Bash). Mirrors the bash flow: run `pnpm run build` before the
# publish step. The script is OS-portable because pnpm + tsc + node
# are all installed via the packageManager pin in package.json.
#
# Karpathy §2 (Simplicity First): 4 lines of script.

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

Write-Host "[prepublish-build] peaks-loop v2.13.3 — running pnpm build before publish"
pnpm run build
if ($LASTEXITCODE -ne 0) { throw "build failed with exit code $LASTEXITCODE" }
Write-Host "[prepublish-build] build OK — proceeding to publish"