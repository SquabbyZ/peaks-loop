---
name: 2026-08-10-4-0-18-release-pending-verification
description: 4.0.18 release commit 已 push + tag v4.0.18 已 push，publish.yml 在 GitHub Actions 跑中
metadata:
  type: project
  kind: release-pending-verification
  rid: 4.0.18 release
  session: 2026-08-10-session-05b9be
  status: pending
---

# 4.0.18 release — pending GitHub Actions verification

## 状态

✅ **本地完成**：
- `node scripts/bump-version.mjs --to 4.0.18` — root + 3 sub-packages lockstep
- `node scripts/sync-version.mjs` + `tsc` rebuild shared dist/version.js = "4.0.18"
- `git commit ba42593d` — 23 files, +2039/-34, **no Claude trailer** (SquabbyZ sole-author)
- `git tag v4.0.18`
- `git push origin main` (7aa502cf → ba42593d)
- `git push origin v4.0.18` (new tag)

⏳ **待 GitHub Actions 验证**：
- publish.yml 触发（v4.0.18 tag push）
- 5 hard gates:
  1. ✅ strict vX.Y.Z tag format (already verified locally)
  2. ⚠️ gate-changeset — `.changeset/` only has config.json (verified locally; CI should match)
  3. ⚠️ gate-cli-version — shared dist/version.js must = 4.0.18 after CI `pnpm install --frozen-lockfile` + `pnpm run build`
  4. ⚠️ gate-capability-baseline — baseline is 4.0.8 signed 2026-08-03; 4.0.18 capability diff may flag drift
  5. ⚠️ extract-release-notes — CHANGELOG.md `## 4.0.18 — 2026-08-10 (statusline 24h overlay)` heading must match awk regex `^##[[:space:]]+4.0.18[[:space:]()]` or `—` (em-dash alternation)

## Session 上下文

- Session cost ~$41.84 (much over $10 baseline) — session must end here
- 2 slices shipped: rid-statusline-stale-ux + rid-statusline-24h-overlay
- Both slices QA accepted (5/5 + 6/6 ACs)
- Test results: 20/20 scoped + 45/45 unit regression PASS (per rid-statusline-24h-overlay acceptance)
- Zero new tsc errors introduced by either slice

## 用户验证步骤（下次会话 / terminal）

```bash
# 1. Check npm registry
npm view peaks-loop dist-tags.latest  # expect 4.0.18
npm view peaks-loop@4.0.18 version    # expect 4.0.18

# 2. If still 4.0.17, check GitHub Actions
gh run list --workflow=publish.yml --limit 5
# (proxy issue: use SSH or fix proxy to 58309)

# 3. If publish failed at gate-cli-version, likely cause:
#    - lockfile pinned peaks-loop-shared@0.0.47
#    - bump-version.mjs bumped shared to 0.0.48 in working tree
#    - but npm registry hasn't published 0.0.48 yet (it's the SAME publish.yml!)
#    Solution: keep shared at 0.0.47 for this release (it was already at 4.0.17
#    for 4.0.17 release, this is the same); revert the shared bump and re-commit.
```

## 可能需要的后续操作

### If gate-cli-version fails
Lockfile pin is 0.0.47, but bump-version.mjs bumped working tree to 0.0.48. CI's `pnpm install --frozen-lockfile` would re-resolve to 0.0.47 (already published) → CLI_VERSION drift fail.

**Fix**: Either
1. **Revert working tree to pre-bump state** for `packages/*/package.json` + `src/version.ts` (root stays at 4.0.18 because 4.0.18 is what the tag says, but shared stays at 0.0.47 which is already published)
2. **Or wait for shared@0.0.48 to publish first** (chicken-and-egg — this release IS the shared publish)

Option 1 is the recommended fix per the 4.0.14 sediment lesson.

### If gate-capability-baseline fails
Baseline is 4.0.8, this release adds 2 slices with capability changes. May need to re-baseline:
```bash
node bin/peaks.js baseline diff --project . --json  # see what changed
node bin/peaks.js baseline update --project .        # regenerate baseline (commits a new signed baseline)
```

### If extract-release-notes fails
CHANGELOG heading must match `^##[[:space:]]+4.0.18[[:space:]()]` (or `—`). My heading is `## 4.0.18 — 2026-08-10 (statusline 24h overlay)`. Verify awk regex matches the `—` (em-dash, U+2014) alternation.

## 链接

- Commit: ba42593d
- Tag: v4.0.18
- Publish.yml: `.github/workflows/publish.yml`
- Release commit message:
  ```
  chore(release): bump to 4.0.18
  - rid-statusline-stale-ux: ...
  - rid-statusline-24h-overlay: ...
  - peaks-loop-shared 0.0.47 -> 0.0.48 (lockstep)
  - peaks-loop-shared-channel 0.0.23 -> 0.0.24 (lockstep)
  - peaks-loop-mut 0.1.19 -> 0.1.20 (lockstep)
  ```

## 红线 / 警告

- ⚠️ **SquabbyZ sole-author rule**: commit message has NO `Co-Authored-By: Claude/Anthropic` trailer. Confirmed.
- ⚠️ **Do NOT push another v4.0.18 tag** — GitHub rejects duplicate tag. If fix needed, delete + recreate + repush.
- ⚠️ **Cannot unpublish on npm** (OIDC Trusted Publishing issue, per 4.0.0 + 4.0.2 stuck sediment). If 4.0.18 ships broken, you cannot unpublish; must bump to 4.0.19.
