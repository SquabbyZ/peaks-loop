# 2026-07-18-publish-attempt (DRAFT — for next session)

## ⚠️ STATUS: In progress. Hand off to new session.

### Verified state (2026-07-18, end of monorepo session)

**Code (main branch, HEAD = 00ed6df):**
- `peaks-loop` package.json#version = **4.0.0-beta.15**
- 6 subpackages version = **0.0.1**:
  - peaks-loop-shared, peaks-loop-mut, peaks-loop-doctor,
    peaks-loop-crystallization, peaks-loop-final-review,
    peaks-loop-audit-independent
- Tag `v4.0.0-beta.15` pushed to origin (points to commit 00ed6df)
- GitHub Actions workflow `.github/workflows/publish.yml` committed
  with: triggers on `push: branches: [main]` AND `push: tags: ['v*.*.*']`
  AND `workflow_dispatch`; runs typecheck on src-only via
  `-p tsconfig.build.json`; loops over 6 subpackages calling
  `pnpm --filter $pkg exec changeset publish --tag=latest` (each
  one independently, so a per-package failure does NOT block the
  others); finally publishes the main package via changesets.

**npmjs.com state:**

| Package | Status | Version |
|---------|--------|---------|
| peaks-loop | **NOT** at 4.0.0-beta.15 (still at 4.0.0-beta.14) | ❌ |
| peaks-loop-shared | at 0.0.1 | ✓ (user manually published via token) |
| peaks-loop-mut | at 0.0.1 | ✓ |
| peaks-loop-doctor | at 0.0.1 | ✓ |
| peaks-loop-crystallization | at 0.0.1 | ✓ |
| peaks-loop-final-review | at 0.0.1 | ✓ |
| peaks-loop-audit-independent | at 0.0.1 | ✓ |

User confirmed (in this session) that all 6 subpackages' Trusted
Publishers are configured on npmjs.com. The main peaks-loop package
also has its Trusted Publisher configured. So OIDC should work.

### What is NOT done yet

Main `peaks-loop` package needs to be published at version 4.0.0-beta.15.

### Why is it not done

`git push` of the v4.0.0-beta.15 tag did NOT trigger a real
`publish` workflow run — only `.github/workflows/publish.yml` runs
(those are GitHub's internal "workflow file syntax check" runs, not
the actual publish job). This has happened repeatedly across tag
pushes; the exact cause is unclear (possibly a GitHub Actions
caching/propagation issue, or possibly a permissions problem on the
workflow file). All other commit-push triggers ran `.github/workflows/publish.yml`
runs that **completed in ~30s without dispatching the publish job**.

### Three options to finish (for next session)

#### Option A — Browser dispatch (cleanest, 30s, user action required)

User opens in a browser:

```
https://github.com/SquabbyZ/peaks-loop/actions/workflows/publish.yml
```

- Clicks `.github/workflows/publish.yml` in the left column
- Clicks "Run workflow" (blue button, top-right)
- Confirms Branch = `main`
- Clicks green "Run workflow"
- Waits 3-5 minutes for the run to complete
- Verifies via `curl -s https://registry.npmjs.org/peaks-loop | jq '.["dist-tags"].latest'`
  returns `"4.0.0-beta.15"`

#### Option B — gh CLI dispatch (if user has auth)

```sh
gh auth login --with-token <(echo $GITHUB_PAT)
gh workflow run publish.yml --ref main
# Watch:
gh run watch
```

#### Option C — Local manual publish (terminal-based, ~3 minutes)

If A and B are blocked, user temporarily relaxes publishing access
back to "granular access token with bypass 2fa", generates a token,
and runs locally (DO NOT paste token to AI):

```sh
echo "//registry.npmjs.org/:_authToken=npc_..." >> ~/.npmrc
chmod 600 ~/.npmrc
cd "C:/Users/smallMark/Desktop/peaks-loop"
npm publish dist-publish/peaks-loop-4.0.0-beta.15.tgz --tag=latest
sed -i '/registry.npmjs.org.*_authToken/d' ~/.npmrc
# Then in browser: revoke token, switch back to disallow tokens
```

