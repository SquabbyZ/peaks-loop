---
name: r-2-symlink-guard-for-settings-writes
description: R-2 symlink guard for settings writes
metadata:
  type: convention
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

R-2 hard rule: settings files (`.claude/settings.json`, `.trae/settings.json`, etc.) MUST NOT be writable through a symlink. All settings writes go through `assertSafeSettingsFile(scope, root, dirName, settingsFileName)` in `src/services/ide/shared/safe-path.ts`, which calls `lstatSync` + `realpathSync` and throws on symlinks or escape. The rule is preserved end-to-end in the slice #1 refactor (verified by 3-way security-review).
