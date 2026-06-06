---
name: src-services-ide-module-is-the-single-source-of-truth-for-ide-aware-behavior
description: src/services/ide/ module is the single source of truth for IDE-aware behavior
metadata:
  type: module
  sourceArtifact: .peaks/_runtime/2026-06-06-session-22f08c/txt/handoff.md
---

The `src/services/ide/` module is the single source of truth for IDE-aware behavior. Files: `ide-types.ts` (slim adapter interface + PEAKS_HOOK_SCHEMA), `ide-registry.ts` (Map-based registry with `getAdapter` / `listAdapterIds` / `_setAdapterForTesting` test seam), `ide-detector.ts` (cwd-walk based), `hook-translator.ts` (stdin parsing + IDE auto-detect from env/stdin/cwd), `hook-protocol.ts` (canonical hook schema + decision response formatter), `adapters/` (one file per registered IDE; slice #1 has only `claude-code-adapter.ts`), `shared/safe-path.ts` (symlink + escape guards for settings writes), `shared/atomic-json.ts` (atomic temp + rename pattern for settings writes). Any new IDE-aware code MUST live under this module; do not create parallel `src/services/<ide-name>/` directories.
