---
name: 2026-06-22-cc-connect-removal-publish
description: 2.8.2 release day — cc-connect removal finally shipped to npm. Audit found 4 follow-up cleanup items the release commit missed (orphan deps, stale static set, stale doc comments). peaks-companion skill is intentional tombstone. Lessons: (1) the 2.8.2 release commit was authored locally on 2026-06-22 but never published — npm latest stayed at 2.8.1 until this session; (2) `git add <explicit-list>` will silently skip working-tree deletions (the qrcode-terminal.d.ts was committed-as-message-only, missed in the actual stat; caught by self-audit of `git ls-tree HEAD src/types/`).
metadata:
  type: feedback
---
<!-- peaks-feedback-promoted: layer=A -->

# 2.8.2 publish day — 2026-06-22

Local commit `4c845d9 release: 2.8.2 — drop cc-connect + peer-ize open-code-review` (37 files, +22/-7713) was authored earlier in the day but **never actually published to npm** — `npm view peaks-loop version` still returned 2.8.1 throughout the day. This session ran the full pre-publish pipeline (audit → RD → QA → version → CHANGELOG → merge → tag → npm publish --dry-run → user npm publish) on the assumption that 2.8.2 had shipped. Cost 1 user correction mid-flow ("应该是2.8.2版本,目前npm的最新版是2.8.1") that revealed the misread. No actual damage — the version-target flipped from "post-release audit cleanup = 2.8.3 patch" to "the original 2.8.2 release that was always supposed to ship the cc-connect removal", which is the simpler, more correct framing.

## What 2.8.2 actually contains

1. **cc-connect removal** (original 4c845d9): drop cc-connect package + 12-file `src/services/companion/*` module + `src/cli/commands/companion.ts` + 14 `tests/unit/companion/*` test files + `peaks scan companion-binary` + `capability:companion-binary-resolution` doctor check + `PeaksConfig.companion` block.
2. **open-code-review peer-ize**: `optionalDependencies` → `peerDependencies` + `peerDependenciesMeta.optional=true`.
3. **Post-commit audit cleanup** (4 surgical fixes, added in this session): orphan npm deps (`qrcode ^1.5.4`, `qrcode-terminal ^0.12.0`, `@types/qrcode ^1.5.6`) + delete `src/types/qrcode-terminal.d.ts` + remove `'companion'` from `PARENT_COMMANDS` static set in `src/services/scan/orphan-service.ts` + refresh stale JSDoc in `config-service.ts` + drop dead `commander.invalidArgument` block in `cli/index.ts`.

## What 2.8.2 does NOT contain

- `skills/peaks-companion/` and `tests/unit/skills/peaks-companion.test.ts` are **intentionally retained as a tombstone** for users who still have `cc-connect` installed locally. CHANGELOG.md documents this design explicitly. They are not loaded by the runtime CLI.
- The pre-existing `STRAT.sig-chain` test failure in `tests/integration/rd/ast-gate-cross-version.test.ts` (filed separately, out of scope).

## Lessons

1. **Verify npm state before versioning.** A local commit + local tag with a "release:" prefix is NOT a published release. Always `npm view <pkg> version` as the first pre-publish step. In this session, I assumed 2.8.2 was already published because of the local 2.8.2 tag — wrong. Fixed mid-flow by user, but cost a 2.8.3 → 2.8.2 re-tag and force-push cycle.
2. **`git add <explicit-file-list>` will silently skip working-tree deletions.** When staging the orphan cleanup, I listed 7 specific files explicitly. The `src/types/qrcode-terminal.d.ts` deletion (which `git status` shows as ` D`, with space — meaning deleted in working tree but not staged) was not in my list, so the commit landed with the d.ts file STILL tracked in HEAD. The commit message claimed "Delete src/types/qrcode-terminal.d.ts" but `git show --stat` only showed 7 files. Self-audit (`git ls-tree HEAD src/types/` returned empty) caught it; fixed via `git add -u src/types/ && git commit --amend`. Going forward, prefer `git add -A` or `git add -u` for slices that mix content edits and file deletions.
3. **The 2.8.2 pre-existing local tag was the smoking gun.** Before this session, `git tag v2.8.2` already pointed to `4c845d9` — a tag with NO matching `git push origin v2.8.2` ever run. A local tag is a *plan*, not an *event*. Plan vs. event confusion is a recurring pattern in peaks-loop release flow.
4. **`npm pack --dry-run` is the right pre-publish gate.** Confirmed 797 files, 999.9 kB tarball, integrity hash, dist-tag, access — all BEFORE the user runs the real `npm publish`. The user ran `npm publish` immediately after; verified via `npm view peaks-loop version` → 2.8.2, `npm view peaks-loop dist-tags` → `{ latest: '2.8.2' }`.
5. **peaks-companion is a tombstone, not a bug.** The skill directory + its test deliberately remain in the repo per `CHANGELOG.md:53-55` ("remains in `skills/` for users who still have cc-connect installed locally — it is now opt-in and no longer wired into any `peaks` subcommand"). Future audits: do NOT propose deleting it. The 9/9 passing test in `tests/unit/skills/peaks-companion.test.ts` is the load-bearing assertion that the tombstone is still wired.

## Final state (post-publish)

- npm: `peaks-loop@2.8.2` published as `latest`. `peaks-loop@2.8.1` (commit 4d9e30e) is the previous version.
- main: `63a54cb release: 2.8.2 — drop cc-connect + peer-ize open-code-review` (amended from 4537f8b; original 2.8.2 release merge was 1e0d5d9, force-replaced after version+CHANGELOG corrections).
- develop: `d2e9441` (the merge of `chore/2026-06-22-cc-connect-orphan-cleanup` into develop; force-synced from main after the main force-amend).
- feature branch `chore/2026-06-22-cc-connect-orphan-cleanup`: deleted (local + remote) after merge.
- v2.8.2 tag: 23cf47d → 63a54cb (force-updated; previously pointed to 4c845d9 locally but was never on origin).
- v2.8.3 tag: deleted (local + remote; was a misframing from earlier in the session).
- 8/8 ACs + 4/4 regression sweeps + Karpathy 4/4 — all green.
- 23/23 key tests pass; full suite 3624/3625 (1 pre-existing STRAT.sig failure, out of scope).