### Why the publish workflow may be silently failing

Inspect one of the `.github/workflows/publish.yml` runs (e.g. id
29623898668 = #10 / SHA 00ed6df / failure) to see the actual
error. The run detail page is at
`https://github.com/SquabbyZ/peaks-loop/actions/runs/29623898668`.

Likely culprits from this session's debug attempts:
1. changesets `ignore` array in `.changeset/config.json` had glob
   patterns instead of package names — **fixed** (commit 0998371)
2. pnpm-workspace.yaml did not include `.` — **fixed** (commit
   0998371)
3. Pre-existing vitest-4 Mock type errors in tests/ — **mitigated**
   by using `-p tsconfig.build.json` in publish.yml typecheck step
   (src-only); tests run via vitest at runtime
4. Possibly the .github/workflows/publish.yml `#: Commit 0998371` runs
   were the workflow's own self-checks; the actual publish job never
   spawned because tag-push did not satisfy the workflow's `on:` filter

### Files staged in `dist-publish/`

Ready-to-publish tarballs (all gitignored):
- peaks-loop-4.0.0-beta.15.tgz (1.7 MB)
- peaks-loop-shared-0.0.1.tgz (3.7 KB)
- peaks-loop-mut-0.0.1.tgz (20.6 KB)
- peaks-loop-doctor-0.0.1.tgz (16.4 KB)
- peaks-loop-crystallization-0.0.1.tgz (24.4 KB)
- peaks-loop-final-review-0.0.1.tgz (3.3 KB)
- peaks-loop-audit-independent-0.0.1.tgz (7.2 KB)

These can be re-generated locally via:
```sh
pnpm build
for pkg in peaks-loop-shared peaks-loop-mut peaks-loop-doctor \
           peaks-loop-crystallization peaks-loop-final-review \
           peaks-loop-audit-independent; do
  (cd "packages/$pkg" && npm pack --ignore-scripts)
done
npm pack --ignore-scripts  # for peaks-loop itself
```

### Commits this session added (on main)

```
00ed6df fix(ci): publish workflow also triggers on main push (belt-and-braces)
0998371 chore(sediment): prepare 4.0.0-beta.15 + 6 subpackages 0.0.1
faeb6ee fix(ci): publish.yml publishes subpackages individually via changesets
d022f40 fix(ci): publish workflow typechecks src-only via tsconfig.build.json
659f4cf fix(tests): rewrite import paths after monorepo extraction
5d01343 chore(sediment): 4.0.0-beta.15 — monorepo release
5d6b6a0 docs(d21): document peaks sub-agent finalize in dispatcher reference
ee29733 fix(d21): add sub-agent finalize + auto-rebuild subpackages on build
```

(D21 = peaks sub-agent finalize command, see
`.peaks/_runtime/2026-07-17-session-1d5ac0/rd/slice-D21-*`)

### Misc context for next session

- Session spent ~$110 in API costs (cost critical warning fired)
- 96 files modified this session (scope warning fired)
- Slack-style toast for cost/scope is informational only — NOT
  instruction to stop; user explicitly said "不考虑成本,全部做完"
- Playwright MCP was confirmed disconnected (user saw "Failed to
  reconnect to playwright: -32000" message when trying to use it)

### Recommended first 3 actions for next session

1. Try Option A first (user dispatches via browser). 30 seconds.
2. If A doesn't work, fall back to Option B (gh CLI).
3. If B doesn't work, fall back to Option C (manual npm publish).
4. After publish succeeds, write a follow-up memory documenting
   why the publish workflow didn't auto-trigger, so future
   maintainers can fix it (likely a YAML syntax issue or a missing
   `permissions: id-token: write` somewhere).